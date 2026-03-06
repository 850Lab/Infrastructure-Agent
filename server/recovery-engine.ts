import { log } from "./logger";
import { getClientAirtableConfig, scopedFormula } from "./airtable-scoped";

function logRecovery(msg: string) {
  log(msg, "recovery-engine");
}

interface RecoveryStrategy {
  steps: string[];
  actions: RecoveryAction[];
}

type RecoveryAction =
  | { type: "re_enrich"; recordId: string }
  | { type: "outscraper_lookup"; recordId: string; companyName: string }
  | { type: "log_only" };

const RECOVERY_STRATEGIES: Record<string, { steps: string[]; actionType: string }> = {
  NO_DM: {
    steps: [
      "Run DM enrichment again (Apollo + website crawl)",
      "Search website staff/leadership pages",
      "Search LinkedIn company staff via Apollo",
      "Search job postings for decision-maker titles",
      "Search press releases for named contacts",
    ],
    actionType: "re_enrich",
  },
  NO_EMAIL: {
    steps: [
      "Generate email patterns from DM name + company domain",
      "Verify patterns via Hunter-style logic (SMTP check)",
      "Check colleague emails for domain pattern confirmation",
    ],
    actionType: "email_pattern",
  },
  NO_PHONE: {
    steps: [
      "Scrape Google Maps for company phone",
      "Check company contact/about pages for direct lines",
      "Find company main line as fallback",
    ],
    actionType: "outscraper_lookup",
  },
  GENERIC_CONTACT: {
    steps: [
      "Mark company for referral email via generic address",
      "Ask gatekeeper for correct DM contact on next call",
    ],
    actionType: "gatekeeper_referral",
  },
  AUTHORITY_MISMATCH: {
    steps: [
      "Store suggested authority title from call feedback",
      "Trigger targeted DM search for recommended title",
    ],
    actionType: "re_enrich",
  },
  NO_WEBSITE: {
    steps: [
      "Search Google Maps listing for company",
      "Search Secretary of State business registry",
      "Search LinkedIn for company page",
    ],
    actionType: "outscraper_lookup",
  },
};

const STATUSES_NEEDING_RECOVERY = new Set(Object.keys(RECOVERY_STRATEGIES));
const MAX_RECOVERY_ATTEMPTS = 5;
const MAX_PER_RUN = 20;

interface CompanyForRecovery {
  id: string;
  companyName: string;
  dmStatus: string;
  website: string;
  recoveryAttempts: number;
  recoveryPlan: string;
}

async function airtableRequest(path: string, options: RequestInit = {}, config: { apiKey: string; baseId: string }): Promise<any> {
  const url = `https://api.airtable.com/v0/${config.baseId}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
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

function buildRecoveryPlan(dmStatus: string, companyName: string, attempt: number): string {
  const strategy = RECOVERY_STRATEGIES[dmStatus];
  if (!strategy) return "";

  const lines = [
    `Recovery Plan for: ${companyName}`,
    `Status: ${dmStatus}`,
    `Attempt: ${attempt}`,
    `Generated: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    "",
    "Steps:",
  ];

  for (let i = 0; i < strategy.steps.length; i++) {
    lines.push(`  ${i + 1}. ${strategy.steps[i]}`);
  }

  return lines.join("\n");
}

