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
  fn: () => Promise<any>
): Promise<{ result: any; duration_ms: number }> {
  const started_at = Date.now();
  eventBus.publish("STEP_STARTED", { step: stepName, run_id, ts: started_at });
  addStep(run_id, { step: stepName, started_at, status: "running" });

  try {
    const result = await fn();
    const duration_ms = Date.now() - started_at;
    const stats = typeof result === "object" ? result : undefined;

    eventBus.publish("STEP_DONE", { step: stepName, run_id, duration_ms, ts: Date.now(), stats });
    addStep(run_id, { step: stepName, started_at, finished_at: Date.now(), duration_ms, stats, status: "ok" });

    return { result, duration_ms };
  } catch (err: any) {
    const duration_ms = Date.now() - started_at;
    eventBus.publish("ERROR", { step: stepName, message: err.message, ts: Date.now() });
    addStep(run_id, { step: stepName, started_at, finished_at: Date.now(), duration_ms, status: "error" });
    throw err;
  }
}

async function executeRun(run_id: string, opts?: WebRunOptions): Promise<void> {
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
  startRun(run_id);
  eventBus.publish("RUN_STARTED", { run_id, ts: Date.now() });

  log(`Web run started: ${run_id}`, "daily-web");
  const industryCfg = getIndustryConfig();
  log(`Config: ${industryCfg.name} | Market: ${industryCfg.market}`, "daily-web");

  try {
    if (config.bootstrap) {
      try {
        await timedStep(run_id, "bootstrap", async () => {
          const report = await ensureSchema();
          return { created: report.fields_created.length + report.tables_created.length };
        });
      } catch (e: any) {
        errors.push(`Bootstrap: ${e.message}`);
      }
    }

    try {
      const { result: oeResult } = await timedStep(run_id, "opportunity_engine", async () => {
        const r = await runOpportunityEngine({ top: config.top, pctHot: 0.4, pctWorking: 0.35, pctFresh: 0.25 });
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "opportunity_engine",
          company: `${r.hot_selected + r.working_selected + r.fresh_selected + r.score_fill_selected} companies selected`,
          ts: Date.now(),
        });
        return r;
      });
      log(`Call list: ${oeResult.hot_selected + oeResult.working_selected + oeResult.fresh_selected} companies`, "daily-web");
    } catch (e: any) {
      errors.push(`Opportunity Engine: ${e.message}`);
    }

    try {
      await timedStep(run_id, "dm_coverage", async () => {
        const r = await runDMCoverage({ top: config.top, limit: config.limit });
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "dm_coverage",
          company: `${r.companiesEnriched} enriched, ${r.companiesReady} ready`,
          ts: Date.now(),
        });
        return r;
      });
    } catch (e: any) {
      errors.push(`DM Coverage: ${e.message}`);
    }

    try {
      await timedStep(run_id, "dm_fit", async () => {
        const r = await runDMFit();
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "dm_fit",
          company: `${r.offerDMSelected}/${r.totalCompanies} selected`,
          ts: Date.now(),
        });
        return r;
      });
    } catch (e: any) {
      errors.push(`DM Fit: ${e.message}`);
    }

    if (config.playbooks) {
      try {
        await timedStep(run_id, "playbooks", async () => {
          const r = await generatePlaybooksForTodayList({ limit: config.top, force: false });
          eventBus.publish("TRIGGER_FIRED", {
            trigger: "playbooks",
            company: `${r.generated} generated, ${r.skipped} skipped`,
            ts: Date.now(),
          });
          return r;
        });
      } catch (e: any) {
        errors.push(`Playbooks: ${e.message}`);
      }
    }

    try {
      await timedStep(run_id, "call_engine", async () => {
        const r = await runCallEngine();
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "call_engine",
          company: `${r.calls_processed} calls processed`,
          ts: Date.now(),
        });
        return r;
      });
    } catch (e: any) {
      errors.push(`Call Engine: ${e.message}`);
    }

    try {
      await timedStep(run_id, "query_intel", async () => {
        const r = await runQueryIntel({
          generate: config.generate,
          targetFresh: config.targetFresh,
          market: config.market,
        });
        eventBus.publish("TRIGGER_FIRED", {
          trigger: "query_intel",
          company: `fresh=${r.freshCount}, inserted=${r.queriesInserted}`,
          ts: Date.now(),
        });
        return r;
      });
    } catch (e: any) {
      errors.push(`Query Intel: ${e.message}`);
    }

    const status = errors.length > 0 ? "error" as const : "completed" as const;
    completeRun(run_id, { finished_at: Date.now(), errors, status, summary: { errors_count: errors.length } });
    eventBus.publish("RUN_DONE", { run_id, ts: Date.now(), status });
    log(`Web run ${run_id} finished: ${status} (${errors.length} errors)`, "daily-web");
  } catch (e: any) {
    completeRun(run_id, { finished_at: Date.now(), errors: [...errors, e.message], status: "error" });
    eventBus.publish("RUN_DONE", { run_id, ts: Date.now(), status: "error" });
    log(`Web run ${run_id} crashed: ${e.message}`, "daily-web");
  } finally {
    isRunning = false;
    currentRunId = null;
  }
}
