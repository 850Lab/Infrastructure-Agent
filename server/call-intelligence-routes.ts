import type { Express, Request, Response } from "express";
import { authMiddleware } from "./auth";
import { db } from "./db";
import { callIntelligence, companyFlows, outreachPipeline, actionQueue } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { log } from "./logger";
import { analyzeTranscript, type CallAnalysisResult } from "./services/call-intelligence-service";

function getClientId(req: any): string | null {
  return req.user?.clientId || null;
}

function applyLeadUpdates(
  clientId: string,
  companyId: string,
  companyName: string | undefined,
  analysis: CallAnalysisResult
): void {
  const now = new Date();
  const followUpDate = analysis.suggested_follow_up_date ? new Date(analysis.suggested_follow_up_date) : null;

  if (analysis.primary_outcome === "interested" || (analysis.primary_outcome === "decision_maker" && analysis.interest_score >= 60)) {
    db.update(companyFlows)
      .set({
        lastOutcome: "interested",
        warmStage: "verified_warm",
        outcomeSource: "call_intelligence",
        transcriptSummary: analysis.summary,
        verifiedQualityScore: analysis.interest_score,
        nextAction: analysis.next_action === "schedule_follow_up" && followUpDate ? `Follow up ${followUpDate.toLocaleDateString()}` : "Schedule follow-up",
        callbackAt: followUpDate,
        updatedAt: now,
      })
      .where(and(eq(companyFlows.clientId, clientId), eq(companyFlows.companyId, companyId)))
      .then(() => log(`Call intelligence: marked ${companyName || companyId} as interested`, "call-intelligence"))
      .catch((e) => log(`Call intelligence lead update failed: ${e.message}`, "call-intelligence"));
  } else if (analysis.primary_outcome === "call_back") {
    db.update(companyFlows)
      .set({
        lastOutcome: "followup_scheduled",
        outcomeSource: "call_intelligence",
        transcriptSummary: analysis.summary,
        nextAction: followUpDate ? `Callback requested — ${followUpDate.toLocaleDateString()}` : "Schedule callback",
        callbackAt: followUpDate,
        updatedAt: now,
      })
      .where(and(eq(companyFlows.clientId, clientId), eq(companyFlows.companyId, companyId)))
      .then(() => log(`Call intelligence: marked ${companyName || companyId} for callback`, "call-intelligence"))
      .catch((e) => log(`Call intelligence lead update failed: ${e.message}`, "call-intelligence"));
  } else if (analysis.primary_outcome === "no_answer") {
    db.update(companyFlows)
      .set({
        lastOutcome: "no_answer",
        outcomeSource: "call_intelligence",
        transcriptSummary: analysis.summary,
        lastAttemptAt: now,
        updatedAt: now,
      })
      .where(and(eq(companyFlows.clientId, clientId), eq(companyFlows.companyId, companyId)))
      .then(() => log(`Call intelligence: no_answer for ${companyName || companyId}`, "call-intelligence"))
      .catch((e) => log(`Call intelligence lead update failed: ${e.message}`, "call-intelligence"));
  } else if (analysis.primary_outcome === "gatekeeper") {
    db.update(companyFlows)
      .set({
        lastOutcome: "gatekeeper",
        outcomeSource: "call_intelligence",
        transcriptSummary: analysis.summary,
        notes: analysis.decision_maker_name ? `DM mentioned: ${analysis.decision_maker_name}` : "Gatekeeper encountered",
        updatedAt: now,
      })
      .where(and(eq(companyFlows.clientId, clientId), eq(companyFlows.companyId, companyId)))
      .then(() => log(`Call intelligence: gatekeeper for ${companyName || companyId}`, "call-intelligence"))
      .catch((e) => log(`Call intelligence lead update failed: ${e.message}`, "call-intelligence"));
  } else if (analysis.primary_outcome === "wrong_fit" || analysis.primary_outcome === "not_interested") {
    db.update(companyFlows)
      .set({
        lastOutcome: "not_interested",
        outcomeSource: "call_intelligence",
        transcriptSummary: analysis.summary,
        priority: sql`LEAST(${companyFlows.priority}, 20)`,
        status: "active",
        updatedAt: now,
      })
      .where(and(eq(companyFlows.clientId, clientId), eq(companyFlows.companyId, companyId)))
      .then(() => log(`Call intelligence: parked ${companyName || companyId}`, "call-intelligence"))
      .catch((e) => log(`Call intelligence lead update failed: ${e.message}`, "call-intelligence"));
  } else if (analysis.primary_outcome === "decision_maker" && analysis.interest_score >= 40) {
    db.update(companyFlows)
      .set({
        lastOutcome: "live_answer",
        outcomeSource: "call_intelligence",
        transcriptSummary: analysis.summary,
        verifiedQualityScore: analysis.interest_score,
        nextAction: analysis.next_action === "schedule_follow_up" && followUpDate ? `Follow up ${followUpDate.toLocaleDateString()}` : analysis.next_action,
        callbackAt: followUpDate,
        updatedAt: now,
      })
      .where(and(eq(companyFlows.clientId, clientId), eq(companyFlows.companyId, companyId)))
      .then(() => log(`Call intelligence: DM reached for ${companyName || companyId}`, "call-intelligence"))
      .catch((e) => log(`Call intelligence lead update failed: ${e.message}`, "call-intelligence"));
  }

  if (followUpDate && followUpDate > now) {
    db.update(actionQueue)
      .set({ dueAt: followUpDate, taskType: `Follow up ${followUpDate.toLocaleDateString()}` })
      .where(and(eq(actionQueue.clientId, clientId), eq(actionQueue.companyId, companyId), eq(actionQueue.status, "pending")))
      .then(() => {})
      .catch(() => {});
  }
}

