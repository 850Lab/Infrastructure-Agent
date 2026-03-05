import { runOpportunityEngine, type EngineResult as OEResult } from "./opportunity-engine";
import { runDMCoverage, type CoverageResult } from "./dm-coverage";
import { runEngine as runCallEngine } from "./call-engine";
import { runQueryIntel, type QueryIntelResult } from "./query-intel";
import { ensureSchema, formatReport } from "./airtable-schema";
import { log } from "./logger";

interface DailyConfig {
  top: number;
  limit: number;
  targetFresh: number;
  generate: number;
  market: string;
  bootstrap: boolean;
}

interface StepResult {
  step: string;
  status: "ok" | "error" | "skipped";
  durationMs: number;
  error?: string;
}

function parseArgs(): DailyConfig {
  const args = process.argv.slice(2);
  const config: DailyConfig = {
    top: 25,
    limit: 25,
    targetFresh: 100,
    generate: 20,
    market: "Gulf Coast",
    bootstrap: false,
  };

  for (const arg of args) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    if (!val) continue;
    switch (key) {
      case "top": config.top = parseInt(val, 10) || 25; break;
      case "limit": config.limit = parseInt(val, 10) || 25; break;
      case "targetFresh": config.targetFresh = parseInt(val, 10) || 100; break;
      case "generate": config.generate = parseInt(val, 10) || 20; break;
      case "market": config.market = val; break;
      case "bootstrap": config.bootstrap = val === "true"; break;
    }
  }

  return config;
}

async function timed<T>(stepName: string, fn: () => Promise<T>): Promise<{ result: T; step: StepResult }> {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      result,
      step: { step: stepName, status: "ok", durationMs: Date.now() - start },
    };
  } catch (e: any) {
    throw Object.assign(e, { stepResult: { step: stepName, status: "error" as const, durationMs: Date.now() - start, error: e.message } });
  }
}