async function executeRecoveryAction(
  company: CompanyForRecovery,
  strategy: { steps: string[]; actionType: string },
  atConfig: { apiKey: string; baseId: string }
): Promise<{ executed: boolean; result: string }> {
  switch (strategy.actionType) {
    case "re_enrich": {
      try {
        const { enrichCompany, writeDMsToAirtable } = await import("./dm-enrichment");
        logRecovery(`Re-enriching ${company.companyName} (${company.id})...`);
        const result = await enrichCompany(company.id);
        const dms = result.decisionMakers || [];
        if (dms.length > 0) {
          await writeDMsToAirtable(result);
          return { executed: true, result: `Found ${dms.length} DMs via re-enrichment` };
        }
        return { executed: true, result: "Re-enrichment ran but found no new DMs" };
      } catch (e: any) {
        logRecovery(`Re-enrichment failed for ${company.companyName}: ${e.message}`);
        return { executed: false, result: `Re-enrichment error: ${e.message}` };
      }
    }

    case "outscraper_lookup": {
      try {
        const { isOutscraperAvailable, searchGoogleMaps } = await import("./outscraper");
        if (!isOutscraperAvailable()) {
          return { executed: false, result: "Outscraper API not configured" };
        }
        logRecovery(`Google Maps lookup for ${company.companyName}...`);
        const result = await searchGoogleMaps(company.companyName);
        if (result && (result.site || result.phone)) {
          const updates: Record<string, any> = {};
          if (result.site && !company.website) updates.Website = result.site;
          if (result.phone) updates.Primary_DM_Phone = result.phone;

          if (Object.keys(updates).length > 0) {
            await airtableRequest("Companies", {
              method: "PATCH",
              body: JSON.stringify({ records: [{ id: company.id, fields: updates }] }),
            }, atConfig);
            return { executed: true, result: `Found: ${Object.keys(updates).join(", ")}` };
          }
        }
        return { executed: true, result: "Google Maps search returned no useful data" };
      } catch (e: any) {
        logRecovery(`Outscraper lookup failed for ${company.companyName}: ${e.message}`);
        return { executed: false, result: `Outscraper error: ${e.message}` };
      }
    }

    case "email_pattern": {
      try {
        const { enrichCompany, writeDMsToAirtable } = await import("./dm-enrichment");
        logRecovery(`Email pattern generation for ${company.companyName}...`);
        const result = await enrichCompany(company.id);
        const dms = result.decisionMakers || [];
        const withEmail = dms.filter((dm: any) => dm.email);
        if (withEmail.length > 0) {
          await writeDMsToAirtable(result);
          return { executed: true, result: `Generated ${withEmail.length} email(s) via pattern matching` };
        }
        return { executed: true, result: "Email pattern generation found no new emails" };
      } catch (e: any) {
        logRecovery(`Email pattern failed for ${company.companyName}: ${e.message}`);
        return { executed: false, result: `Email pattern error: ${e.message}` };
      }
    }

    case "gatekeeper_referral":
      try {
        await airtableRequest("Companies", {
          method: "PATCH",
          body: JSON.stringify({ records: [{ id: company.id, fields: { DM_Status: "RECOVERY_IN_PROGRESS" } }] }),
        }, atConfig);
        return { executed: true, result: "Marked for gatekeeper referral; status set to RECOVERY_IN_PROGRESS" };
      } catch (e: any) {
        return { executed: true, result: `Gatekeeper referral logged (status update failed: ${e.message})` };
      }

    default:
      return { executed: false, result: "Unknown action type" };
  }
}

async function ensureRecoveryFields(atConfig: { apiKey: string; baseId: string }): Promise<void> {
  try {
    const tablesResp = await fetch(`https://api.airtable.com/v0/meta/bases/${atConfig.baseId}/tables`, {
      headers: { Authorization: `Bearer ${atConfig.apiKey}` },
    });
    if (!tablesResp.ok) return;
    const tablesData = await tablesResp.json();
    const companiesTable = tablesData.tables?.find((t: any) => t.name === "Companies");
    if (!companiesTable) return;

    const existingFields = new Set((companiesTable.fields || []).map((f: any) => f.name));
    const tableId = companiesTable.id;
    const createUrl = `https://api.airtable.com/v0/meta/bases/${atConfig.baseId}/tables/${tableId}/fields`;
    const headers = { Authorization: `Bearer ${atConfig.apiKey}`, "Content-Type": "application/json" };

    if (!existingFields.has("Recovery_Plan")) {
      await fetch(createUrl, { method: "POST", headers, body: JSON.stringify({ name: "Recovery_Plan", type: "multilineText" }) });
      logRecovery("Created Recovery_Plan field");
    }
    if (!existingFields.has("Recovery_Attempts")) {
      await fetch(createUrl, { method: "POST", headers, body: JSON.stringify({ name: "Recovery_Attempts", type: "number", options: { precision: 0 } }) });
      logRecovery("Created Recovery_Attempts field");
    }
    if (!existingFields.has("Recovery_Last_Run")) {
      await fetch(createUrl, { method: "POST", headers, body: JSON.stringify({
        name: "Recovery_Last_Run",
        type: "dateTime",
        options: { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: "America/Chicago" },
      }) });
      logRecovery("Created Recovery_Last_Run field");
    }
  } catch (e: any) {
    logRecovery(`Field creation failed: ${e.message}`);
  }
}

