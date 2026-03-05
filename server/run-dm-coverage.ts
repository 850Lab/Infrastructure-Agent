import { runDMCoverage, type CoverageConfig } from "./dm-coverage";
import { runOpportunityEngine } from "./opportunity-engine";

function parseArgs(): CoverageConfig & { runOpportunity: boolean } {
  const args = process.argv.slice(2);
  const config = {
    top: 25,
    limit: 25,
    runOpportunity: false,
  };

  for (const arg of args) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    if (!val) continue;
    switch (key) {
      case "top": config.top = parseInt(val, 10) || 25; break;
      case "limit": config.limit = parseInt(val, 10) || 25; break;
      case "runOpportunity": config.runOpportunity = val === "true"; break;
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();

  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║       DM COVERAGE ENGINE             ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  console.log(`Config: top=${config.top} limit=${config.limit} runOpportunity=${config.runOpportunity}`);
  console.log("");

  try {
    if (config.runOpportunity) {
      console.log("Step 0: Running Opportunity Engine first...");
      console.log("");
      const oeResult = await runOpportunityEngine({
        top: config.top,
        pctHot: 0.4,
        pctWorking: 0.35,
        pctFresh: 0.25,
      });
      console.log(`  → Call list built: ${oeResult.hot_selected} hot, ${oeResult.working_selected} working, ${oeResult.fresh_selected} fresh`);
      console.log("");
    }

    console.log("Step 1: Detecting DM coverage gaps...");
    console.log("Step 2: Enriching queued companies...");
    console.log("Step 3: Resolving primary DMs...");
    console.log("");

    const result = await runDMCoverage({ top: config.top, limit: config.limit });

    console.log("");
    console.log("═══════════════ COVERAGE SUMMARY ═══════════════");
    console.log(`  Companies on list:      ${result.companiesOnList}`);
    console.log(`  Needed enrichment:      ${result.companiesNeedingEnrichment}`);
    console.log(`  Enriched this run:      ${result.companiesEnriched}`);
    console.log(`  DM ready:               ${result.companiesReady}`);
    console.log(`  DM missing:             ${result.companiesMissing}`);
    console.log(`  Errors:                 ${result.companiesErrored}`);
    console.log("═════════════════════════════════════════════════");

    if (result.dmResolution) {
      console.log("");
      console.log("═══════ DM RESOLUTION ═══════");
      console.log(`  Resolved:    ${result.dmResolution.companiesWithDM}/${result.dmResolution.companiesOnList}`);
      console.log(`  Avg conf:    ${result.dmResolution.avgConfidence}%`);
      console.log("═════════════════════════════");
    }

    if (result.callList.length > 0) {
      console.log("");
      console.log("TODAY'S CALL LIST WITH DECISION MAKERS:");
      console.log("─".repeat(120));
      console.log(
        padR("Company", 35) +
        padR("Priority", 10) +
        padR("Bucket", 16) +
        padR("DM Name", 25) +
        padR("DM Title", 30) +
        padR("Phone", 16) +
        "Email"
      );
      console.log("─".repeat(120));

      for (const c of result.callList) {
        console.log(
          padR(c.companyName.slice(0, 33), 35) +
          padR(String(c.finalPriority), 10) +
          padR(c.bucket, 16) +
          padR((c.primaryDMName || "—").slice(0, 23), 25) +
          padR((c.primaryDMTitle || "—").slice(0, 28), 30) +
          padR(c.primaryDMPhone || "—", 16) +
          (c.primaryDMEmail || "—")
        );
      }
      console.log("─".repeat(120));
    }

    console.log("");
    process.exit(0);
  } catch (e: any) {
    console.error("DM Coverage engine failed:", e.message);
    process.exit(1);
  }
}

function padR(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

main();
