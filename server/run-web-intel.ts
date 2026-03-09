import { runWebIntelForTodayList, gatherCompanyIntel } from "./web-intel";

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1]) : 25;
const companyArg = args.find(a => a.startsWith("--company="));
const singleCompany = companyArg ? companyArg.split("=").slice(1).join("=") : null;
const forceArg = args.includes("--force");

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║       WEB INTEL GATHERER             ║");
  console.log("╚══════════════════════════════════════╝");
  console.log();

  if (singleCompany) {
    console.log(`Single company mode: "${singleCompany}" (preview only, no Airtable update)`);
    const result = await gatherCompanyIntel(
      "preview",
      singleCompany,
      null,
      "",
      "",
      "",
      "",
      true
    );
    console.log("\nResult:");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Config: limit=${limit}${forceArg ? " force=true" : ""}`);
  console.log();

  const result = await runWebIntelForTodayList(limit, forceArg);

  console.log();
  console.log("═══════════════ SUMMARY ═══════════════");
  console.log(`  Companies processed: ${result.processed}`);
  console.log(`  Intel updated:       ${result.updated}`);
  console.log(`  Errors:              ${result.errors}`);
  console.log("═══════════════════════════════════════");
  console.log();

  console.log("INTEL DETAILS:");
  console.log("────────────────────────────────────────");
  for (const r of result.results) {
    const status = r.error ? `ERROR: ${r.error}` : r.updated ? "updated" : "skipped";
    console.log(`  ${r.updated ? "\u2713" : "\u2717"} ${r.companyName} [${status}]`);
    if (r.intel.summary) {
      console.log(`    Intel: ${r.intel.summary.slice(0, 120)}...`);
    }
    if (r.intel.talkingPoints.length > 0) {
      console.log(`    Talk: ${r.intel.talkingPoints[0].slice(0, 100)}...`);
    }
    console.log(`    Confidence: ${r.intel.confidence}`);
    console.log();
  }
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
