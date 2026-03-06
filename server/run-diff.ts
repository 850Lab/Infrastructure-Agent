import { log } from "./logger";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

export interface RunSnapshot {
  companies_total: number;
  dms_total: number;
  today_call_list: number;
  offer_dm_filled: number;
  playbook_filled: number;
  queries_active: number;
  queries_retired: number;
  taken_at: number;
}

export interface RunDiff {
  companies_added: number;
  dms_added: number;
  today_call_list_delta: number;
  offer_dm_updated: number;
  playbooks_generated: number;
  queries_inserted: number;
  queries_retired: number;
  before: RunSnapshot;
  after: RunSnapshot;
}

async function airtableCount(table: string, formula?: string): Promise<number> {
  const key = AIRTABLE_API_KEY();
  const base = AIRTABLE_BASE_ID();
  if (!key || !base) return 0;

  let count = 0;
  let offset: string | undefined;

  try {
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (formula) params.set("filterByFormula", formula);
      if (offset) params.set("offset", offset);

      const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?${params}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return count;
      const data = await res.json();
      count += (data.records || []).length;
      offset = data.offset;
    } while (offset);
  } catch (e: any) {
    log(`Snapshot count error (${table}): ${e.message}`, "run-diff");
  }

  return count;
}

export async function takeSnapshot(): Promise<RunSnapshot> {
  const [
    companies_total,
    dms_total,
    today_call_list,
    offer_dm_filled,
    playbook_filled,
    queries_active,
    queries_retired,
  ] = await Promise.all([
    airtableCount("Companies"),
    airtableCount("Decision_Makers"),
    airtableCount("Companies", "{Today_Call_List}=TRUE()"),
    airtableCount("Companies", "NOT({Offer_DM_Name}='')"),
    airtableCount("Companies", "NOT({Playbook_Version}='')"),
    airtableCount("Search_Queries", "{Status}='active'"),
    airtableCount("Search_Queries", "{Status}='retired'"),
  ]);

  return {
    companies_total,
    dms_total,
    today_call_list,
    offer_dm_filled,
    playbook_filled,
    queries_active,
    queries_retired,
    taken_at: Date.now(),
  };
}

export function computeDiff(before: RunSnapshot, after: RunSnapshot): RunDiff {
  return {
    companies_added: Math.max(0, after.companies_total - before.companies_total),
    dms_added: Math.max(0, after.dms_total - before.dms_total),
    today_call_list_delta: after.today_call_list - before.today_call_list,
    offer_dm_updated: Math.max(0, after.offer_dm_filled - before.offer_dm_filled),
    playbooks_generated: Math.max(0, after.playbook_filled - before.playbook_filled),
    queries_inserted: Math.max(0, after.queries_active - before.queries_active),
    queries_retired: Math.max(0, after.queries_retired - before.queries_retired),
    before,
    after,
  };
}