async function main() {
  const config = parseArgs();

  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║        DAILY ORCHESTRATOR            ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  console.log(`Config: top=${config.top} limit=${config.limit} targetFresh=${config.targetFresh} generate=${config.generate} market="${config.market}" bootstrap=${config.bootstrap}`);
  console.log("");

  const steps: StepResult[] = [];
  const errors: string[] = [];

  let oeResult: OEResult | null = null;
  let coverageResult: CoverageResult | null = null;
  let callResult: { calls_processed: number; companies_updated: number; followups_scheduled: number; gatekeepers_recorded: number } | null = null;
  let queryResult: QueryIntelResult | null = null;
  let querySkipped = false;

  if (config.bootstrap) {
    log("STEP 0: Bootstrap schema...", "daily");
    const start = Date.now();
    try {
      const report = await ensureSchema();
      const created = report.fields_created.length + report.tables_created.length;
      log(`Bootstrap done: ${created} items created`, "daily");
      steps.push({ step: "Bootstrap", status: "ok", durationMs: Date.now() - start });
    } catch (e: any) {
      log(`Bootstrap failed: ${e.message}`, "daily");
      steps.push({ step: "Bootstrap", status: "error", durationMs: Date.now() - start, error: e.message });
      errors.push(`Bootstrap: ${e.message}`);
    }
  }

  log("STEP 1: Generate today's call list...", "daily");
  {
    const start = Date.now();
    try {
      oeResult = await runOpportunityEngine({
        top: config.top,
        pctHot: 0.4,
        pctWorking: 0.35,
        pctFresh: 0.25,
      });
      const total = oeResult.hot_selected + oeResult.working_selected + oeResult.fresh_selected + oeResult.score_fill_selected;
      log(`Call list built: ${total} companies (hot=${oeResult.hot_selected} working=${oeResult.working_selected} fresh=${oeResult.fresh_selected})`, "daily");
      steps.push({ step: "Opportunity Engine", status: "ok", durationMs: Date.now() - start });
    } catch (e: any) {
      log(`Opportunity engine failed: ${e.message}`, "daily");
      steps.push({ step: "Opportunity Engine", status: "error", durationMs: Date.now() - start, error: e.message });
      errors.push(`Opportunity Engine: ${e.message}`);
    }
  }

  log("STEP 2: DM coverage for today's list...", "daily");
  {
    const start = Date.now();
    try {
      coverageResult = await runDMCoverage({ top: config.top, limit: config.limit });
      log(`DM coverage done: ${coverageResult.companiesEnriched} enriched, ${coverageResult.companiesReady} ready`, "daily");
      steps.push({ step: "DM Coverage", status: "ok", durationMs: Date.now() - start });
    } catch (e: any) {
      log(`DM coverage failed: ${e.message}`, "daily");
      steps.push({ step: "DM Coverage", status: "error", durationMs: Date.now() - start, error: e.message });
      errors.push(`DM Coverage: ${e.message}`);
    }
  }

  log("STEP 3: Process call outcomes...", "daily");
  {
    const start = Date.now();
    try {
      callResult = await runCallEngine();
      log(`Calls processed: ${callResult.calls_processed} (followups=${callResult.followups_scheduled}, gatekeepers=${callResult.gatekeepers_recorded})`, "daily");
      steps.push({ step: "Call Engine", status: "ok", durationMs: Date.now() - start });
    } catch (e: any) {
      log(`Call engine failed: ${e.message}`, "daily");
      steps.push({ step: "Call Engine", status: "error", durationMs: Date.now() - start, error: e.message });
      errors.push(`Call Engine: ${e.message}`);
    }
  }

  log("STEP 4: Freshness guardrail + query intelligence...", "daily");
  {
    const start = Date.now();
    try {
      queryResult = await runQueryIntel({
        generate: config.generate,
        targetFresh: config.targetFresh,
        market: config.market,
      });

      if (queryResult.freshNeeded <= 0) {
        querySkipped = true;
        log(`Freshness OK: ${queryResult.freshCount} fresh leads (target ${config.targetFresh})`, "daily");
        steps.push({ step: "Query Intel", status: "skipped", durationMs: Date.now() - start });
      } else {
        log(`Query intel ran: ${queryResult.queriesInserted} inserted, ${queryResult.queriesRetired} retired`, "daily");
        steps.push({ step: "Query Intel", status: "ok", durationMs: Date.now() - start });
      }
    } catch (e: any) {
      log(`Query intel failed: ${e.message}`, "daily");
      steps.push({ step: "Query Intel", status: "error", durationMs: Date.now() - start, error: e.message });
      errors.push(`Query Intel: ${e.message}`);
    }
  }

  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║       DAILY HEALTH REPORT            ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");

  if (oeResult) {
    const total = oeResult.hot_selected + oeResult.working_selected + oeResult.fresh_selected + oeResult.score_fill_selected;
    console.log(`  Today list: ${total} (hot:${oeResult.hot_selected} working:${oeResult.working_selected} fresh:${oeResult.fresh_selected})`);
  } else {
    console.log("  Today list: FAILED");
  }

  if (coverageResult) {
    const dmFound = coverageResult.dmResolution?.companiesWithDM ?? coverageResult.companiesReady;
    const dmTotal = coverageResult.companiesOnList;
    const avgConf = coverageResult.dmResolution?.avgConfidence ?? 0;
    console.log(`  DMs resolved: ${dmFound}/${dmTotal} (avg confidence ${avgConf}%)`);
  } else {
    console.log("  DMs resolved: FAILED");
  }

  if (callResult) {
    console.log(`  Calls processed: ${callResult.calls_processed} (followups scheduled ${callResult.followups_scheduled})`);
  } else {
    console.log("  Calls processed: FAILED");
  }

  if (queryResult) {
    console.log(`  Fresh pool: ${queryResult.freshCount} (target ${config.targetFresh})`);
    if (querySkipped) {
      console.log(`  Query intel: skipped (freshness OK)`);
    } else {
      console.log(`  Query intel: ran (inserted ${queryResult.queriesInserted}, retired ${queryResult.queriesRetired})`);
    }
  } else {
    console.log("  Fresh pool: UNKNOWN");
    console.log("  Query intel: FAILED");
  }

  console.log(`  Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log("");
    console.log("  ERROR DETAILS:");
    for (const err of errors) {
      console.log(`    - ${err}`);
    }
  }

  console.log("");
  console.log("  STEP TIMING:");
  for (const s of steps) {
    const statusIcon = s.status === "ok" ? "✓" : s.status === "skipped" ? "○" : "✗";
    console.log(`    ${statusIcon} ${s.step}: ${(s.durationMs / 1000).toFixed(1)}s`);
  }

  const totalMs = steps.reduce((sum, s) => sum + s.durationMs, 0);
  console.log(`    Total: ${(totalMs / 1000).toFixed(1)}s`);

  console.log("");
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
