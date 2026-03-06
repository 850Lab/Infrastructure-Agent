import { log } from "./logger";
import { getClientAirtableConfig, scopedFormula } from "./airtable-scoped";
import { storage } from "./storage";

function logRecovery(msg: string) {
  log(msg, "recovery-engine");
}

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

const PRIORITY_MAP: Record<string, string> = {
  AUTHORITY_MISMATCH: "1_highest",
  NO_DM: "2_high",
  NO_EMAIL: "3_medium",
  NO_PHONE: "3_medium",
  GENERIC_CONTACT: "4_low",
  NO_WEBSITE: "2_high",
};

const MAX_QUEUE_PROCESS = 20;
const MAX_ATTEMPTS = 12;

function computeNextAttempt(attempts: number): Date {
  const now = new Date();
  let daysToAdd: number;
  if (attempts < 3) {
    daysToAdd = 2;
  } else if (attempts < 6) {
    daysToAdd = 7;
  } else {
    daysToAdd = 30;
  }
  return new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
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

interface CompanyForRecovery {
  id: string;
  companyName: string;
  dmStatus: string;
  website: string;
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

export async function populateRecoveryQueue(clientId: string): Promise<{ added: number; removed: number; alreadyQueued: number }> {
  const atConfig = await getClientAirtableConfig(clientId);
  if (!atConfig.apiKey || !atConfig.baseId) {
    throw new Error("Airtable credentials not configured");
  }

  const table = "Companies";
  const allRecords: any[] = [];

  async function fetchAllPages(useScope: boolean) {
    let offset: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (useScope) params.set("filterByFormula", scopedFormula(clientId));
      if (offset) params.set("offset", offset);
      const data = await airtableRequest(`${table}?${params}`, {}, atConfig);
      allRecords.push(...(data.records || []));
      offset = data.offset;
    } while (offset);
  }

  try {
    await fetchAllPages(true);
  } catch (e: any) {
    if (e.message.includes("UNKNOWN_FIELD_NAME") || e.message.includes("Unknown field")) {
      logRecovery("Client_ID field not found — fetching all records");
      allRecords.length = 0;
      await fetchAllPages(false);
    } else {
      throw e;
    }
  }

  let added = 0;
  let removed = 0;
  let alreadyQueued = 0;

  for (const rec of allRecords) {
    const f = rec.fields;
    const dmStatus = String(f.DM_Status || "").trim();
    const companyName = String(f.company_name || f.Company_Name || "").trim();
    const companyId = rec.id;

    if (dmStatus === "DM_READY" || dmStatus === "READY_FOR_OUTREACH") {
      const existing = await storage.getRecoveryQueueItem(companyId, clientId);
      if (existing && existing.active) {
        await storage.removeFromRecoveryQueue(companyId, clientId);
        removed++;
        logRecovery(`Removed ${companyName} from queue — status is now ${dmStatus}`);
      }
      continue;
    }

    if (!STATUSES_NEEDING_RECOVERY.has(dmStatus)) continue;

    const existing = await storage.getRecoveryQueueItem(companyId, clientId);
    if (existing && existing.active) {
      if (existing.dmStatus !== dmStatus) {
        await storage.updateRecoveryQueueItem(existing.id, { dmStatus, priority: PRIORITY_MAP[dmStatus] || "3_medium" });
      }
      alreadyQueued++;
      continue;
    }

    await storage.addToRecoveryQueue({
      clientId,
      companyId,
      companyName,
      dmStatus,
      priority: PRIORITY_MAP[dmStatus] || "3_medium",
      attempts: 0,
      nextAttempt: new Date(),
      active: true,
    });
    added++;
  }

  logRecovery(`Queue populated: ${added} added, ${removed} removed (DM_READY), ${alreadyQueued} already queued`);
  return { added, removed, alreadyQueued };
}

export async function processRecoveryQueue(clientId: string): Promise<{
  processed: number;
  recovered: number;
  skipped: number;
  maxedOut: number;
  breakdown: Record<string, { attempted: number; succeeded: number }>;
}> {
  const atConfig = await getClientAirtableConfig(clientId);
  if (!atConfig.apiKey || !atConfig.baseId) {
    throw new Error("Airtable credentials not configured");
  }

  const dueItems = await storage.getRecoveryQueueDue(clientId, MAX_QUEUE_PROCESS);
  logRecovery(`Processing ${dueItems.length} due items from recovery queue`);

  let processed = 0;
  let recovered = 0;
  let skipped = 0;
  let maxedOut = 0;
  const breakdown: Record<string, { attempted: number; succeeded: number }> = {};
  const airtableUpdates: Array<{ id: string; fields: Record<string, any> }> = [];
  const now = new Date().toISOString();
  let fieldsEnsured = false;

  for (const item of dueItems) {
    if (item.attempts >= MAX_ATTEMPTS) {
      await storage.updateRecoveryQueueItem(item.id, { active: false });
      maxedOut++;
      logRecovery(`[${item.dmStatus}] ${item.companyName}: deactivated (max ${MAX_ATTEMPTS} attempts reached)`);
      continue;
    }

    const strategy = RECOVERY_STRATEGIES[item.dmStatus];
    if (!strategy) {
      skipped++;
      continue;
    }

    if (!breakdown[item.dmStatus]) {
      breakdown[item.dmStatus] = { attempted: 0, succeeded: 0 };
    }
    breakdown[item.dmStatus].attempted++;
    processed++;

    let website = "";
    try {
      const encoded = encodeURIComponent("Companies");
      const rec = await airtableRequest(`${encoded}/${item.companyId}`, {}, atConfig);
      website = String(rec.fields?.Website || rec.fields?.website || "").trim();
    } catch {}

    const company: CompanyForRecovery = {
      id: item.companyId,
      companyName: item.companyName,
      dmStatus: item.dmStatus,
      website,
    };

    const actionResult = await executeRecoveryAction(company, strategy, atConfig);

    const dataFound = actionResult.executed &&
      !actionResult.result.includes("found no") &&
      !actionResult.result.includes("returned no") &&
      !actionResult.result.includes("not configured");

    if (!actionResult.executed && actionResult.result.includes("not configured")) {
      skipped++;
      logRecovery(`[${item.dmStatus}] ${item.companyName}: skipped (action not available)`);
      continue;
    }

    const newAttempts = item.attempts + 1;
    const nextAttempt = computeNextAttempt(newAttempts);

    if (dataFound) {
      recovered++;
      breakdown[item.dmStatus].succeeded++;
    }

    await storage.updateRecoveryQueueItem(item.id, {
      attempts: newAttempts,
      nextAttempt,
      lastResult: actionResult.result,
    });

    const plan = buildRecoveryPlan(item.dmStatus, item.companyName, newAttempts);
    const planWithResult = `${plan}\n\nResult: ${actionResult.result}`;

    airtableUpdates.push({
      id: item.companyId,
      fields: {
        Recovery_Plan: planWithResult,
        Recovery_Attempts: newAttempts,
        Recovery_Last_Run: now,
      },
    });

    logRecovery(`[${item.dmStatus}] ${item.companyName}: attempt ${newAttempts} — ${actionResult.result} (next: ${nextAttempt.toISOString().slice(0, 10)})`);
  }

  const batchSize = 10;
  for (let i = 0; i < airtableUpdates.length; i += batchSize) {
    const batch = airtableUpdates.slice(i, i + batchSize);
    try {
      await airtableRequest("Companies", {
        method: "PATCH",
        body: JSON.stringify({ records: batch }),
      }, atConfig);
    } catch (e: any) {
      if (!fieldsEnsured && e.message.includes("UNKNOWN_FIELD_NAME")) {
        fieldsEnsured = true;
        await ensureRecoveryFields(atConfig);
        try {
          await airtableRequest("Companies", {
            method: "PATCH",
            body: JSON.stringify({ records: batch }),
          }, atConfig);
        } catch (retryErr: any) {
          logRecovery(`Batch update retry error: ${retryErr.message}`);
        }
      } else {
        logRecovery(`Batch update error: ${e.message}`);
      }
    }
  }

  logRecovery(`Queue processing complete: ${processed} processed, ${recovered} recovered, ${skipped} skipped, ${maxedOut} maxed out`);
  return { processed, recovered, skipped, maxedOut, breakdown };
}

export async function runRecoveryEngine(clientId?: string): Promise<{
  queue: { added: number; removed: number; alreadyQueued: number };
  processing: { processed: number; recovered: number; skipped: number; breakdown: Record<string, { attempted: number; succeeded: number }> };
}> {
  if (!clientId) {
    const allClients = await storage.getAllClients();
    if (allClients.length > 0) clientId = allClients[0].id;
  }
  if (!clientId) throw new Error("Client context required");

  const queueResult = await populateRecoveryQueue(clientId);
  const processingResult = await processRecoveryQueue(clientId);

  return { queue: queueResult, processing: processingResult };
}
