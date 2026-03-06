import { log } from "./logger";

const TABLES_TO_MIGRATE = [
  "Companies",
  "Calls",
  "Decision_Makers",
  "Search_Queries",
  "Opportunities",
  "Run_History",
];

async function airtableRequest(baseId: string, apiKey: string, pathStr: string, options: RequestInit = {}): Promise<any> {
  const url = `https://api.airtable.com/v0/${baseId}/${pathStr}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function migrateClientData(clientId: string): Promise<{ table: string; tagged: number; skipped: number; errors: string[] }[]> {
  const apiKey = process.env.AIRTABLE_API_KEY || "";
  const baseId = process.env.AIRTABLE_BASE_ID || "";
  if (!apiKey || !baseId) throw new Error("Airtable credentials not configured");

  const results: { table: string; tagged: number; skipped: number; errors: string[] }[] = [];

  for (const tableName of TABLES_TO_MIGRATE) {
    const tableResult = { table: tableName, tagged: 0, skipped: 0, errors: [] as string[] };
    log(`Migrating ${tableName} for client ${clientId}...`, "migration");

    try {
      const records: any[] = [];
      let offset: string | undefined;

      do {
        const params = new URLSearchParams({
          pageSize: "100",
          "fields[]": "Client_ID",
        });
        if (offset) params.set("offset", offset);
        const encoded = encodeURIComponent(tableName);
        const data = await airtableRequest(baseId, apiKey, `${encoded}?${params}`);
        records.push(...(data.records || []));
        offset = data.offset;
      } while (offset);

      const untagged = records.filter(r => !r.fields?.Client_ID);
      tableResult.skipped = records.length - untagged.length;

      for (let i = 0; i < untagged.length; i += 10) {
        const batch = untagged.slice(i, i + 10);
        const updateRecords = batch.map(r => ({
          id: r.id,
          fields: { Client_ID: clientId },
        }));

        try {
          const encoded = encodeURIComponent(tableName);
          await airtableRequest(baseId, apiKey, encoded, {
            method: "PATCH",
            body: JSON.stringify({ records: updateRecords }),
          });
          tableResult.tagged += batch.length;
        } catch (e: any) {
          tableResult.errors.push(`Batch ${i}: ${e.message}`);
        }
      }
    } catch (e: any) {
      tableResult.errors.push(e.message);
    }

    results.push(tableResult);
    log(`${tableName}: tagged=${tableResult.tagged}, skipped=${tableResult.skipped}, errors=${tableResult.errors.length}`, "migration");
  }

  return results;
}
