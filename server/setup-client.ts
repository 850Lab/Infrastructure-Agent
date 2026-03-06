import { ensureSchema, formatReport } from "./airtable-schema";
import { getIndustryConfig } from "./config";
import { runOpportunityEngine } from "./opportunity-engine";
import { runDMFit } from "./dm-fit";
import { generatePlaybooksForTodayList } from "./playbooks";
import type { IndustryConfig } from "../config/types";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

interface SetupConfig {
  seed: boolean;
  smoke: boolean;
  top: number;
  market: string | null;
}

function parseArgs(): SetupConfig {
  const args = process.argv.slice(2);
  const config: SetupConfig = {
    seed: true,
    smoke: true,
    top: 10,
    market: null,
  };

  for (const arg of args) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    if (!val) continue;
    switch (key) {
      case "seed": config.seed = val === "true"; break;
      case "smoke": config.smoke = val === "true"; break;
      case "top": config.top = parseInt(val, 10) || 10; break;
      case "market": config.market = val; break;
    }
  }

  return config;
}

function logSetup(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [setup] ${message}`);
}

async function airtableRequest(path: string, options: RequestInit = {}): Promise<any> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) throw new Error("Airtable credentials not configured");
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

function step1_validateEnv(): { ok: boolean; missing: string[] } {
  const required = ["AIRTABLE_API_KEY", "AIRTABLE_BASE_ID", "OPENAI_API_KEY"];
  const optional = ["OUTSCRAPER_API_KEY", "APOLLO_API_KEY"];
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of required) {
    if (!process.env[key]) missing.push(key);
  }

  for (const key of optional) {
    if (!process.env[key]) warnings.push(key);
  }

  console.log("");
  console.log("  STEP 1: Environment Validation");
  console.log("  ─────────────────────────────────");

  for (const key of required) {
    const present = !!process.env[key];
    console.log(`    ${present ? "✓" : "✗"} ${key}: ${present ? "present" : "MISSING"}`);
  }

  for (const key of optional) {
    const present = !!process.env[key];
    console.log(`    ${present ? "✓" : "○"} ${key}: ${present ? "present" : "not set (optional)"}`);
  }

  if (missing.length > 0) {
    console.log(`\n    ERROR: Missing required env vars: ${missing.join(", ")}`);
  }

  return { ok: missing.length === 0, missing };
}

async function step2_bootstrap(): Promise<{ ok: boolean; tablesCreated: number; fieldsCreated: number }> {
  console.log("");
  console.log("  STEP 2: Schema Bootstrap");
  console.log("  ─────────────────────────────────");

  try {
    const report = await ensureSchema();
    const tablesCreated = report.tables_created.length;
    const fieldsCreated = report.fields_created.length;
    const mismatches = report.type_mismatches.length;

    console.log(`    ✓ Tables created: ${tablesCreated}`);
    console.log(`    ✓ Fields created: ${fieldsCreated}`);
    if (mismatches > 0) {
      console.log(`    ○ Type mismatches: ${mismatches} (non-blocking)`);
    }
    console.log(`    ✓ Schema is ready`);

    return { ok: true, tablesCreated, fieldsCreated };
  } catch (e: any) {
    console.log(`    ✗ Bootstrap failed: ${e.message}`);
    return { ok: false, tablesCreated: 0, fieldsCreated: 0 };
  }
}

function step3_config(cfg: IndustryConfig): void {
  console.log("");
  console.log("  STEP 3: Industry Configuration");
  console.log("  ─────────────────────────────────");
  console.log(`    Name:           ${cfg.name}`);
  console.log(`    Market:         ${cfg.market}`);
  console.log(`    Categories:     ${cfg.company_categories.length} (${cfg.company_categories.slice(0, 3).join(", ")}...)`);
  console.log(`    Keywords:       ${cfg.opportunity_keywords.length} (${cfg.opportunity_keywords.slice(0, 4).join(", ")}...)`);
  console.log(`    Tier 1 titles:  ${cfg.decision_maker_titles_tiers.tier1.join(", ")}`);
  console.log(`    Geo cities:     ${cfg.geo.cities.length}`);
  console.log(`    ✓ Config loaded`);
}

async function step4_seedQueries(cfg: IndustryConfig): Promise<{ seeded: number }> {
  console.log("");
  console.log("  STEP 4: Seed Search Queries");
  console.log("  ─────────────────────────────────");

  const table = encodeURIComponent("Search_Queries");
  const formula = encodeURIComponent(`NOT({Status}="Retired")`);

  try {
    const data = await airtableRequest(`${table}?pageSize=1&filterByFormula=${formula}`);
    const existingCount = (data.records || []).length;

    if (existingCount > 0) {
      console.log(`    ○ Search_Queries already has active records — skipping seed`);
      return { seeded: 0 };
    }

    const seeds: Array<{ query: string; category: string }> = [];
    const cities = cfg.geo.cities.slice(0, 3);
    const categories = cfg.company_categories.slice(0, 4);

    for (const tmpl of cfg.search_templates.slice(0, 5)) {
      const city = cities[seeds.length % cities.length];
      const cat = categories[seeds.length % categories.length];
      seeds.push({
        query: tmpl.replace("{city}", city).replace("{category}", cat),
        category: cat,
      });
    }

    for (const cs of cfg.cold_start_queries.slice(0, 5)) {
      if (!seeds.some(s => s.query === cs.query)) {
        seeds.push({ query: cs.query, category: cs.category });
      }
    }

    const toInsert = seeds.slice(0, 10);

    const batchSize = 10;
    let inserted = 0;

    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      const records = batch.map(s => ({
        fields: {
          Query_Text: s.query,
          Category: s.category,
          Status: "Queued",
          Last_Generated_By: "SetupWizard",
          Generation_Mode: "ColdStart",
          Notes: "seed",
        },
      }));

      try {
        await airtableRequest(table, {
          method: "POST",
          body: JSON.stringify({ records }),
        });
        inserted += batch.length;
      } catch (e: any) {
        console.log(`    ✗ Seed insert error: ${e.message}`);
      }
    }

    console.log(`    ✓ Seeded ${inserted} search queries`);
    for (const s of toInsert) {
      console.log(`      • ${s.query} [${s.category}]`);
    }

    return { seeded: inserted };
  } catch (e: any) {
    console.log(`    ✗ Seed failed: ${e.message}`);
    return { seeded: 0 };
  }
}

async function step5_smokeTests(cfg: IndustryConfig, top: number): Promise<{ passed: number; failed: number; errors: string[] }> {
  console.log("");
  console.log("  STEP 5: Smoke Tests");
  console.log("  ─────────────────────────────────");

  let passed = 0;
  let failed = 0;
  const errors: string[] = [];
  const smokeTop = Math.min(top, 5);

  console.log(`    A) Opportunity Engine (top=${smokeTop})...`);
  try {
    const oeResult = await runOpportunityEngine({
      top: smokeTop,
      pctHot: 0.4,
      pctWorking: 0.35,
      pctFresh: 0.25,
    });
    const total = oeResult.hot_selected + oeResult.working_selected + oeResult.fresh_selected + oeResult.score_fill_selected;
    console.log(`       ✓ Selected ${total} companies, updated ${oeResult.companies_updated}`);
    passed++;
  } catch (e: any) {
    console.log(`       ✗ Failed: ${e.message}`);
    errors.push(`Opportunity Engine: ${e.message}`);
    failed++;
  }

  console.log(`    B) DM Fit...`);
  try {
    const fitResult = await runDMFit();
    console.log(`       ✓ ${fitResult.offerDMSelected}/${fitResult.totalCompanies} offer DMs selected (avg fit=${fitResult.avgFitScore})`);
    passed++;
  } catch (e: any) {
    console.log(`       ✗ Failed: ${e.message}`);
    errors.push(`DM Fit: ${e.message}`);
    failed++;
  }

  console.log(`    C) Playbooks (limit=3)...`);
  try {
    const pbResult = await generatePlaybooksForTodayList({ limit: 3, force: false });
    console.log(`       ✓ ${pbResult.generated} generated, ${pbResult.skipped} skipped, ${pbResult.errors} errors`);
    passed++;
  } catch (e: any) {
    console.log(`       ✗ Failed: ${e.message}`);
    errors.push(`Playbooks: ${e.message}`);
    failed++;
  }

  console.log(`    D) Fresh pool check...`);
  try {
    const table = encodeURIComponent("Companies");
    const formula = encodeURIComponent(`AND({Lead_Status}="New",NOT({Today_Call_List}=TRUE()))`);
    const data = await airtableRequest(`${table}?pageSize=1&filterByFormula=${formula}`);
    const freshCount = data.records?.length > 0 ? "has records" : "empty";
    console.log(`       ✓ Companies table: ${freshCount}`);
    passed++;
  } catch (e: any) {
    console.log(`       ✗ Failed: ${e.message}`);
    errors.push(`Fresh pool: ${e.message}`);
    failed++;
  }

  return { passed, failed, errors };
}

async function main() {
  const config = parseArgs();

  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║     NEW CLIENT SETUP WIZARD          ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  logSetup(`Flags: seed=${config.seed} smoke=${config.smoke} top=${config.top}${config.market ? ` market=${config.market}` : ""}`);

  const envResult = step1_validateEnv();
  if (!envResult.ok) {
    console.log("");
    console.log("  SETUP ABORTED: Fix missing env vars and re-run.");
    console.log("");
    process.exit(1);
  }

  const bootstrapResult = await step2_bootstrap();

  const cfg = getIndustryConfig();
  step3_config(cfg);

  let seedResult = { seeded: 0 };
  if (config.seed) {
    seedResult = await step4_seedQueries(cfg);
  } else {
    console.log("");
    console.log("  STEP 4: Seed Queries (skipped — --seed=false)");
  }

  let smokeResult = { passed: 0, failed: 0, errors: [] as string[] };
  if (config.smoke) {
    smokeResult = await step5_smokeTests(cfg, config.top);
  } else {
    console.log("");
    console.log("  STEP 5: Smoke Tests (skipped — --smoke=false)");
  }

  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║     CLIENT READY REPORT              ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  console.log(`  Config:           ${cfg.name} (${cfg.market})`);
  console.log(`  Tables OK:        ${bootstrapResult.ok ? "yes" : "no"}`);
  console.log(`  Fields created:   ${bootstrapResult.fieldsCreated}`);
  console.log(`  Queries seeded:   ${seedResult.seeded}`);

  if (config.smoke) {
    const allPass = smokeResult.failed === 0;
    console.log(`  Smoke tests:      ${allPass ? "PASS" : "FAIL"} (${smokeResult.passed} passed, ${smokeResult.failed} failed)`);
    if (smokeResult.errors.length > 0) {
      console.log("");
      console.log("  SMOKE TEST ERRORS:");
      for (const err of smokeResult.errors) {
        console.log(`    - ${err}`);
      }
    }
  } else {
    console.log(`  Smoke tests:      skipped`);
  }

  console.log("");
  console.log("  NEXT STEPS:");
  console.log("  ─────────────────────────────────");
  console.log("  1) Populate companies: run lead feed or import CSV into Companies table");
  console.log("  2) Run daily orchestrator each morning:");
  console.log(`     npx tsx server/run-daily.ts --top=25`);
  console.log("  3) Log calls into the Calls table (manually or via webhook)");
  console.log("  4) Monitor fresh pool — if below 100, query intel will auto-generate queries");
  console.log("");

  const exitCode = smokeResult.failed > 0 ? 1 : 0;
  process.exit(exitCode);
}

main();
