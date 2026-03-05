import { runEngine } from "./call-engine";

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║        CALL OUTCOME ENGINE           ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");

  try {
    const result = await runEngine();

    console.log("");
    console.log("═══════════════ SUMMARY ═══════════════");
    console.log(`  Calls processed:      ${result.calls_processed}`);
    console.log(`  Companies updated:    ${result.companies_updated}`);
    console.log(`  Follow-ups scheduled: ${result.followups_scheduled}`);
    console.log(`  Gatekeepers recorded: ${result.gatekeepers_recorded}`);
    console.log("═══════════════════════════════════════");

    if (result.details.length > 0) {
      console.log("");
      console.log("DETAILS:");
      for (const d of result.details) {
        const status = d.error ? `ERROR: ${d.error}` : "OK";
        const parts = [`  ${d.company} — ${d.outcome} → ${status}`];
        if (d.leadStatusSet) parts.push(`    Lead_Status → ${d.leadStatusSet}`);
        if (d.followupDate) parts.push(`    Next_Followup → ${d.followupDate.split("T")[0]}`);
        if (d.engagementDelta) parts.push(`    Engagement ${d.engagementDelta > 0 ? "+" : ""}${d.engagementDelta}`);
        if (d.gatekeeperRecorded) parts.push(`    Gatekeeper → ${d.gatekeeperRecorded}`);
        console.log(parts.join("\n"));
      }
    }

    console.log("");
    process.exit(0);
  } catch (e: any) {
    console.error("Call engine failed:", e.message);
    process.exit(1);
  }
}

main();
