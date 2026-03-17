import { runOpportunityEngine } from "./opportunity-engine";
import { runDMCoverage } from "./dm-coverage";
import { runEngine as runCallEngine } from "./call-engine";
import { runQueryIntel } from "./query-intel";
import { generatePlaybooksForTodayList } from "./playbooks";
import { runDMFit } from "./dm-fit";
import { ensureSchema } from "./airtable-schema";
import { log } from "./logger";
import { getIndustryConfig } from "./config";
import { eventBus } from "./events";
import { startRun, addStep, completeRun } from "./run-history";
import { takeSnapshot, computeDiff } from "./run-diff";
import { snapshotTodayListFields, computeChangeset, type ChangesetEntry } from "./run-changeset";
import { checkLimit, logUsageMetric } from "./usage-guard";
import { runSalesLearning } from "./sales-learning/run-sales-learning";
import { snapshotAuthorityTrends } from "./dm-authority-learning";
import { runAlertDetection } from "./machine-alerts";
import { updateDMStatus } from "./dm-status";
import { runRecoveryEngine } from "./recovery-engine";

let isRunning = false;
let currentRunId: string | null = null;

export class RunAlreadyActiveError extends Error {
  constructor() {
    super("RUN_ALREADY_ACTIVE");
    this.name = "RunAlreadyActiveError";
  }
}

export interface WebRunOptions {
  top?: number;
  limit?: number;
  targetFresh?: number;
  generate?: number;
  market?: string;
  bootstrap?: boolean;
  playbooks?: boolean;
  salesLearning?: boolean;
  clientId?: string;
}

export function isRunActive(): boolean {
  return isRunning;
}

export function getCurrentRunId(): string | null {
  return currentRunId;
}

export function startDailyRun(opts?: WebRunOptions): string {
  if (isRunning) {
    throw new RunAlreadyActiveError();
  }

  const run_id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  currentRunId = run_id;
  isRunning = true;

  executeRun(run_id, opts).catch((err) => {
    log(`Run ${run_id} failed unexpectedly: ${err.message}`, "daily-web");
  });

  return run_id;
}

async function timedStep(
  run_id: string,
  stepName: string,
  fn: () => Promise<any>,
  clientId?: string
): Promise<{ result: any; duration_ms: number }> {
  const started_at = Date.now();
  eventBus.publish("STEP_STARTED", { step: stepName, run_id, ts: started_at }, clientId);
  addStep(run_id, { step: stepName, started_at, status: "running" });

  try {
    const result = await fn();
    const duration_ms = Date.now() - started_at;
    const stats = typeof result === "object" ? result : undefined;

    eventBus.publish("STEP_DONE", { step: stepName, run_id, duration_ms, ts: Date.now(), stats }, clientId);
    addStep(run_id, { step: stepName, started_at, finished_at: Date.now(), duration_ms, stats, status: "ok" });

    return { result, duration_ms };
  } catch (err: any) {
    const duration_ms = Date.now() - started_at;
    eventBus.publish("ERROR", { step: stepName, message: err.message, ts: Date.now() }, clientId);
    addStep(run_id, { step: stepName, started_at, finished_at: Date.now(), duration_ms, status: "error" });
    throw err;
  }
}

