/**
 * Authenticated live supervisor API — all mutations go through transfer-controller (or shared intercept helpers).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { log } from "../logger";
import {
  listActiveAiCallBotSessionsForSupervisor,
  getSessionById,
  markAgentIntercepted,
  setSupervisorPauseAutoTransfer,
  clearSupervisorPauseAutoTransfer,
} from "./transfer-controller";
import { buildSupervisorLiveSessionView } from "./supervisor-live-view";
import { getCoachingStartedAtMs, setHumanTakeoverActive } from "../realtime-coaching";
import { getDriftReviewSummary } from "./anti-drift";

const TAG = "ai-call-bot-supervised";

function clientId(req: Request): string | null {
  return (req as any).user?.clientId || null;
}

export function registerAiCallBotSupervisorRoutes(app: Express, authMw: any) {
  app.get("/api/ai-call-bot/supervised/sessions/active", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const includeSandbox =
        req.query.includeSandbox === "1" || req.query.includeSandbox === "true" || req.query.includeSandbox === "yes";
      const rows = await listActiveAiCallBotSessionsForSupervisor(cid, 8, 50, { includeSandbox });
      const views = await Promise.all(
        rows.map((row) =>
          buildSupervisorLiveSessionView(row, row.callSid ? getCoachingStartedAtMs(row.callSid) : null)
        )
      );
      res.json({
        sessions: views,
        processDriftSummary: getDriftReviewSummary(),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`supervised list error: ${msg}`, TAG);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/ai-call-bot/supervised/sessions/:id/live", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getSessionById(id, cid);
      if (!row) return res.status(404).json({ error: "Not found" });
      const live = await buildSupervisorLiveSessionView(row, row.callSid ? getCoachingStartedAtMs(row.callSid) : null);
      res.json({
        live,
        processDriftSummary: getDriftReviewSummary(),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`supervised live error: ${msg}`, TAG);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/ai-call-bot/supervised/sessions/:id/intercept", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getSessionById(id, cid);
      if (!row) return res.status(404).json({ error: "Not found" });
      await markAgentIntercepted(id, cid);
      if (row.callSid) setHumanTakeoverActive(row.callSid);
      res.json({ ok: true, agentInterceptedAt: new Date().toISOString() });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/ai-call-bot/supervised/sessions/:id/pause-auto-transfer", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getSessionById(id, cid);
      if (!row) return res.status(404).json({ error: "Not found" });
      const body = z.object({ reason: z.string().max(2000).optional() }).parse(req.body ?? {});
      await setSupervisorPauseAutoTransfer(id, cid, true, body.reason ?? null);
      res.json({ ok: true, supervisorPauseAutoTransfer: true });
    } catch (e: unknown) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/ai-call-bot/supervised/sessions/:id/clear-pause-auto-transfer", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getSessionById(id, cid);
      if (!row) return res.status(404).json({ error: "Not found" });
      await clearSupervisorPauseAutoTransfer(id, cid);
      res.json({ ok: true, supervisorPauseAutoTransfer: false });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  log("AI Call Bot supervisor routes registered", TAG);
}
