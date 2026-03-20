/**
 * Internal staging-only routes — gated by AI_CALL_BOT_STAGING_SECRET (min 16 chars).
 * No FSM writes; read-only drift buffer + DB session read for verify.
 */
import type { Express, Request, Response } from "express";
import { getSessionById } from "./transfer-controller";
import { verifyAiCallBotSessionRow } from "./session-verify";
import { getDriftReviewSummary, getRecentDriftEvents } from "./anti-drift";
import { log } from "../logger";

const TAG = "ai-call-bot-staging";
const MIN_SECRET_LEN = 16;

function assertStagingSecret(req: Request, res: Response): boolean {
  const secret = process.env.AI_CALL_BOT_STAGING_SECRET;
  if (!secret || secret.length < MIN_SECRET_LEN) {
    res.status(503).json({
      error: "AI_CALL_BOT_STAGING_SECRET not configured or too short (min 16 chars)",
    });
    return false;
  }
  const headerVal = req.header("x-ai-call-bot-staging-secret");
  const provided =
    (typeof headerVal === "string" && headerVal) ||
    (typeof req.query.secret === "string" && req.query.secret);
  if (provided !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

export function registerAiCallBotStagingRoutes(app: Express) {
  app.get("/api/internal/ai-call-bot/drift-review", (req: Request, res: Response) => {
    if (!assertStagingSecret(req, res)) return;
    const summary = getDriftReviewSummary();
    const includeEvents =
      req.query.includeEvents === "1" || req.query.includeEvents === "true" || req.query.includeEvents === "yes";
    const limitRaw = parseInt(String(req.query.limit || "200"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 200;
    const sinceRaw = req.query.sinceTs != null ? parseInt(String(req.query.sinceTs), 10) : NaN;
    const sinceTs = Number.isFinite(sinceRaw) ? sinceRaw : undefined;

    const body: Record<string, unknown> = { summary };
    if (includeEvents) {
      const events = getRecentDriftEvents({ sinceTs }).slice(-limit);
      body.events = events;
    }
    res.json(body);
  });

  app.get("/api/internal/ai-call-bot/sessions/:id/verify", async (req: Request, res: Response) => {
    if (!assertStagingSecret(req, res)) return;
    const clientIdParam = typeof req.query.clientId === "string" ? req.query.clientId.trim() : "";
    if (!clientIdParam) {
      return res.status(400).json({ error: "clientId query parameter required" });
    }
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const row = await getSessionById(id, clientIdParam);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ verify: verifyAiCallBotSessionRow(row) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`internal verify error: ${msg}`, TAG);
      res.status(500).json({ error: msg });
    }
  });

  log("AI Call Bot staging routes registered", TAG);
}