async function executeRun(run_id: string, opts?: WebRunOptions): Promise<void> {
  const clientId = opts?.clientId;
  const config = {
    top: opts?.top ?? 25,
    limit: opts?.limit ?? 25,
    targetFresh: opts?.targetFresh ?? 100,
    generate: opts?.generate ?? 20,
    market: opts?.market ?? "Gulf Coast",
    bootstrap: opts?.bootstrap ?? false,
    playbooks: opts?.playbooks ?? true,
  };

  const errors: string[] = [];
  startRun(run_id, clientId);
  eventBus.publish("RUN_STARTED", { run_id, ts: Date.now() }, clientId);

  log(`Web run started: ${run_id}`, "daily-web");
  const industryCfg = getIndustryConfig();
  log(`Config: ${industryCfg.name} | Market: ${industryCfg.market}`, "daily-web");

  let beforeSnapshot: Awaited<ReturnType<typeof takeSnapshot>> | null = null;
  try {
    beforeSnapshot = await takeSnapshot();
    log(`Before snapshot taken: ${JSON.stringify(beforeSnapshot)}`, "run-diff");
  } catch (e: any) {
    log(`Before snapshot failed: ${e.message}`, "run-diff");
  }

  let changesetBefore: Awaited<ReturnType<typeof snapshotTodayListFields>> | null = null;
  let changesetEntries: ChangesetEntry[] = [];

  try {
    if (config.bootstrap) {
      try {
        await timedStep(run_id, "bootstrap", async () => {
          const report = await ensureSchema();
          return { created: report.fields_created.length + report.tables_created.length };
        }, clientId);
      } catch (e: any) {
        errors.push(`Bootstrap: ${e.message}`);
      }
    }

    try {
      changesetBefore = await snapshotTodayListFields(clientId);
      log(`Changeset: before-snapshot captured ${changesetBefore.size} records`, "changeset");
    } catch (e: any) {
      log(`Changeset before-snapshot failed: ${e.message}`, "changeset");
    }

    try {
      await timedStep(run_id, "recovery_engine", async () => {
        const r = await runRecoveryEngine(clientId);
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "recovery_engine",
          company: `${r.processing.recovered}/${r.processing.processed} recovered, ${r.queue.added} queued`,
          ts: Date.now(),
        }, clientId);
        return r;
      }, clientId);
    } catch (e: any) {
      errors.push(`Recovery Engine: ${e.message}`);
    }

    try {
      await timedStep(run_id, "outreach_engine", async () => {
        const { runOutreachEngine } = await import("./outreach-engine");
        const r = await runOutreachEngine(clientId);
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "outreach_engine",
          company: `${r.populate.added} new sequences, ${r.advance.advanced} advanced`,
          ts: Date.now(),
        }, clientId);
        return r;
      }, clientId);
    } catch (e: any) {
      errors.push(`Outreach Engine: ${e.message}`);
    }

    try {
      if (clientId) {
        const guard = await checkLimit(clientId, "top_companies", 0);
        if (!guard.allowed) {
          addStep(run_id, { step: "opportunity_engine", started_at: Date.now(), status: "skipped" });
          log(`Opportunity engine skipped: usage limit reached (${guard.limit})`, "daily-web");
          errors.push(`Opportunity Engine: Usage limit reached`);
        } else {
          config.top = Math.min(config.top, guard.remaining);
        }
      }
      const { result: oeResult } = await timedStep(run_id, "opportunity_engine", async () => {
        const r = await runOpportunityEngine({ top: config.top, pctHot: 0.4, pctWorking: 0.35, pctFresh: 0.25 }, clientId);
        if (clientId) await logUsageMetric(clientId, run_id, "opportunity_engine", "top_companies", r.hot_selected + r.working_selected + r.fresh_selected + r.score_fill_selected);
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "opportunity_engine",
          company: `${r.hot_selected + r.working_selected + r.fresh_selected + r.score_fill_selected} companies selected`,
          ts: Date.now(),
        }, clientId);
        return r;
      }, clientId);
      log(`Call list: ${oeResult.hot_selected + oeResult.working_selected + oeResult.fresh_selected} companies`, "daily-web");
    } catch (e: any) {
      errors.push(`Opportunity Engine: ${e.message}`);
    }

    try {
      await timedStep(run_id, "dm_coverage", async () => {
        const r = await runDMCoverage({ top: config.top, limit: config.limit }, clientId);
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "dm_coverage",
          company: `${r.companiesEnriched} enriched, ${r.companiesReady} ready`,
          ts: Date.now(),
        }, clientId);
        return r;
      }, clientId);
    } catch (e: any) {
      errors.push(`DM Coverage: ${e.message}`);
    }

    try {
      await timedStep(run_id, "dm_fit", async () => {
        const r = await runDMFit(clientId);
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "dm_fit",
          company: `${r.offerDMSelected}/${r.totalCompanies} selected`,
          ts: Date.now(),
        }, clientId);
        return r;
      }, clientId);
    } catch (e: any) {
      errors.push(`DM Fit: ${e.message}`);
    }

    try {
      await timedStep(run_id, "dm_status", async () => {
        const r = await updateDMStatus(clientId);
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "dm_status",
          company: `${r.updated}/${r.total} classified`,
          ts: Date.now(),
        }, clientId);
        return r;
      }, clientId);
    } catch (e: any) {
      errors.push(`DM Status: ${e.message}`);
    }

    if (config.playbooks) {
      try {
        await timedStep(run_id, "playbooks", async () => {
          const r = await generatePlaybooksForTodayList({ limit: config.top, force: false }, clientId);
          eventBus.publish("TRIGGER_FIRED", {
            trigger: "playbooks",
            company: `${r.generated} generated, ${r.skipped} skipped`,
            ts: Date.now(),
          }, clientId);
          return r;
        }, clientId);
      } catch (e: any) {
        errors.push(`Playbooks: ${e.message}`);
      }
    }

    try {
      await timedStep(run_id, "web_intel", async () => {
        const { runWebIntelForTodayList } = await import("./web-intel");
        const r = await runWebIntelForTodayList(config.top);
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "web_intel",
          company: `${r.updated} companies with intel, ${r.errors} errors`,
          ts: Date.now(),
        }, clientId);
        return r;
      }, clientId);
    } catch (e: any) {
      errors.push(`Web Intel: ${e.message}`);
    }

    if (changesetBefore) {
      try {
        const changesetAfter = await snapshotTodayListFields(clientId);
        changesetEntries = computeChangeset(changesetBefore, changesetAfter);
        log(`Changeset: ${changesetEntries.length} field changes detected`, "changeset");
      } catch (e: any) {
        log(`Changeset after-snapshot failed: ${e.message}`, "changeset");
      }
    }

    try {
      await timedStep(run_id, "call_engine", async () => {
        const r = await runCallEngine(clientId);
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "call_engine",
          company: `${r.calls_processed} calls processed`,
          ts: Date.now(),
        }, clientId);
        return r;
      }, clientId);
    } catch (e: any) {
      errors.push(`Call Engine: ${e.message}`);
    }

    if (opts?.salesLearning !== false) {
      try {
        await timedStep(run_id, "sales_learning", async () => {
          const r = await runSalesLearning(clientId, { limit: 50 });
          eventBus.publish("TRIGGER_FIRED", {
            trigger: "sales_learning",
            company: `${r.calls_processed} calls analyzed, ${r.patches_created} patches`,
            ts: Date.now(),
          }, clientId);
          return r;
        }, clientId);
      } catch (e: any) {
        log(`Sales Learning failed (non-blocking): ${e.message}`, "daily-web");
        errors.push(`Sales Learning: ${e.message}`);
      }
    }

    try {
      await timedStep(run_id, "query_intel", async () => {
        const r = await runQueryIntel({
          generate: config.generate,
          targetFresh: config.targetFresh,
          market: config.market,
        }, clientId);
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "query_intel",
          company: `fresh=${r.freshCount}, inserted=${r.queriesInserted}`,
          ts: Date.now(),
        }, clientId);
        return r;
      }, clientId);
    } catch (e: any) {
      log(`Query Intel failed: ${e.message}`, "daily-web");
      errors.push(`Query Intel: ${e.message}`);
    }

    if (clientId) {
      try {
        const { scoreAllFlowsForClient } = await import("./lead-intelligence");
        const scoreResult = await scoreAllFlowsForClient(clientId);
        log(`Lead intelligence: ${scoreResult.scored} flows scored, ${scoreResult.errors} errors`, "daily-web");
      } catch (e: any) {
        log(`Lead intelligence scoring failed (non-blocking): ${e.message}`, "daily-web");
      }

      try {
        const { runResearchEngine } = await import("./research-engine");
        const researchResult = await runResearchEngine(clientId);
        log(`Research engine: processed=${researchResult.totalProcessed} email=${researchResult.convertedToEmail} call=${researchResult.convertedToCall} remaining=${researchResult.remainingResearch}`, "daily-web");
      } catch (e: any) {
        log(`Research engine failed (non-blocking): ${e.message}`, "daily-web");
      }

      try {
        const trendCount = await snapshotAuthorityTrends(clientId);
        log(`Authority trend snapshot: ${trendCount} titles recorded`, "daily-web");
      } catch (e: any) {
        log(`Authority trend snapshot failed (non-blocking): ${e.message}`, "daily-web");
      }

      try {
        const alertResult = await runAlertDetection(clientId);
        log(`Machine alerts: ${alertResult.alertsCreated} new alerts generated`, "daily-web");
      } catch (e: any) {
        log(`Machine alert detection failed (non-blocking): ${e.message}`, "daily-web");
      }
    }

    let diff = null;
    if (beforeSnapshot) {
      try {
        const afterSnapshot = await takeSnapshot();
        diff = computeDiff(beforeSnapshot, afterSnapshot);
        log(`Run diff computed: ${JSON.stringify(diff)}`, "run-diff");
      } catch (e: any) {
        log(`After snapshot failed: ${e.message}`, "run-diff");
      }
    }

    const changeset = changesetEntries.length > 0
      ? { entries: changesetEntries, reverted: false }
      : null;

    const status = errors.length > 0 ? "error" as const : "completed" as const;
    completeRun(run_id, {
      finished_at: Date.now(),
      errors,
      status,
      summary: { errors_count: errors.length, warnings_count: 0, diff, changeset },
    });
    eventBus.publish("RUN_DONE", { run_id, ts: Date.now(), status }, clientId);
    log(`Web run ${run_id} finished: ${status} (${errors.length} errors)`, "daily-web");
  } catch (e: any) {
    let diff = null;
    if (beforeSnapshot) {
      try {
        const afterSnapshot = await takeSnapshot();
        diff = computeDiff(beforeSnapshot, afterSnapshot);
      } catch {}
    }
    const changeset = changesetEntries.length > 0
      ? { entries: changesetEntries, reverted: false }
      : null;
    completeRun(run_id, {
      finished_at: Date.now(),
      errors: [...errors, e.message],
      status: "error",
      summary: { errors_count: errors.length + 1, diff, changeset },
    });
    eventBus.publish("RUN_DONE", { run_id, ts: Date.now(), status: "error" }, clientId);
    log(`Web run ${run_id} crashed: ${e.message}`, "daily-web");
  } finally {
    isRunning = false;
    currentRunId = null;
  }
}
