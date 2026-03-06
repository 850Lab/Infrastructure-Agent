import type { Express, Request, Response } from "express";
import { authMiddleware } from "./dashboard-routes";
import { log } from "./logger";
import { processCall } from "./call-engine";
import { scopedFormula } from "./airtable-scoped";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

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

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
}

async function airtableFetch(
  table: string,
  formula: string,
  fields: string[],
): Promise<AirtableRecord[]> {
  const key = AIRTABLE_API_KEY();
  const base = AIRTABLE_BASE_ID();
  if (!key || !base) return [];

  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  try {
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (formula) params.set("filterByFormula", formula);
      for (const f of fields) params.append("fields[]", f);
      if (offset) params.set("offset", offset);

      const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) return records;

      const data = await res.json();
      records.push(...(data.records || []));
      offset = data.offset;
    } while (offset);
  } catch (e: any) {
    log(`Today routes airtable error (${table}): ${e.message}`, "today");
  }

  return records;
}

async function airtableCreate(
  table: string,
  fields: Record<string, any>,
): Promise<AirtableRecord | null> {
  const key = AIRTABLE_API_KEY();
  const base = AIRTABLE_BASE_ID();
  if (!key || !base) return null;

  try {
    const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const text = await res.text();
      log(`Airtable create error (${table}): ${res.status} ${text.slice(0, 200)}`, "today");
      return null;
    }
    return await res.json();
  } catch (e: any) {
    log(`Airtable create exception (${table}): ${e.message}`, "today");
    return null;
  }
}

export interface TodayCompany {
  id: string;
  company_name: string;
  phone: string;
  bucket: string;
  final_priority: number;
  lead_status: string;
  times_called: number;
  last_outcome: string;
  offer_dm_name: string;
  offer_dm_title: string;
  offer_dm_phone: string;
  offer_dm_email: string;
  rank_reason: string;
  rank_evidence: string;
  playbook_opener: string;
  playbook_gatekeeper: string;
  playbook_voicemail: string;
  playbook_followup: string;
  playbook_email_subject: string;
  playbook_email_body: string;
  followup_due: string;
  website: string;
  city: string;
  gatekeeper_name: string;
}

function companyFields(): string[] {
  return [
    "Company_Name", "Phone", "Bucket", "Final_Priority", "Lead_Status",
    "Times_Called", "Last_Outcome", "Offer_DM_Name", "Offer_DM_Title",
    "Offer_DM_Phone", "Offer_DM_Email", "Rank_Reason", "Rank_Evidence",
    "Playbook_Call_Opener", "Playbook_Gatekeeper_Ask", "Playbook_Voicemail",
    "Playbook_Followup_Text", "Playbook_Email_Subject", "Playbook_Email_Body",
    "Followup_Due", "Website", "City", "Gatekeeper_Name",
  ];
}

function mapCompany(rec: AirtableRecord): TodayCompany {
  const f = rec.fields;
  return {
    id: rec.id,
    company_name: String(f.Company_Name || ""),
    phone: String(f.Phone || ""),
    bucket: String(f.Bucket || ""),
    final_priority: parseInt(f.Final_Priority || "0", 10) || 0,
    lead_status: String(f.Lead_Status || ""),
    times_called: parseInt(f.Times_Called || "0", 10) || 0,
    last_outcome: String(f.Last_Outcome || ""),
    offer_dm_name: String(f.Offer_DM_Name || ""),
    offer_dm_title: String(f.Offer_DM_Title || ""),
    offer_dm_phone: String(f.Offer_DM_Phone || ""),
    offer_dm_email: String(f.Offer_DM_Email || ""),
    rank_reason: String(f.Rank_Reason || ""),
    rank_evidence: String(f.Rank_Evidence || ""),
    playbook_opener: String(f.Playbook_Call_Opener || ""),
    playbook_gatekeeper: String(f.Playbook_Gatekeeper_Ask || ""),
    playbook_voicemail: String(f.Playbook_Voicemail || ""),
    playbook_followup: String(f.Playbook_Followup_Text || ""),
    playbook_email_subject: String(f.Playbook_Email_Subject || ""),
    playbook_email_body: String(f.Playbook_Email_Body || ""),
    followup_due: String(f.Followup_Due || ""),
    website: String(f.Website || ""),
    city: String(f.City || ""),
    gatekeeper_name: String(f.Gatekeeper_Name || ""),
  };
}

