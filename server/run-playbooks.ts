import { generatePlaybooksForTodayList, type PlaybookResult } from "./playbooks";

function parseArgs(): { limit: number; force: boolean } {
  const args = process.argv.slice(2);
  const config = { limit: 25, force: false };

  for (const arg of args) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    if (!val) continue;
    switch (key) {
      case "limit": config.limit = parseInt(val, 10) || 25; break;
      case "force": config.force = val === "true"; break;
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();

  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║        PLAYBOOK GENERATOR            ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  console.log(`Config: limit=${config.limit} force=${config.force}`);
  console.log("");

  try {
    const result = await generatePlaybooksForTodayList(config);

    console.log("");
    console.log("═══════════════ SUMMARY ═══════════════");
    console.log(`  Playbooks generated:  ${result.generated}`);
    console.log(`  Playbooks skipped:    ${result.skipped} (idempotent)`);
    console.log(`  Errors:               ${result.errors}`);
    console.log("═══════════════════════════════════════");

    if (result.details.length > 0) {
      console.log("");
      console.log("PLAYBOOK DETAILS:");
      console.log("─".repeat(80));

      for (const d of result.details) {
        const statusIcon = d.status === "generated" ? "✓" : d.status === "skipped" ? "○" : "✗";
        console.log(`  ${statusIcon} ${d.companyName} [${d.status}]`);

        if (d.callOpener) {
          const truncated = d.callOpener.length > 80 ? d.callOpener.slice(0, 77) + "..." : d.callOpener;
          console.log(`    Opener: ${truncated}`);
        }

        if (d.gatekeeperAsk) {
          const truncated = d.gatekeeperAsk.length > 60 ? d.gatekeeperAsk.slice(0, 57) + "..." : d.gatekeeperAsk;
          console.log(`    Gatekeeper: ${truncated}`);
        }
      }
    }

    console.log("");
    process.exit(result.errors > 0 ? 1 : 0);
  } catch (e: any) {
    console.error("Playbook generation failed:", e.message);
    process.exit(1);
  }
}

main();