// TODO Phase 2: Wire Twilio processRecording to call processCallIntelligenceFromTranscript() after
// transcription completes, so completed outbound calls auto-populate call_intelligence without manual POST.

export function registerCallIntelligenceRoutes(app: Express, authMiddlewareFn: any) {
  app.post("/api/call-intelligence/process", authMiddlewareFn, async (req: Request, res: Response) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) {
        return res.status(400).json({ error: "No client context" });
      }

      const {
        companyId,
        contactId,
        callSid,
        recordingSid,
        phoneNumber,
        transcriptText,
        companyName,
        contactName,
      } = req.body;

      if (!transcriptText || typeof transcriptText !== "string" || !transcriptText.trim()) {
        return res.status(400).json({ error: "transcriptText is required and must be non-empty" });
      }

      if (!phoneNumber || typeof phoneNumber !== "string" || !phoneNumber.trim()) {
        return res.status(400).json({ error: "phoneNumber is required" });
      }

      if (!companyId || typeof companyId !== "string") {
        return res.status(400).json({ error: "companyId is required" });
      }

      const analysis = await analyzeTranscript({
        transcriptText: transcriptText.trim(),
        phoneNumber: String(phoneNumber).trim(),
        companyName: companyName ? String(companyName).trim() : undefined,
        contactName: contactName ? String(contactName).trim() : undefined,
      });

      const [record] = await db
        .insert(callIntelligence)
        .values({
          clientId,
          companyId: String(companyId),
          contactId: contactId ? String(contactId) : null,
          callSid: callSid ? String(callSid) : null,
          recordingSid: recordingSid ? String(recordingSid) : null,
          phoneNumber: String(phoneNumber).trim(),
          transcriptText: transcriptText.trim(),
          primaryOutcome: analysis.primary_outcome,
          hasHeatExposure: analysis.has_heat_exposure,
          currentSolution: analysis.current_solution,
          urgencyLevel: analysis.urgency_level,
          jobType: analysis.job_type,
          decisionMakerName: analysis.decision_maker_name,
          timeline: analysis.timeline,
          interestScore: analysis.interest_score,
          buyingSignals: JSON.stringify(analysis.buying_signals),
          objections: JSON.stringify(analysis.objections),
          summary: analysis.summary,
          nextAction: analysis.next_action,
          suggestedFollowUpDate: analysis.suggested_follow_up_date,
          analysisRaw: JSON.stringify(analysis),
        })
        .returning();

      applyLeadUpdates(clientId, String(companyId), companyName ? String(companyName).trim() : undefined, analysis);

      res.json({
        ok: true,
        record: {
          id: record.id,
          primaryOutcome: record.primaryOutcome,
          interestScore: record.interestScore,
          summary: record.summary,
          nextAction: record.nextAction,
          suggestedFollowUpDate: record.suggestedFollowUpDate,
          buyingSignals: analysis.buying_signals,
          objections: analysis.objections,
          createdAt: record.createdAt,
        },
        analysis: {
          primary_outcome: analysis.primary_outcome,
          interest_score: analysis.interest_score,
          next_action: analysis.next_action,
        },
      });
    } catch (err: any) {
      log(`Call intelligence process error: ${err.message}`, "call-intelligence");
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/call-intelligence/company/:companyId", authMiddlewareFn, async (req: Request, res: Response) => {
    try {
      const clientId = getClientId(req);
      if (!clientId) {
        return res.status(400).json({ error: "No client context" });
      }

      const { companyId } = req.params;
      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const records = await db
        .select()
        .from(callIntelligence)
        .where(and(eq(callIntelligence.clientId, clientId), eq(callIntelligence.companyId, companyId)))
        .orderBy(desc(callIntelligence.createdAt))
        .limit(20);

      const formatted = records.map((r) => ({
        id: r.id,
        callSid: r.callSid,
        recordingSid: r.recordingSid,
        phoneNumber: r.phoneNumber,
        primaryOutcome: r.primaryOutcome,
        hasHeatExposure: r.hasHeatExposure,
        currentSolution: r.currentSolution,
        urgencyLevel: r.urgencyLevel,
        jobType: r.jobType,
        decisionMakerName: r.decisionMakerName,
        timeline: r.timeline,
        interestScore: r.interestScore,
        buyingSignals: r.buyingSignals ? JSON.parse(r.buyingSignals) : [],
        objections: r.objections ? JSON.parse(r.objections) : [],
        summary: r.summary,
        nextAction: r.nextAction,
        suggestedFollowUpDate: r.suggestedFollowUpDate,
        createdAt: r.createdAt,
      }));

      res.json({ records: formatted });
    } catch (err: any) {
      log(`Call intelligence read error: ${err.message}`, "call-intelligence");
      res.status(500).json({ error: err.message });
    }
  });

  log("Call intelligence routes registered", "call-intelligence");
}
