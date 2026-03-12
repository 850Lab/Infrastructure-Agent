import type { Express } from "express";
import { authMiddleware } from "./auth";
import {
  createFlow,
  logFlowAttempt,
  getTodayActions,
  getAllPendingActions,
  getCompanyFlows,
  getFlowAttemptHistory,
  getActionQueueStats,
  seedFlowsFromTodayList,
  FLOW_TYPES,
  GK_OUTCOMES,
  DM_OUTCOMES,
  EMAIL_OUTCOMES,
  LINKEDIN_OUTCOMES,
  NURTURE_OUTCOMES,
  getOutcomeLabel,
} from "./flow-engine";
import { db } from "./db";
import { companyFlows, flowAttempts, actionQueue } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { log } from "./logger";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

function getClientId(req: any): string | null {
  return req.user?.clientId || null;
}

async function airtableGetRecord(table: string, recordId: string): Promise<any | null> {
  const key = AIRTABLE_API_KEY();
  const base = AIRTABLE_BASE_ID();
  if (!key || !base) return null;
  try {
    const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}/${recordId}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function airtableFetchFiltered(table: string, formula: string, fields: string[]): Promise<any[]> {
  const key = AIRTABLE_API_KEY();
  const base = AIRTABLE_BASE_ID();
  if (!key || !base) return [];
  const records: any[] = [];
  let offset: string | undefined;
  try {
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (formula) params.set("filterByFormula", formula);
      for (const f of fields) params.append("fields[]", f);
      if (offset) params.set("offset", offset);
      const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) break;
      const data = await res.json();
      records.push(...(data.records || []));
      offset = data.offset;
    } while (offset);
  } catch {}
  return records;
}

