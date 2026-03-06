import { log } from "./logger";
import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";
import { scoreDMFit } from "./dm-fit";

function logStatus(msg: string) {
  log(msg, "dm-status");
}

const DM_STATUS = {
  DM_READY: "DM_READY",
  DM_WEAK: "DM_WEAK",
  NO_DM: "NO_DM",
  NO_EMAIL: "NO_EMAIL",
  NO_PHONE: "NO_PHONE",
  GENERIC_CONTACT: "GENERIC_CONTACT",
  NO_WEBSITE: "NO_WEBSITE",
  AUTHORITY_MISMATCH: "AUTHORITY_MISMATCH",
  RECOVERY_IN_PROGRESS: "RECOVERY_IN_PROGRESS",
  READY_FOR_OUTREACH: "READY_FOR_OUTREACH",
} as const;

type DMStatus = (typeof DM_STATUS)[keyof typeof DM_STATUS];

const GENERIC_PREFIXES = [
  "info@", "admin@", "contact@", "hello@", "support@",
  "sales@", "office@", "general@", "mail@", "enquiries@",
  "inquiries@", "help@", "service@", "webmaster@",
];

function isGenericEmail(email: string): boolean {
  const lower = (email || "").toLowerCase().trim();
  return GENERIC_PREFIXES.some(prefix => lower.startsWith(prefix));
}

interface CompanyRecord {
  id: string;
  companyName: string;
  offerDMName: string;
  offerDMTitle: string;
  offerDMEmail: string;
  offerDMPhone: string;
  offerDMFitScore: number;
  offerDMOutcome: string;
  primaryDMName: string;
  primaryDMTitle: string;
  primaryDMEmail: string;
  primaryDMPhone: string;
  website: string;
  authorityMissCount: number;
  currentDMStatus: string;
}

