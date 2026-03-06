import { handleCallOutcome } from "./opportunities";
import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";

interface CallRecord {
  id: string;
  company: string;
  outcome: string;
  callTime: string;
  notes: string;
  gatekeeperName: string;
}

interface EngineResult {
  calls_processed: number;
  companies_updated: number;
  followups_scheduled: number;
  gatekeepers_recorded: number;
  details: Array<{
    callId: string;
    company: string;
    outcome: string;
    leadStatusSet: string | null;
    followupDate: string | null;
    engagementDelta: number;
    gatekeeperRecorded: string | null;
    error?: string;
  }>;
}

const OUTCOME_TO_LEAD_STATUS: Record<string, string | null> = {
  "Decision Maker": "Working",
  "Qualified": "Working",
  "Won": "Won",
  "Not Interested": "Lost",
  "Gatekeeper": null,
  "No Answer": null,
  "Callback": null,
  "Lost": "Lost",
};

const OUTCOME_FOLLOWUP_DAYS: Record<string, number | null> = {
  "No Answer": 2,
  "Gatekeeper": 7,
  "Decision Maker": 5,
  "Qualified": 3,
  "Callback": 1,
  "Won": null,
  "Not Interested": 90,
  "Lost": null,
};

const OUTCOME_ENGAGEMENT_DELTA: Record<string, number> = {
  "Decision Maker": 10,
  "Qualified": 20,
  "Won": 40,
  "Not Interested": -10,
  "Gatekeeper": 2,
};

function logEngine(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [call-engine] ${message}`);
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
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function fetchUnprocessedCalls(clientId?: string, atConfig?: { apiKey: string; baseId: string }): Promise<CallRecord[]> {
  const table = encodeURIComponent("Calls");
  const baseFormula = "AND({Outcome} != '', {Call_Time} != '', NOT({Processed}))";
  const formula = encodeURIComponent(clientId ? scopedFormula(clientId, baseFormula) : baseFormula);
  const calls: CallRecord[] = [];
  let offset: string | undefined;

  do {
    const data = await airtableRequest(`${table}?filterByFormula=${formula}&pageSize=100${offset ? `&offset=${offset}` : ""}`, {}, atConfig);

    for (const rec of data.records || []) {
      calls.push({
        id: rec.id,
        company: String(rec.fields.Company || "").trim(),
        outcome: String(rec.fields.Outcome || "").trim(),
        callTime: String(rec.fields.Call_Time || ""),
        notes: String(rec.fields.Notes || ""),
        gatekeeperName: String(rec.fields.Gatekeeper_Name || "").trim(),
      });
    }
    offset = data.offset;
  } while (offset);

  return calls;
}

async function findCompanyByName(companyName: string, clientId?: string, atConfig?: { apiKey: string; baseId: string }): Promise<{
  id: string;
  engagementScore: number;
  gatekeeperName: string;
  gatekeeperNotes: string;
  offerDMTitle: string;
  primaryDMTitle: string;
} | null> {
  if (!companyName) return null;

  const table = encodeURIComponent("Companies");
  const escaped = companyName.replace(/'/g, "\\'");
  const baseFormula = `LOWER({company_name}) = LOWER('${escaped}')`;
  const formula = encodeURIComponent(clientId ? scopedFormula(clientId, baseFormula) : baseFormula);

  try {
    const data = await airtableRequest(`${table}?filterByFormula=${formula}&pageSize=1`, {}, atConfig);
    const rec = data.records?.[0];
    if (!rec) return null;
    return {
      id: rec.id,
      engagementScore: parseInt(rec.fields.Engagement_Score || "0", 10) || 0,
      gatekeeperName: String(rec.fields.Gatekeeper_Name || "").trim(),
      gatekeeperNotes: String(rec.fields.Gatekeeper_Notes || "").trim(),
      offerDMTitle: String(rec.fields.Offer_DM_Title || "").trim(),
      primaryDMTitle: String(rec.fields.Primary_DM_Title || "").trim(),
    };
  } catch {
    return null;
  }
}

function addDays(fromDate: Date, days: number): string {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export async function processCall(call: CallRecord, clientId?: string, atConfig?: { apiKey: string; baseId: string }): Promise<{
  leadStatusSet: string | null;
  followupDate: string | null;
  engagementDelta: number;
  companyUpdated: boolean;
  gatekeeperRecorded: string | null;
}> {
  const callTable = encodeURIComponent("Calls");
  const compTable = encodeURIComponent("Companies");

  const newLeadStatus = OUTCOME_TO_LEAD_STATUS[call.outcome] ?? null;
  const followupDays = OUTCOME_FOLLOWUP_DAYS[call.outcome] ?? null;
  const engagementDelta = OUTCOME_ENGAGEMENT_DELTA[call.outcome] || 0;

  let followupDate: string | null = null;
  if (followupDays !== null) {
    const baseDate = call.callTime ? new Date(call.callTime) : new Date();
    followupDate = addDays(baseDate, followupDays);
  }

  let companyUpdated = false;
  let gatekeeperRecorded: string | null = null;

  if (call.company) {
    const company = await findCompanyByName(call.company, clientId, atConfig);
    if (company) {
      const compUpdate: Record<string, any> = {};

      if (newLeadStatus) {
        compUpdate.Lead_Status = newLeadStatus;
      }

      if (engagementDelta !== 0) {
        const newScore = Math.max(0, company.engagementScore + engagementDelta);
        compUpdate.Engagement_Score = newScore;
      }

      if (call.outcome === "Gatekeeper" && call.gatekeeperName) {
        const existingGK = company.gatekeeperName;

        if (!existingGK) {
          compUpdate.Gatekeeper_Name = call.gatekeeperName;
          compUpdate.Gatekeeper_Last_Spoken = call.callTime || new Date().toISOString();
          gatekeeperRecorded = call.gatekeeperName;
          logEngine(`Gatekeeper recorded: ${call.gatekeeperName} @ ${call.company}`);
        } else if (existingGK.toLowerCase() !== call.gatekeeperName.toLowerCase()) {
          compUpdate.Gatekeeper_Last_Spoken = call.callTime || new Date().toISOString();
          const dateStr = (call.callTime || new Date().toISOString()).split("T")[0];
          const appendNote = `Possible alternate gatekeeper: ${call.gatekeeperName} (${dateStr})`;
          const existingNotes = company.gatekeeperNotes;
          compUpdate.Gatekeeper_Notes = existingNotes
            ? `${existingNotes}\n${appendNote}`
            : appendNote;
          gatekeeperRecorded = call.gatekeeperName;
          logEngine(`Gatekeeper alternate noted: ${call.gatekeeperName} @ ${call.company} (existing: ${existingGK})`);
        } else {
          compUpdate.Gatekeeper_Last_Spoken = call.callTime || new Date().toISOString();
          logEngine(`Gatekeeper confirmed: ${call.gatekeeperName} @ ${call.company}`);
        }
      }

      const OUTCOME_TO_DM_OUTCOME: Record<string, string | null> = {
        "Decision Maker": "reached_dm",
        "Qualified": "reached_dm",
        "Won": "converted",
        "Not Interested": "rejected",
        "Gatekeeper": null,
        "No Answer": null,
        "Callback": null,
        "Lost": "rejected",
      };

      const dmOutcome = OUTCOME_TO_DM_OUTCOME[call.outcome] ?? null;

      if (call.outcome === "Gatekeeper" && (company.offerDMTitle || company.primaryDMTitle)) {
        compUpdate.Offer_DM_Outcome = "wrong_person";
        logEngine(`DM outcome: wrong_person (gatekeeper reached, DM was set) @ ${call.company}`);
      } else if (dmOutcome) {
        compUpdate.Offer_DM_Outcome = dmOutcome;
        logEngine(`DM outcome: ${dmOutcome} @ ${call.company}`);
      }

      const titleAtContact = company.offerDMTitle || company.primaryDMTitle;
      if (titleAtContact) {
        compUpdate.Offer_DM_Title_At_Contact = titleAtContact;
      }

      if (Object.keys(compUpdate).length > 0) {
        await airtableRequest(`${compTable}/${company.id}`, {
          method: "PATCH",
          body: JSON.stringify({ fields: compUpdate }),
        }, atConfig);
        companyUpdated = true;
      }
    } else {
      logEngine(`Company not found: "${call.company}"`);
    }
  }

  const callUpdate: Record<string, any> = { Processed: true };
  if (followupDate) {
    callUpdate.Next_Followup = followupDate;
  }

  await airtableRequest(`${callTable}/${call.id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: callUpdate }),
  }, atConfig);

  let opportunityResult = null;
  try {
    opportunityResult = await handleCallOutcome(call.company, call.outcome, call.notes);
    if (opportunityResult) {
      logEngine(`Opportunity ${opportunityResult.action} for ${call.company} (${opportunityResult.opportunityId})`);
    }
  } catch (e: any) {
    logEngine(`Opportunity handling error for ${call.company}: ${e.message}`);
  }

  return { leadStatusSet: newLeadStatus, followupDate, engagementDelta, companyUpdated, gatekeeperRecorded, opportunityResult };
}

