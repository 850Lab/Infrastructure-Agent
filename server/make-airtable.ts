import { log } from "./index";
import type { MakeScenario, MakeModule, MakeRun } from "./make";
import type { AuditFinding } from "./make-audit";
import { formatSchedule } from "./make";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

async function writeAirtableRecords(tableName: string, records: Array<{ fields: Record<string, any> }>): Promise<void> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error("Airtable credentials not configured");
  }

  const batchSize = 10;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: batch }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable write error for ${tableName} (${res.status}): ${text}`);
    }
  }
  log(`Wrote ${records.length} records to ${tableName}`, "make-airtable");
}

async function clearAirtableTable(tableName: string): Promise<void> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) return;

  let totalCleared = 0;
  let hasMore = true;

  while (hasMore) {
    const listUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}?pageSize=100`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });

    if (!listRes.ok) return;

    const data = await listRes.json();
    const ids: string[] = (data.records || []).map((r: any) => r.id);

    if (ids.length === 0) {
      hasMore = false;
      break;
    }

    const batchSize = 10;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const params = batch.map(id => `records[]=${id}`).join("&");
      const deleteUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}?${params}`;
      await fetch(deleteUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
    }

    totalCleared += ids.length;
    if (ids.length < 100) hasMore = false;
  }

  if (totalCleared > 0) {
    log(`Cleared ${totalCleared} records from ${tableName}`, "make-airtable");
  }
}

export async function syncScenariosToAirtable(scenarios: MakeScenario[]): Promise<void> {
  await clearAirtableTable("Make_Scenarios");
  const records = scenarios.map(s => ({
    fields: {
      make_scenario_id: String(s.id),
      name: s.name,
      is_active: s.isEnabled,
      schedule_summary: formatSchedule(s),
      folder: s.folderId ? String(s.folderId) : "",
      last_run_status: s.lastRun?.status || "",
      last_run_at: s.lastRun?.finishedAt || null,
      updated_at: s.updatedAt || null,
    },
  }));
  await writeAirtableRecords("Make_Scenarios", records);
}

export async function syncModulesToAirtable(
  scenarioId: number,
  modules: MakeModule[],
  graphSummary: string
): Promise<void> {
  const records = modules.map(m => ({
    fields: {
      make_scenario_id: String(scenarioId),
      module_id: String(m.id),
      module_type: m.module,
      module_name: m.name || m.module,
      connections: m.mapper ? JSON.stringify(m.mapper).slice(0, 10000) : "",
      key_mappings_summary: graphSummary,
    },
  }));
  if (records.length > 0) {
    await writeAirtableRecords("Make_Modules", records);
  }
}

export async function clearModulesTable(): Promise<void> {
  await clearAirtableTable("Make_Modules");
}

export async function syncRunsToAirtable(runs: MakeRun[]): Promise<void> {
  const records = runs.map(r => ({
    fields: {
      make_scenario_id: String(r.scenarioId),
      run_id: String(r.id),
      status: r.status,
      started_at: r.startedAt || null,
      finished_at: r.finishedAt || null,
      error_summary: r.error || "",
    },
  }));
  if (records.length > 0) {
    await writeAirtableRecords("Make_Runs", records);
  }
}

export async function clearRunsTable(): Promise<void> {
  await clearAirtableTable("Make_Runs");
}

export async function syncFindingsToAirtable(findings: AuditFinding[]): Promise<void> {
  await clearAirtableTable("Make_Audit_Findings");
  const records = findings.map(f => ({
    fields: {
      make_scenario_id: String(f.scenarioId),
      scenario_name: f.scenarioName,
      finding_type: f.findingType,
      severity: f.severity,
      description: f.description,
    },
  }));
  if (records.length > 0) {
    await writeAirtableRecords("Make_Audit_Findings", records);
  }
}
