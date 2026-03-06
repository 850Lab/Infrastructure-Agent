import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";
import { log } from "./logger";

const TABLE_MAP: Record<string, { table: string; fields: string[] }> = {
  companies: {
    table: "Companies",
    fields: ["Company_Name", "Phone", "Lead_Status", "Bucket", "Times_Called", "Last_Outcome", "Final_Priority", "Today_Call_List", "Offer_DM_Name", "Offer_DM_Title"],
  },
  calls: {
    table: "Calls",
    fields: ["Company_Name", "Outcome", "Notes", "Transcription_Summary", "Called_At", "Duration_Seconds"],
  },
  decision_makers: {
    table: "Decision_Makers",
    fields: ["Full_Name", "Title", "Email", "Phone", "Company_Name", "LinkedIn_URL", "Source"],
  },
  opportunities: {
    table: "Opportunities",
    fields: ["Company", "Stage", "Notes", "Next_Action", "Next_Action_Due", "Value"],
  },
  queries: {
    table: "Search_Queries",
    fields: ["Query", "Status", "Result_Count", "Last_Run"],
  },
};

async function fetchAllRecords(clientId: string, tableName: string, fields: string[]): Promise<any[]> {
  const { apiKey, baseId } = await getClientAirtableConfig(clientId);
  if (!apiKey || !baseId) return [];

  const formula = scopedFormula(clientId);
  const records: any[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({
      filterByFormula: formula,
      pageSize: "100",
    });
    for (const f of fields) params.append("fields[]", f);
    if (offset) params.set("offset", offset);

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

function escapeCsvField(val: any): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportTableCSV(clientId: string, type: string): Promise<string> {
  const config = TABLE_MAP[type];
  if (!config) throw new Error(`Unknown export type: ${type}`);

  const records = await fetchAllRecords(clientId, config.table, config.fields);
  log(`Export ${type}: ${records.length} records for client ${clientId}`, "export");

  const header = config.fields.map(escapeCsvField).join(",");
  const rows = records.map(r => {
    return config.fields.map(f => escapeCsvField(r.fields?.[f])).join(",");
  });

  return [header, ...rows].join("\n");
}
