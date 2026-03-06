import { log } from "./logger";
import { scopedFormula } from "./airtable-scoped";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

export interface ChangesetEntry {
  table: string;
  recordId: string;
  companyName: string;
  category: "rank" | "offer_dm" | "playbooks";
  fields_before: Record<string, any>;
  fields_after: Record<string, any>;
}

export interface Changeset {
  entries: ChangesetEntry[];
  reverted: boolean;
  reverted_at?: string;
  reverted_categories?: string[];
}

const CATEGORY_FIELDS: Record<string, string[]> = {
  rank: ["Rank_Reason", "Rank_Evidence", "Rank_Inputs_JSON", "Rank_Version"],
  offer_dm: [
    "Offer_DM_Name", "Offer_DM_Title", "Offer_DM_Email", "Offer_DM_Phone",
    "Offer_DM_FitScore", "Offer_DM_Reason", "Offer_DM_Source", "Offer_DM_Last_Selected",
  ],
  playbooks: [
    "Playbook_Call_Opener", "Playbook_Gatekeeper_Ask", "Playbook_Voicemail",
    "Playbook_Email_Subject", "Playbook_Email_Body", "Playbook_Followup_Text",
    "Playbook_Version", "Playbook_Last_Generated",
  ],
};

export function getCategoryFields(category: string): string[] {
  return CATEGORY_FIELDS[category] || [];
}

export function getAllTrackedFields(): string[] {
  return Object.values(CATEGORY_FIELDS).flat();
}

async function airtableRequest(pathStr: string, options: RequestInit = {}): Promise<any> {
  const key = AIRTABLE_API_KEY();
  const base = AIRTABLE_BASE_ID();
  if (!key || !base) throw new Error("Airtable credentials not configured");
  const url = `https://api.airtable.com/v0/${base}/${pathStr}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function snapshotTodayListFields(clientId?: string): Promise<Map<string, { companyName: string; fields: Record<string, any> }>> {
  const table = encodeURIComponent("Companies");
  const baseFormula = `{Today_Call_List}=TRUE()`;
  const allFields = getAllTrackedFields();
  const fieldParams = allFields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

  const snapshot = new Map<string, { companyName: string; fields: Record<string, any> }>();

  const fetchPages = async (useScope: boolean) => {
    snapshot.clear();
    const formula = encodeURIComponent(useScope && clientId ? scopedFormula(clientId, baseFormula) : baseFormula);
    let offset: string | undefined;
    do {
      let url = `${table}?pageSize=100&filterByFormula=${formula}&fields[]=${encodeURIComponent("company_name")}&${fieldParams}`;
      if (offset) url += `&offset=${offset}`;
      const data = await airtableRequest(url);
      for (const rec of data.records || []) {
        const fields: Record<string, any> = {};
        for (const f of allFields) {
          fields[f] = rec.fields[f] ?? null;
        }
        snapshot.set(rec.id, {
          companyName: String(rec.fields.company_name || rec.fields.Company_Name || ""),
          fields,
        });
      }
      offset = data.offset;
    } while (offset);
  };

  try {
    await fetchPages(!!clientId);
  } catch (e: any) {
    if (clientId && (e.message.includes("INVALID_FILTER") || e.message.includes("UNKNOWN_FIELD") || e.message.includes("Unknown field"))) {
      const { markClientIdMissing } = await import("./airtable-scoped");
      markClientIdMissing();
      try {
        await fetchPages(false);
      } catch (e2: any) {
        log(`Snapshot error: ${e2.message}`, "changeset");
      }
    } else {
      log(`Snapshot error: ${e.message}`, "changeset");
    }
  }

  return snapshot;
}

export function computeChangeset(
  before: Map<string, { companyName: string; fields: Record<string, any> }>,
  after: Map<string, { companyName: string; fields: Record<string, any> }>,
): ChangesetEntry[] {
  const entries: ChangesetEntry[] = [];

  for (const [recordId, afterData] of after) {
    const beforeData = before.get(recordId);
    if (!beforeData) continue;

    for (const [category, categoryFields] of Object.entries(CATEGORY_FIELDS)) {
      const fieldsBefore: Record<string, any> = {};
      const fieldsAfter: Record<string, any> = {};
      let changed = false;

      for (const field of categoryFields) {
        const bVal = beforeData.fields[field];
        const aVal = afterData.fields[field];
        fieldsBefore[field] = bVal;
        fieldsAfter[field] = aVal;

        if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
          changed = true;
        }
      }

      if (changed) {
        entries.push({
          table: "Companies",
          recordId,
          companyName: afterData.companyName || beforeData.companyName,
          category: category as "rank" | "offer_dm" | "playbooks",
          fields_before: fieldsBefore,
          fields_after: fieldsAfter,
        });
      }
    }
  }

  return entries;
}

export async function revertChangeset(
  entries: ChangesetEntry[],
  categories: string[],
): Promise<{ reverted: number; skipped: number; errors: string[] }> {
  const catSet = new Set(categories);
  const toRevert = entries.filter(e => catSet.has(e.category));

  if (toRevert.length === 0) {
    return { reverted: 0, skipped: 0, errors: [] };
  }

  const table = encodeURIComponent("Companies");
  const batchSize = 10;
  let reverted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < toRevert.length; i += batchSize) {
    const batch = toRevert.slice(i, i + batchSize);
    const records = batch.map(e => ({
      id: e.recordId,
      fields: { ...e.fields_before },
    }));

    try {
      await airtableRequest(table, {
        method: "PATCH",
        body: JSON.stringify({ records }),
      });
      reverted += batch.length;
    } catch (e: any) {
      errors.push(`Batch revert error at offset ${i}: ${e.message}`);
      skipped += batch.length;
    }
  }

  log(`Revert complete: ${reverted} reverted, ${skipped} skipped, ${errors.length} errors`, "changeset");
  return { reverted, skipped, errors };
}