export async function runEngine(clientId?: string): Promise<EngineResult> {
  logEngine("Fetching unprocessed calls...");
  const atConfig = clientId ? await getClientAirtableConfig(clientId) : undefined;
  const calls = await fetchUnprocessedCalls(clientId, atConfig);
  logEngine(`Found ${calls.length} unprocessed calls`);

  const result: EngineResult = {
    calls_processed: 0,
    companies_updated: 0,
    followups_scheduled: 0,
    gatekeepers_recorded: 0,
    details: [],
  };

  for (const call of calls) {
    try {
      logEngine(`Processing: ${call.company} — ${call.outcome}`);
      const outcome = await processCall(call, clientId, atConfig);

      result.calls_processed++;
      if (outcome.companyUpdated) result.companies_updated++;
      if (outcome.followupDate) result.followups_scheduled++;
      if (outcome.gatekeeperRecorded) result.gatekeepers_recorded++;

      result.details.push({
        callId: call.id,
        company: call.company,
        outcome: call.outcome,
        leadStatusSet: outcome.leadStatusSet,
        followupDate: outcome.followupDate,
        engagementDelta: outcome.engagementDelta,
        gatekeeperRecorded: outcome.gatekeeperRecorded,
      });
    } catch (e: any) {
      logEngine(`Error processing call ${call.id}: ${e.message}`);
      result.details.push({
        callId: call.id,
        company: call.company,
        outcome: call.outcome,
        leadStatusSet: null,
        followupDate: null,
        engagementDelta: 0,
        gatekeeperRecorded: null,
        error: e.message,
      });
    }

    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}