function suggestFollowupDate(outcome: string): string | null {
  const days = OUTCOME_FOLLOWUP_DAYS[outcome];
  if (days === null || days === undefined) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function registerTodayRoutes(app: Express) {
  app.get("/api/today-list", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const clientId = (_req as any).user?.clientId;
      const baseFormula = "{Today_Call_List}=TRUE()";
      const formula = clientId ? scopedFormula(clientId, baseFormula) : baseFormula;
      const records = await airtableFetch(
        "Companies",
        formula,
        companyFields(),
      );

      const companies = records
        .map(mapCompany)
        .sort((a, b) => {
          const bucketOrder: Record<string, number> = { "Hot Follow-up": 0, "Working": 1, "Fresh": 2, "Hold": 3 };
          const ba = bucketOrder[a.bucket] ?? 4;
          const bb = bucketOrder[b.bucket] ?? 4;
          if (ba !== bb) return ba - bb;
          return b.final_priority - a.final_priority;
        });

      log(`Today list: ${companies.length} companies`, "today");
      res.json({ companies, count: companies.length });
    } catch (err: any) {
      log(`Today list error: ${err.message}`, "today");
      res.status(500).json({ error: "Failed to fetch today list" });
    }
  });

  app.post("/api/calls/log", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { company_name, outcome, notes, gatekeeper_name } = req.body;
      if (!company_name || !outcome) {
        return res.status(400).json({ error: "company_name and outcome are required" });
      }

      const validOutcomes = ["No Answer", "Gatekeeper", "Decision Maker", "Qualified", "Callback", "Not Interested", "Won", "Lost"];
      if (!validOutcomes.includes(outcome)) {
        return res.status(400).json({ error: `Invalid outcome. Must be one of: ${validOutcomes.join(", ")}` });
      }

      const callFields: Record<string, any> = {
        Company: company_name,
        Outcome: outcome,
        Call_Time: new Date().toISOString(),
      };
      if (notes) callFields.Notes = notes;
      if (gatekeeper_name) callFields.Gatekeeper_Name = gatekeeper_name;

      const created = await airtableCreate("Calls", callFields);
      if (!created) {
        return res.status(500).json({ error: "Failed to create call record" });
      }

      const followupSuggestion = suggestFollowupDate(outcome);

      let engineResult = null;
      try {
        engineResult = await processCall({
          id: created.id,
          company: company_name,
          outcome,
          callTime: callFields.Call_Time,
          notes: notes || "",
          gatekeeperName: gatekeeper_name || "",
        });
      } catch (e: any) {
        log(`Call engine processing error for ${company_name}: ${e.message}`, "today");
      }

      log(`Call logged: ${company_name} → ${outcome}`, "today");

      res.json({
        call_id: created.id,
        company_name,
        outcome,
        followup_suggestion: followupSuggestion,
        engine_result: engineResult,
      });
    } catch (err: any) {
      log(`Call log error: ${err.message}`, "today");
      res.status(500).json({ error: "Failed to log call" });
    }
  });

  app.get("/api/followups/due", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const clientId = (_req as any).user?.clientId;
      const baseFormula = `AND({Followup_Due}!='',IS_BEFORE({Followup_Due},DATEADD(TODAY(),1,'day')),{Lead_Status}!='Won',{Lead_Status}!='Lost')`;
      const formula = clientId ? scopedFormula(clientId, baseFormula) : baseFormula;
      const records = await airtableFetch(
        "Companies",
        formula,
        ["Company_Name", "Followup_Due", "Last_Outcome", "Phone", "Offer_DM_Name", "Bucket"],
      );

      const followups = records.map(rec => ({
        id: rec.id,
        company_name: String(rec.fields.Company_Name || ""),
        followup_due: String(rec.fields.Followup_Due || ""),
        last_outcome: String(rec.fields.Last_Outcome || ""),
        phone: String(rec.fields.Phone || ""),
        offer_dm_name: String(rec.fields.Offer_DM_Name || ""),
        bucket: String(rec.fields.Bucket || ""),
      }));

      res.json({ followups, count: followups.length });
    } catch (err: any) {
      log(`Followups due error: ${err.message}`, "today");
      res.status(500).json({ error: "Failed to fetch followups" });
    }
  });
}