export function registerFlowRoutes(app: Express) {
  app.get("/api/company-detail/:companyId", authMiddleware, async (req, res) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) return res.status(400).json({ error: "No client context" });

      const { companyId } = req.params;
      const record = await airtableGetRecord("Companies", companyId);
      if (!record) return res.status(404).json({ error: "Company not found" });

      const f = record.fields;
      const company = {
        id: record.id,
        companyName: String(f.company_name || f.Company_Name || ""),
        phone: String(f.phone || f.Phone || ""),
        website: String(f.website || f.Website || ""),
        city: String(f.city || f.City || ""),
        state: String(f.state || f.State || ""),
        industry: String(f.Industry || f.industry || ""),
        category: String(f.Category || f.category || ""),
        bucket: String(f.Bucket || ""),
        leadStatus: String(f.Lead_Status || ""),
        finalPriority: parseInt(f.Final_Priority || "0", 10) || 0,
        timesCalled: parseInt(f.Times_Called || "0", 10) || 0,
        lastOutcome: String(f.Last_Outcome || ""),
        followupDue: String(f.Followup_Due || ""),
        gatekeeperName: String(f.Gatekeeper_Name || ""),
        dmCoverageStatus: String(f.DM_Coverage_Status || ""),
        enrichmentStatus: String(f.enrichment_status || ""),
        primaryDMName: String(f.Primary_DM_Name || ""),
        primaryDMTitle: String(f.Primary_DM_Title || ""),
        primaryDMEmail: String(f.Primary_DM_Email || ""),
        primaryDMPhone: String(f.Primary_DM_Phone || ""),
        offerDMName: String(f.Offer_DM_Name || ""),
        offerDMTitle: String(f.Offer_DM_Title || ""),
        offerDMEmail: String(f.Offer_DM_Email || ""),
        offerDMPhone: String(f.Offer_DM_Phone || ""),
        playbookOpener: String(f.Playbook_Call_Opener || ""),
        playbookGatekeeper: String(f.Playbook_Gatekeeper_Ask || ""),
        playbookVoicemail: String(f.Playbook_Voicemail || ""),
        playbookFollowup: String(f.Playbook_Followup_Text || ""),
        playbookEmailSubject: String(f.Playbook_Email_Subject || ""),
        playbookEmailBody: String(f.Playbook_Email_Body || ""),
        playbookStrategyNotes: String(f.Playbook_Strategy_Notes || ""),
        webIntel: String(f.Web_Intel || f.web_intel || ""),
        rankReason: String(f.Rank_Reason || ""),
        rankEvidence: String(f.Rank_Evidence || ""),
        todayCallList: f.Today_Call_List === true,
        touchCount: parseInt(String(f.Touch_Count || "0")) || 0,
      };

      const companyNameClean = company.companyName.replace(/'/g, "\\'");
      const dmRecords = await airtableFetchFiltered(
        "Decision_Makers",
        `SEARCH("${companyNameClean}", {company_name_text}&"")`,
        ["full_name", "name", "Full_Name", "title", "role", "Title", "email", "Email", "phone", "Phone",
         "seniority", "Seniority", "department", "Department", "source", "Source", "linkedin_url", "LinkedIn_URL",
         "company_name_text", "company", "company_name"]
      );

      const contacts = dmRecords.map((r: any) => {
        const d = r.fields;
        return {
          id: r.id,
          name: String(d.full_name || d.name || d.Full_Name || "").trim(),
          title: String(d.title || d.role || d.Title || "").trim(),
          email: String(d.email || d.Email || "").trim(),
          phone: String(d.phone || d.Phone || "").trim(),
          seniority: String(d.seniority || d.Seniority || "").trim(),
          department: String(d.department || d.Department || "").trim(),
          source: String(d.source || d.Source || "").trim(),
          linkedinUrl: String(d.linkedin_url || d.LinkedIn_URL || "").trim(),
          isDM: false,
        };
      }).filter((c: any) => c.name);

      if (company.primaryDMName) {
        const match = contacts.find((c: any) => c.name.toLowerCase() === company.primaryDMName.toLowerCase());
        if (match) match.isDM = true;
      }

      const flows = await getCompanyFlows(clientId, companyId);

      const allAttempts: any[] = [];
      for (const flow of flows) {
        const attempts = await getFlowAttemptHistory(flow.id);
        allAttempts.push(...attempts);
      }
      allAttempts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const pendingActions = await db.select()
        .from(actionQueue)
        .where(and(
          eq(actionQueue.clientId, clientId),
          eq(actionQueue.companyId, companyId),
          eq(actionQueue.status, "pending"),
        ))
        .orderBy(desc(actionQueue.priority));

      const nextAction = pendingActions[0] || null;

      res.json({
        company,
        contacts,
        flows,
        attempts: allAttempts,
        pendingActions,
        nextAction,
      });
    } catch (e: any) {
      log(`Company detail error: ${e.message}`, "flow-routes");
      res.status(500).json({ error: e.message });
    }
  });


  app.get("/api/flows/action-queue", authMiddleware, async (req, res) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) return res.status(400).json({ error: "No client context" });

      const filter = (req.query.filter as string) || "today";
      const actions = filter === "all"
        ? await getAllPendingActions(clientId)
        : await getTodayActions(clientId);

      res.json(actions);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/flows/stats", authMiddleware, async (req, res) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) return res.status(400).json({ error: "No client context" });
      const stats = await getActionQueueStats(clientId);
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/flows/company/:companyId", authMiddleware, async (req, res) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) return res.status(400).json({ error: "No client context" });
      const flows = await getCompanyFlows(clientId, req.params.companyId);
      res.json(flows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/flows/:flowId/attempts", authMiddleware, async (req, res) => {
    try {
      const flowId = parseInt(req.params.flowId);
      if (isNaN(flowId)) return res.status(400).json({ error: "Invalid flow ID" });
      const attempts = await getFlowAttemptHistory(flowId);
      res.json(attempts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/flows/create", authMiddleware, async (req, res) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) return res.status(400).json({ error: "No client context" });

      const { companyId, companyName, contactId, contactName, flowType, notes, priority } = req.body;
      if (!companyId || !companyName || !flowType) {
        return res.status(400).json({ error: "companyId, companyName, and flowType are required" });
      }

      const validTypes = Object.values(FLOW_TYPES);
      if (!validTypes.includes(flowType)) {
        return res.status(400).json({ error: `Invalid flowType. Must be one of: ${validTypes.join(", ")}` });
      }

      const flow = await createFlow({
        clientId,
        companyId,
        companyName,
        contactId,
        contactName,
        flowType,
        notes,
        priority,
      });

      res.json(flow);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/flows/log-attempt", authMiddleware, async (req, res) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) return res.status(400).json({ error: "No client context" });

      const { flowId, companyId, companyName, contactId, contactName, channel, outcome, notes, callbackAt, capturedInfo } = req.body;
      if (!flowId || !companyId || !companyName || !channel || !outcome) {
        return res.status(400).json({ error: "flowId, companyId, companyName, channel, and outcome are required" });
      }

      const result = await logFlowAttempt({
        clientId,
        flowId: parseInt(flowId),
        companyId,
        companyName,
        contactId,
        contactName,
        channel,
        outcome,
        notes,
        callbackAt: callbackAt ? new Date(callbackAt) : undefined,
        capturedInfo,
      });

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/flows/seed-from-today", authMiddleware, async (req, res) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) return res.status(400).json({ error: "No client context" });
      const { companies } = req.body;
      if (!companies || !Array.isArray(companies)) {
        return res.status(400).json({ error: "companies array is required" });
      }
      const result = await seedFlowsFromTodayList(clientId, companies);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/flows/outcomes/:flowType", (req, res) => {
    const { flowType } = req.params;
    const outcomeMap: Record<string, readonly string[]> = {
      gatekeeper: GK_OUTCOMES,
      dm_call: DM_OUTCOMES,
      email: EMAIL_OUTCOMES,
      linkedin: LINKEDIN_OUTCOMES,
      nurture: NURTURE_OUTCOMES,
    };
    const outcomes = outcomeMap[flowType];
    if (!outcomes) return res.status(400).json({ error: "Invalid flow type" });
    res.json(outcomes.map(o => ({ value: o, label: getOutcomeLabel(o) })));
  });

  app.get("/api/flows/all", authMiddleware, async (req, res) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) return res.status(400).json({ error: "No client context" });

      const flowType = req.query.flowType as string | undefined;
      const conditions = [eq(companyFlows.clientId, clientId)];
      if (flowType) conditions.push(eq(companyFlows.flowType, flowType));

      const flows = await db.select()
        .from(companyFlows)
        .where(and(...conditions))
        .orderBy(desc(companyFlows.priority), desc(companyFlows.updatedAt));

      res.json(flows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
