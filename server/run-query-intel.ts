import { runQueryIntel, type QueryIntelConfig } from "./query-intel";

function parseArgs(): QueryIntelConfig {
  const args = process.argv.slice(2);
  const config: QueryIntelConfig = {
    generate: 20,
    targetFresh: 100,
    market: "Gulf Coast",
  };

  for (const arg of args) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    if (!val) continue;
    switch (key) {
      case "generate": config.generate = parseInt(val, 10) || 20; break;
      case "targetFresh": config.targetFresh = parseInt(val, 10) || 100; break;
      case "market": config.market = val; break;
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();

  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║      QUERY INTELLIGENCE ENGINE       ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  console.log(`Config: generate=${config.generate} targetFresh=${config.targetFresh} market="${config.market}"`);
  console.log("");

  try {
    const result = await runQueryIntel(config);

    console.log("");
    console.log("═══════════════ SUMMARY ═══════════════");
    console.log(`  Fresh pool:              ${result.freshCount}`);
    console.log(`  Fresh needed:            ${result.freshNeeded}`);
    console.log(`  Win flags updated:       ${result.winFlagUpdated}`);
    console.log(`  Query stats updated:     ${result.queryStatsUpdated}`);
    console.log(`  Attribution mode:        ${result.attributionMode}`);
    console.log(`  Queries generated:       ${result.queriesGenerated}`);
    console.log(`  Queries inserted:        ${result.queriesInserted}`);
    console.log(`  Queries skipped (dupes): ${result.queriesSkippedDuplicates}`);
    console.log(`  Queries retired:         ${result.queriesRetired}`);
    console.log("═══════════════════════════════════════");

    if (result.freshNeeded > 0) {
      console.log("");
      console.log(`⚠ FRESHNESS_ALERT: ${result.freshNeeded} more fresh leads needed`);
      if (result.queriesInserted > 0) {
        console.log(`  → ${result.queriesInserted} new queries queued — run lead-feed to pull leads`);
      }
    }

    console.log("");
    process.exit(0);
  } catch (e: any) {
    console.error("Query intelligence engine failed:", e.message);
    process.exit(1);
  }
}

main();
