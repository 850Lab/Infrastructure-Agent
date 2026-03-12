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

function getClientId(req: any): string | null {
  return req.user?.clientId || null;
}

export function registerFlowRoutes(app: Express) {
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