export async function runRecoveryEngine(clientId?: string): Promise<{
  total: number;
  recovered: number;
  skipped: number;
  maxedOut: number;
  breakdown: Record<string, { attempted: number; succeeded: number }>;
}> {
  const atConfig = clientId ? await getClientAirtableConfig(clientId) : {
    apiKey: process.env.AIRTABLE_API_KEY || "",
    baseId: process.env.AIRTABLE_BASE_ID || "",
  };

  if (!atConfig.apiKey || !atConfig.baseId) {
    throw new Error("Airtable credentials not configured");
  }

  const table = "Companies";
  const allRecords: any[] = [];

  async function fetchAllPages(useScope: boolean) {
    let offset: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (useScope && clientId) {
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
      logRecovery("Client_ID field not found — fetching all records");
      allRecords.length = 0;
      await fetchAllPages(false);
    } else {
      throw e;
    }
  }

  const companiesNeedingRecovery = allRecords
    .filter(rec => {
      const status = String(rec.fields.DM_Status || "").trim();
      return STATUSES_NEEDING_RECOVERY.has(status);
    })
    .map(rec => {
      const f = rec.fields;
      return {
        id: rec.id,
        companyName: String(f.company_name || f.Company_Name || "").trim(),
        dmStatus: String(f.DM_Status || "").trim(),
        website: String(f.Website || f.website || "").trim(),
        recoveryAttempts: Number(f.Recovery_Attempts || 0),
        recoveryPlan: String(f.Recovery_Plan || "").trim(),
      } as CompanyForRecovery;
    });

  logRecovery(`Found ${companiesNeedingRecovery.length} companies needing recovery out of ${allRecords.length} total`);

  let recovered = 0;
  let skipped = 0;
  let maxedOut = 0;
  let processed = 0;
  const breakdown: Record<string, { attempted: number; succeeded: number }> = {};
  const updates: Array<{ id: string; fields: Record<string, any> }> = [];
  const now = new Date().toISOString();
  let fieldsEnsured = false;

  for (const company of companiesNeedingRecovery) {
    if (processed >= MAX_PER_RUN) {
      logRecovery(`Reached per-run limit of ${MAX_PER_RUN}, stopping`);
      break;
    }

    if (company.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      maxedOut++;
      continue;
    }

    const strategy = RECOVERY_STRATEGIES[company.dmStatus];
    if (!strategy) {
      skipped++;
      continue;
    }

    if (!breakdown[company.dmStatus]) {
      breakdown[company.dmStatus] = { attempted: 0, succeeded: 0 };
    }
    breakdown[company.dmStatus].attempted++;
    processed++;

    const newAttempt = company.recoveryAttempts + 1;
    const plan = buildRecoveryPlan(company.dmStatus, company.companyName, newAttempt);

    const actionResult = await executeRecoveryAction(company, strategy, atConfig);

    const dataFound = actionResult.executed && !actionResult.result.includes("found no") && !actionResult.result.includes("returned no") && !actionResult.result.includes("not configured");

    if (dataFound) {
      recovered++;
      breakdown[company.dmStatus].succeeded++;
    }

    if (!actionResult.executed && actionResult.result.includes("not configured")) {
      skipped++;
      logRecovery(`[${company.dmStatus}] ${company.companyName}: skipped (action not available)`);
      continue;
    }

    const planWithResult = `${plan}\n\nResult: ${actionResult.result}`;

    updates.push({
      id: company.id,
      fields: {
        Recovery_Plan: planWithResult,
        Recovery_Attempts: newAttempt,
        Recovery_Last_Run: now,
      },
    });

    logRecovery(`[${company.dmStatus}] ${company.companyName}: attempt ${newAttempt} — ${actionResult.result}`);
  }

  const batchSize = 10;
  let written = 0;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    try {
      await airtableRequest(table, {
        method: "PATCH",
        body: JSON.stringify({ records: batch }),
      }, atConfig);
      written += batch.length;
    } catch (e: any) {
      if (!fieldsEnsured && (e.message.includes("Recovery_Plan") || e.message.includes("Recovery_Attempts") || e.message.includes("Recovery_Last_Run")) && e.message.includes("UNKNOWN_FIELD_NAME")) {
        fieldsEnsured = true;
        await ensureRecoveryFields(atConfig);
        try {
          await airtableRequest(table, {
            method: "PATCH",
            body: JSON.stringify({ records: batch }),
          }, atConfig);
          written += batch.length;
        } catch (retryErr: any) {
          logRecovery(`Batch update retry error: ${retryErr.message}`);
        }
      } else {
        logRecovery(`Batch update error: ${e.message}`);
      }
    }
  }

  logRecovery(`Recovery complete: ${recovered} recovered, ${skipped} skipped, ${maxedOut} maxed out, ${written} records updated`);

  return {
    total: companiesNeedingRecovery.length,
    recovered,
    skipped,
    maxedOut,
    breakdown,
  };
}
