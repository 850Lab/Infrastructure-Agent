import { runOpportunityEngine, type BucketConfig } from "./opportunity-engine";

function parseArgs(): BucketConfig {
  const args = process.argv.slice(2);
  const config: BucketConfig = {
    top: 25,
    pctHot: 0.4,
    pctWorking: 0.35,
    pctFresh: 0.25,
  };

  for (const arg of args) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    if (!val) continue;
    switch (key) {
      case "top": config.top = parseInt(val, 10) || 25; break;
      case "pctHot": config.pctHot = parseFloat(val) || 0.4; break;
      case "pctWorking": config.pctWorking = parseFloat(val) || 0.35; break;
      case "pctFresh": config.pctFresh = parseFloat(val) || 0.25; break;
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();

  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║     OPPORTUNITY ENGINE + AUDITOR     ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  console.log(`Config: top=${config.top} hot=${(config.pctHot * 100).toFixed(0)}% working=${(config.pctWorking * 100).toFixed(0)}% fresh=${(config.pctFresh * 100).toFixed(0)}%`);
  console.log("");

  try {
    const result = await runOpportunityEngine(config);

    console.log("");
    console.log("═══════════════ SUMMARY ═══════════════");
    console.log(`  Top requested:        ${result.top_requested}`);
    console.log(`  Hot Follow-up:        ${result.hot_selected}`);
    console.log(`  Working:              ${result.working_selected}`);
    console.log(`  Fresh:                ${result.fresh_selected}`);
    console.log(`  Score fill:           ${result.score_fill_selected}`);
    console.log(`  Overdue included:     ${result.overdue_followups_included}`);
    console.log(`  Companies updated:    ${result.companies_updated}`);
    console.log(`  Rank reasons written: ${result.rank_writes}`);
    console.log(`  Rank reasons skipped: ${result.rank_skipped} (idempotent)`);
    console.log("═══════════════════════════════════════");

    if (result.freshness_alert.triggered) {
      console.log("");
      console.log(`⚠ FRESHNESS_ALERT: Need ${result.freshness_alert.required} fresh leads, only ${result.freshness_alert.available} available`);
      console.log("  → Enqueue more search queries to replenish fresh lead pool");
    }

    if (result.slip_alert.triggered) {
      console.log("");
      console.log(`⚠ SLIP_ALERT: ${result.slip_alert.overdue_count} overdue follow-ups detected — force-included in today's list`);
    }

    if (result.dm_resolution) {
      const dm = result.dm_resolution;
      console.log("");
      console.log("═══════ DECISION MAKER RESOLUTION ═══════");
      console.log(`  Companies on list:    ${dm.companiesOnList}`);
      console.log(`  DM found:             ${dm.companiesWithDM}`);
      console.log(`  DM missing:           ${dm.companiesMissingDM}`);
      console.log(`  Avg confidence:       ${dm.avgConfidence}%`);
      console.log("═════════════════════════════════════════");
    }

    if (result.details.length > 0) {
      console.log("");
      console.log("TODAY'S CALL LIST:");
      console.log("─".repeat(80));

      const dmMap = new Map<string, { dmName: string; dmTitle: string; confidence: number }>();
      if (result.dm_resolution) {
        for (const u of result.dm_resolution.updates) {
          dmMap.set(u.companyName, { dmName: u.dmName, dmTitle: u.dmTitle || "", confidence: u.confidence });
        }
      }

      let currentBucket = "";
      for (const d of result.details) {
        if (d.bucket !== currentBucket) {
          currentBucket = d.bucket;
          console.log(`\n  [${currentBucket.toUpperCase()}]`);
        }
        const overdueTag = d.overdue ? " ⚠OVERDUE" : "";
        const followup = d.followupDue ? ` followup=${d.followupDue.split("T")[0]}` : "";

        console.log(`    ${d.companyName} (priority=${d.finalPriority}${followup}${overdueTag})`);

        const dmInfo = dmMap.get(d.companyName);
        const dmName = dmInfo?.dmName || d.primaryDMName;
        const dmTitle = dmInfo?.dmTitle || d.primaryDMTitle;
        if (dmName) {
          const titleStr = dmTitle ? ` – ${dmTitle}` : "";
          console.log(`      Ask For: ${dmName}${titleStr}`);
        }

        if (d.gatekeeperName) {
          console.log(`      Gatekeeper: ${d.gatekeeperName}`);
        }

        if (d.phone) {
          console.log(`      Phone: ${d.phone}`);
        }

        if (d.primaryDMEmail) {
          console.log(`      Email: ${d.primaryDMEmail}`);
        }

        if (d.rankReason) {
          const truncated = d.rankReason.length > 90 ? d.rankReason.slice(0, 87) + "..." : d.rankReason;
          console.log(`      Why: ${truncated}`);
        }
      }
    }

    console.log("");
    process.exit(0);
  } catch (e: any) {
    console.error("Opportunity engine failed:", e.message);
    process.exit(1);
  }
}

main();
