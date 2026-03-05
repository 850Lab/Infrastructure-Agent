import { ensureSchema, formatReport } from "./airtable-schema";

async function main() {
  console.log("");
  console.log("=== Airtable Schema Bootstrap ===");
  console.log("");

  try {
    const report = await ensureSchema();
    console.log("");
    console.log(formatReport(report));
    console.log("");
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  } catch (e: any) {
    console.error("Bootstrap failed:", e.message);
    process.exit(1);
  }
}

main();
