/**
 * AI Call Bot — supervised transfer API (rails first: validate dial, then session CRUD, then signals).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { log } from "./logger";
import { validateReadyCallDial } from "./ai-call-bot/dial-guard";
import {
  createSession,
  getSessionById,
  getSessionByCallSid,
  transitionSession,
  markAgentIntercepted,
  markAgentAnswered,
  finalizeTerminal,
  attachCallSid,
  updateSignalFields,
} from "./ai-call-bot/transfer-controller";
import {
  transferAllowed,
  transferBlocked,
  shouldSwitchToInformationCapture,
  shouldExitCleanly,
  type TransferSignalSnapshot,
} from "./ai-call-bot/transfer-rules";
import { classifyCalleeFromUtterance } from "./ai-call-bot/gatekeeper-detect";
import type { TransferMachineEvent } from "./ai-call-bot/transfer-state-machine";
import { buildPostAgreementTransferTwiml, buildAgentNoAnswerFallbackTwiml } from "./ai-call-bot/twilio-transfer-hooks";
import { isValidTerminalOutcome } from "./ai-call-bot/types";
import { setHumanTakeoverActive } from "./realtime-coaching";
import { TRANSFER_MACHINE_EVENTS } from "./ai-call-bot/transfer-machine-events";
import { recordFallbackTriggered, logManualCleanupRequiredTrue } from "./ai-call-bot/anti-drift";

const TAG = "ai-call-bot";

function clientId(req: Request): string | null {
  return (req as any).user?.clientId || null;
}

const signalSchema = z.object({
  calleeType: z.enum(["gatekeeper", "decision_maker", "strong_influencer", "unknown"]).optional(),
  relevanceStatus: z.enum(["relevant", "not_relevant", "unknown"]).optional(),
  opennessStatus: z.enum(["negative", "neutral", "positive", "unknown"]).optional(),
  relevanceConfirmedOrStrongInfluence: z.boolean(),
  agreementToConnect: z.boolean(),
  wrongPersonNoDirection: z.boolean(),
  disinterest: z.boolean(),
  confusionOrFriction: z.boolean(),
  voicemail: z.boolean(),
  noAnswer: z.boolean(),
  badNumber: z.boolean(),
  hesitation: z.boolean(),
  callbackRequested: z.boolean(),
  referralWithoutImmediateHandoff: z.boolean(),
});

export function registerAiCallBotRoutes(app: Express, authMw: any) {
  app.post("/api/ai-call-bot/validate-dial", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const body = z.object({ flowId: z.number().int().positive(), outreachReason: z.string().min(3) }).parse(req.body);
      const result = await validateReadyCallDial({ clientId: cid, flowId: body.flowId, outreachReason: body.outreachReason });
      res.json(result);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      log(`validate-dial error: ${e.message}`, TAG);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai-call-bot/sessions", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const body = z
        .object({
          companyId: z.string().min(1),
          contactId: z.string().optional(),
          flowId: z.number().int().positive().optional(),
          callSid: z.string().optional(),
          streamSid: z.string().optional(),
          outreachReason: z.string().min(3),
        })
        .parse(req.body);
      const row = await createSession({
        clientId: cid,
        companyId: body.companyId,
        contactId: body.contactId,
        flowId: body.flowId,
        callSid: body.callSid,
        streamSid: body.streamSid,
        outreachReason: body.outreachReason,
      });
      res.status(201).json({ session: row });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      log(`create session error: ${e.message}`, TAG);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai-call-bot/sessions/:id/transition", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const body = z
        .object({
          event: z.string().refine((e): e is TransferMachineEvent => (TRANSFER_MACHINE_EVENTS as string[]).includes(e), "invalid event"),
          transferBlockReason: z.string().optional(),
          transferFailureReason: z.string().optional(),
          transferFailureDetail: z.string().optional(),
          calleeType: z.string().optional(),
        })
        .parse(req.body);
      const result = await transitionSession(id, cid, body.event as TransferMachineEvent, {
        transferBlockReason: body.transferBlockReason,
        transferFailureReason: body.transferFailureReason,
        transferFailureDetail: body.transferFailureDetail,
        calleeType: body.calleeType,
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, state: result.state });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai-call-bot/sessions/:id/intercept", authMw, async (req: Request, res: Response) => {
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
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai-call-bot/sessions/:id/agent-answered", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      await markAgentAnswered(id, cid);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai-call-bot/sessions/:id/evaluate-transfer", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getSessionById(id, cid);
      if (!row) return res.status(404).json({ error: "Not found" });

      const parsed = signalSchema.parse(req.body);
      const snapshot: TransferSignalSnapshot = {
        calleeType: parsed.calleeType ?? (row.calleeType as TransferSignalSnapshot["calleeType"]) ?? "unknown",
        relevanceStatus: parsed.relevanceStatus ?? (row.relevanceStatus as any) ?? "unknown",
        opennessStatus: parsed.opennessStatus ?? (row.opennessStatus as any) ?? "unknown",
        relevanceConfirmedOrStrongInfluence: parsed.relevanceConfirmedOrStrongInfluence,
        agreementToConnect: parsed.agreementToConnect,
        wrongPersonNoDirection: parsed.wrongPersonNoDirection,
        disinterest: parsed.disinterest,
        confusionOrFriction: parsed.confusionOrFriction,
        voicemail: parsed.voicemail,
        noAnswer: parsed.noAnswer,
        badNumber: parsed.badNumber,
        hesitation: parsed.hesitation,
        callbackRequested: parsed.callbackRequested,
        referralWithoutImmediateHandoff: parsed.referralWithoutImmediateHandoff,
      };

      const allowed = transferAllowed(snapshot);
      const blocked = transferBlocked(snapshot);
      const infoCapture = shouldSwitchToInformationCapture(snapshot);
      const exitClean = shouldExitCleanly(snapshot);

      await updateSignalFields(id, cid, {
        calleeType: snapshot.calleeType,
        relevanceStatus: snapshot.relevanceStatus,
        opennessStatus: snapshot.opennessStatus,
        hesitationDetected: snapshot.hesitation,
        hesitationReason: snapshot.hesitation ? "snapshot" : undefined,
        transferStatus: allowed ? "allowed" : blocked ? "blocked" : "pending",
      });

      const twiml = allowed ? buildPostAgreementTransferTwiml() : null;

      if (infoCapture) {
        recordFallbackTriggered("evaluate_transfer_switchToInformationCapture");
      }

      res.json({
        transferAllowed: allowed,
        transferBlocked: blocked,
        switchToInformationCapture: infoCapture,
        exitCleanly: exitClean,
        transferTwimlAvailable: !!twiml,
        transferPhraseRequired: "connecting you now",
      });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai-call-bot/sessions/:id/finalize", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const body = z
        .object({
          outcome: z.string(),
          decisionMakerName: z.string().nullable().optional(),
          decisionMakerTitle: z.string().nullable().optional(),
          interestLevel: z.string().nullable().optional(),
          objections: z.array(z.string()).nullable().optional(),
          followUpDate: z.string().nullable().optional(),
          nextBestAction: z.string().nullable().optional(),
          otherNotes: z.string().nullable().optional(),
          buyingSignals: z.array(z.string()).nullable().optional(),
        })
        .parse(req.body);

      if (!isValidTerminalOutcome(body.outcome)) {
        return res.status(400).json({ error: `Invalid terminal outcome. Allowed: use contract enums.` });
      }

      await finalizeTerminal({
        id,
        clientId: cid,
        outcome: body.outcome as any,
        decisionMakerName: body.decisionMakerName,
        decisionMakerTitle: body.decisionMakerTitle,
        interestLevel: body.interestLevel,
        objections: body.objections ?? undefined,
        followUpDate: body.followUpDate,
        nextBestAction: body.nextBestAction,
        otherNotes: body.otherNotes,
        buyingSignals: body.buyingSignals ?? undefined,
      });
      res.json({ ok: true });
    } catch (e: any) {
      if (e.message?.includes("other_notes")) return res.status(400).json({ error: e.message });
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/ai-call-bot/sessions/:id/call-sid", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      const { callSid } = z.object({ callSid: z.string().min(1) }).parse(req.body);
      await attachCallSid(id, cid, callSid);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/ai-call-bot/sessions/by-call/:callSid", authMw, async (req: Request, res: Response) => {
    try {
      const cid = clientId(req);
      if (!cid) return res.status(400).json({ error: "No client context" });
      const row = await getSessionByCallSid(req.params.callSid, cid);
      if (!row) return res.status(404).json({ error: "Not found" });
      if (row.manualCleanupRequired) {
        logManualCleanupRequiredTrue(row.id, "get_by_callSid");
      }
      res.json({ session: row });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai-call-bot/classify-utterance", authMw, async (req: Request, res: Response) => {
    const { text } = z.object({ text: z.string() }).parse(req.body);
    res.json({ calleeType: classifyCalleeFromUtterance(text) });
  });

  app.get("/api/ai-call-bot/twiml/agent-unavailable", (_req: Request, res: Response) => {
    res.type("text/xml").send(buildAgentNoAnswerFallbackTwiml());
  });

  log("AI Call Bot routes registered", TAG);
}