async function airtableRequest(path: string, options: RequestInit = {}, config?: { apiKey: string; baseId: string }): Promise<any> {
  const apiKey = config?.apiKey || process.env.AIRTABLE_API_KEY;
  const baseId = config?.baseId || process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) throw new Error("Airtable credentials not configured");
  const url = `https://api.airtable.com/v0/${baseId}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

export function evaluateDMStatus(company: CompanyRecord): DMStatus {
  const dmName = (company.offerDMName || company.primaryDMName || "").trim();
  const dmTitle = (company.offerDMTitle || company.primaryDMTitle || "").trim();
  const dmEmail = (company.offerDMEmail || company.primaryDMEmail || "").trim();
  const dmPhone = (company.offerDMPhone || company.primaryDMPhone || "").trim();
  const website = (company.website || "").trim();
  const outcome = (company.offerDMOutcome || "").toLowerCase().trim();
  const missCount = company.authorityMissCount || 0;

  if (outcome === "no_authority" || outcome === "wrong_person" || missCount >= 2) {
    if (dmName && (dmEmail || dmPhone)) {
      return DM_STATUS.RECOVERY_IN_PROGRESS;
    }
    return DM_STATUS.AUTHORITY_MISMATCH;
  }

  if (!website) {
    return DM_STATUS.NO_WEBSITE;
  }

  if (!dmName) {
    return DM_STATUS.NO_DM;
  }

  if (dmEmail && isGenericEmail(dmEmail)) {
    return DM_STATUS.GENERIC_CONTACT;
  }

  if (!dmEmail) {
    return DM_STATUS.NO_EMAIL;
  }

  if (!dmPhone) {
    return DM_STATUS.NO_PHONE;
  }

  const fit = dmTitle ? scoreDMFit(dmTitle, dmEmail, dmPhone, "", null) : null;

  if (fit && (fit.fitTier === "weak" || fit.fitTier === "none")) {
    return DM_STATUS.DM_WEAK;
  }

  if (fit && (fit.fitTier === "strong" || fit.fitTier === "moderate")) {
    return DM_STATUS.READY_FOR_OUTREACH;
  }

  return DM_STATUS.DM_READY;
}

export async function updateDMStatus(clientId?: string): Promise<{ total: number; updated: number; breakdown: Record<string, number> }> {
  const atConfig = clientId ? await getClientAirtableConfig(clientId) : {
    apiKey: process.env.AIRTABLE_API_KEY || "",
    baseId: process.env.AIRTABLE_BASE_ID || "",
  };

  if (!atConfig.apiKey || !atConfig.baseId) {
    throw new Error("Airtable credentials not configured");
  }

  const table = "Companies";
  const allRecords: any[] = [];

  async function fetchAllPages(useClientScope: boolean) {
    let offset: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (useClientScope && clientId) {
        params.set("filterByFormula", scopedFormula(clientId));
      }
      if (offset) params.set("offset", offset);
      const data = await airtableRequest(`${table}?${params}`, {}, atConfig);
      allRecords.push(...(data.records || []));
      offset = data.offset;
    } while (offset);
  }

  try {
    await fetchAllPages(!!clientId);
  } catch (e: any) {
    if (clientId && (e.message.includes("UNKNOWN_FIELD_NAME") || e.message.includes("Unknown field"))) {
      logStatus("Client_ID field not found — fetching all records without scope filter");
      const { markClientIdMissing } = await import("./airtable-scoped");
      markClientIdMissing();
      allRecords.length = 0;
      await fetchAllPages(false);
    } else {
      throw e;
    }
  }

  logStatus(`Fetched ${allRecords.length} companies for DM status classification`);

  const updates: Array<{ id: string; fields: Record<string, any> }> = [];
  const breakdown: Record<string, number> = {};
  const now = new Date().toISOString();

  for (const rec of allRecords) {
    const f = rec.fields;
    const company: CompanyRecord = {
      id: rec.id,
      companyName: String(f.company_name || f.Company_Name || "").trim(),
      offerDMName: String(f.Offer_DM_Name || "").trim(),
      offerDMTitle: String(f.Offer_DM_Title || "").trim(),
      offerDMEmail: String(f.Offer_DM_Email || "").trim(),
      offerDMPhone: String(f.Offer_DM_Phone || "").trim(),
      offerDMFitScore: Number(f.Offer_DM_FitScore || 0),
      offerDMOutcome: String(f.Offer_DM_Outcome || "").trim(),
      primaryDMName: String(f.Primary_DM_Name || "").trim(),
      primaryDMTitle: String(f.Primary_DM_Title || "").trim(),
      primaryDMEmail: String(f.Primary_DM_Email || "").trim(),
      primaryDMPhone: String(f.Primary_DM_Phone || "").trim(),
      website: String(f.Website || f.website || "").trim(),
      authorityMissCount: Number(f.Authority_Miss_Count || 0),
      currentDMStatus: String(f.DM_Status || "").trim(),
    };

    const newStatus = evaluateDMStatus(company);
    breakdown[newStatus] = (breakdown[newStatus] || 0) + 1;

    updates.push({
      id: rec.id,
      fields: {
        DM_Status: newStatus,
        DM_Last_Checked: now,
      },
    });
  }

  const batchSize = 10;
  let written = 0;
  let fieldsEnsured = false;

  async function ensureDMStatusFields() {
    if (fieldsEnsured) return;
    fieldsEnsured = true;
    logStatus("DM_Status field missing — creating fields in Airtable...");
    try {
      const tablesResp = await fetch(`https://api.airtable.com/v0/meta/bases/${atConfig.baseId}/tables`, {
        headers: { Authorization: `Bearer ${atConfig.apiKey}` },
      });
      if (!tablesResp.ok) return;
      const tablesData = await tablesResp.json();
      const companiesTable = tablesData.tables?.find((t: any) => t.name === "Companies");
      if (!companiesTable) return;

      const existingFields = new Set((companiesTable.fields || []).map((f: any) => f.name));

      if (!existingFields.has("DM_Status")) {
        await fetch(`https://api.airtable.com/v0/meta/bases/${atConfig.baseId}/tables/${companiesTable.id}/fields`, {
          method: "POST",
          headers: { Authorization: `Bearer ${atConfig.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "DM_Status",
            type: "singleSelect",
            options: {
              choices: [
                { name: "DM_READY", color: "greenLight2" },
                { name: "DM_WEAK", color: "yellowLight2" },
                { name: "NO_DM", color: "redLight2" },
                { name: "NO_EMAIL", color: "orangeLight2" },
                { name: "NO_PHONE", color: "orangeLight2" },
                { name: "GENERIC_CONTACT", color: "yellowLight2" },
                { name: "NO_WEBSITE", color: "redLight2" },
                { name: "AUTHORITY_MISMATCH", color: "redLight2" },
                { name: "RECOVERY_IN_PROGRESS", color: "cyanLight2" },
                { name: "READY_FOR_OUTREACH", color: "greenLight2" },
              ],
            },
          }),
        });
        logStatus("Created DM_Status field");
      }

      if (!existingFields.has("DM_Last_Checked")) {
        await fetch(`https://api.airtable.com/v0/meta/bases/${atConfig.baseId}/tables/${companiesTable.id}/fields`, {
          method: "POST",
          headers: { Authorization: `Bearer ${atConfig.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "DM_Last_Checked",
            type: "dateTime",
            options: {
              dateFormat: { name: "iso" },
              timeFormat: { name: "24hour" },
              timeZone: "America/Chicago",
            },
          }),
        });
        logStatus("Created DM_Last_Checked field");
      }
    } catch (e: any) {
      logStatus(`Field creation failed: ${e.message}`);
    }
  }

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    try {
      await airtableRequest(table, {
        method: "PATCH",
        body: JSON.stringify({ records: batch }),
      }, atConfig);
      written += batch.length;
    } catch (e: any) {
      if (e.message.includes("DM_Status") && e.message.includes("UNKNOWN_FIELD_NAME")) {
        await ensureDMStatusFields();
        try {
          await airtableRequest(table, {
            method: "PATCH",
            body: JSON.stringify({ records: batch }),
          }, atConfig);
          written += batch.length;
        } catch (retryErr: any) {
          logStatus(`Batch update retry error: ${retryErr.message}`);
        }
      } else {
        logStatus(`Batch update error: ${e.message}`);
      }
    }
  }

  logStatus(`DM Status complete: ${allRecords.length} evaluated, ${written} updated`);
  const parts = Object.entries(breakdown).map(([k, v]) => `${k}=${v}`).join(", ");
  logStatus(`Breakdown: ${parts}`);

  return { total: allRecords.length, updated: written, breakdown };
}
