/**
 * Single persistence path for AI Call Bot sessions. Failures throw; routes catch and avoid partial corrupt updates.
 */
import { db } from "../db";
import { aiCallBotSessions } from "@shared/schema";
import { eq, and, desc, sql, ne, gte } from "drizzle-orm";
import type { AiCallBotTransferState, AiCallTerminalOutcome } from "./types";
import { applyTransition, type TransferMachineEvent } from "./transfer-state-machine";
import { defaultSupervisedMode } from "./transfer-constants";
import { logTransferInitiatedWithoutAgreement } from "./anti-drift";
import { mapTwilioStatusToFsmEvent, logRejectedTransition, type TwilioStatusPayload } from "./twilio-status-mapper";
import { parseSupervisorAttentionReasonsJson } from "./supervisor-escalation";

export async function createSession(params: {
  clientId: string;
  companyId: string;
  contactId?: string | null;
  flowId?: number | null;
  callSid?: string | null;
  streamSid?: string | null;
  outreachReason: string;
  isSandboxSession?: boolean;
  sandboxContactId?: number | null;
}): Promise<typeof aiCallBotSessions.$inferSelect> {
  const isSandbox = params.isSandboxSession === true;
  const [row] = await db
    .insert(aiCallBotSessions)
    .values({
      clientId: params.clientId,
      companyId: params.companyId,
      contactId: params.contactId ?? null,
      flowId: params.flowId ?? null,
      callSid: params.callSid ?? null,
      streamSid: params.streamSid ?? null,
      outreachReason: params.outreachReason.trim(),
      currentState: "queued_ready_call",
      supervisedMode: isSandbox ? true : defaultSupervisedMode(),
      manualCleanupRequired: false,
      isSandboxSession: isSandbox,
      sandboxContactId: isSandbox ? (params.sandboxContactId ?? null) : null,
    })
    .returning();
  return row;
}

export async function getSessionById(id: number, clientId: string) {
  const [row] = await db
    .select()
    .from(aiCallBotSessions)
    .where(and(eq(aiCallBotSessions.id, id), eq(aiCallBotSessions.clientId, clientId)))
    .limit(1);
  return row ?? null;
}

/** Non-terminal sessions recently updated — live supervisor list (auditable filter). */
export async function listActiveAiCallBotSessionsForSupervisor(
  clientId: string,
  maxHoursStale = 8,
  limit = 50,
  options?: { includeSandbox?: boolean }
): Promise<(typeof aiCallBotSessions.$inferSelect)[]> {
  const cutoff = new Date(Date.now() - maxHoursStale * 3600 * 1000);
  const parts = [
    eq(aiCallBotSessions.clientId, clientId),
    ne(aiCallBotSessions.currentState, "terminal"),
    gte(aiCallBotSessions.updatedAt, cutoff),
  ];
  if (!options?.includeSandbox) {
    parts.push(eq(aiCallBotSessions.isSandboxSession, false));
  }
  return db
    .select()
    .from(aiCallBotSessions)
    .where(and(...parts))
    .orderBy(desc(aiCallBotSessions.updatedAt))
    .limit(limit);
}

/** Append a stable reason code; sets supervisor_attention_required. Single write path for operator escalation flags. */
export async function appendSupervisorAttentionReason(id: number, clientId: string, reason: string): Promise<void> {
  const row = await getSessionById(id, clientId);
  if (!row) return;
  const existing = parseSupervisorAttentionReasonsJson(row.supervisorAttentionReasons);
  if (!existing.includes(reason)) existing.push(reason);
  await db
    .update(aiCallBotSessions)
    .set({
      supervisorAttentionRequired: true,
      supervisorAttentionReasons: JSON.stringify(existing),
      updatedAt: new Date(),
    })
    .where(and(eq(aiCallBotSessions.id, id), eq(aiCallBotSessions.clientId, clientId)));
}

export async function setSupervisorPauseAutoTransfer(
  id: number,
  clientId: string,
  paused: boolean,
  reason?: string | null
): Promise<void> {
  const now = new Date();
  await db
    .update(aiCallBotSessions)
    .set({
      supervisorPauseAutoTransfer: paused,
      supervisorPausedAt: paused ? now : null,
      supervisorPauseReason: paused ? (reason ?? null) : null,
      updatedAt: now,
    })
    .where(and(eq(aiCallBotSessions.id, id), eq(aiCallBotSessions.clientId, clientId)));
}

export async function clearSupervisorPauseAutoTransfer(id: number, clientId: string): Promise<void> {
  await setSupervisorPauseAutoTransfer(id, clientId, false, null);
}

export async function getSessionByCallSid(callSid: string, clientId: string) {
  const [row] = await db
    .select()
    .from(aiCallBotSessions)
    .where(and(eq(aiCallBotSessions.callSid, callSid), eq(aiCallBotSessions.clientId, clientId)))
    .orderBy(desc(aiCallBotSessions.createdAt))
    .limit(1);
  return row ?? null;
}

/** Internal: Twilio webhooks / media stream — resolve session by parent or child CallSid. */
export async function findAiCallBotSessionForTwilioStatus(callSid: string, parentCallSid?: string | null) {
  const [bySid] = await db
    .select()
    .from(aiCallBotSessions)
    .where(eq(aiCallBotSessions.callSid, callSid))
    .orderBy(desc(aiCallBotSessions.createdAt))
    .limit(1);
  if (bySid) return bySid;
  if (parentCallSid) {
    const [byParent] = await db
      .select()
      .from(aiCallBotSessions)
      .where(eq(aiCallBotSessions.callSid, parentCallSid))
      .orderBy(desc(aiCallBotSessions.createdAt))
      .limit(1);
    return byParent ?? null;
  }
  return null;
}

/**
 * Twilio → FSM: single path via transitionSession. Invalid transitions are logged and skipped.
 * Persist rejected transition attempts for audit / supervisor escalation (no silent corruption).
 */
async function recordFsmRejection(id: number, clientId: string, reason: string, callSid: string | null): Promise<void> {
  try {
    await db
      .update(aiCallBotSessions)
      .set({
        fsmRejectedTransitionCount: sql`${aiCallBotSessions.fsmRejectedTransitionCount} + 1`,
        lastFsmRejectedReason: reason.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(and(eq(aiCallBotSessions.id, id), eq(aiCallBotSessions.clientId, clientId)));
    const { recordDriftEvent } = await import("./anti-drift");
    recordDriftEvent({
      kind: "fsm_rejected_transition",
      sessionId: id,
      clientId,
      callSid: callSid ?? undefined,
      detail: reason,
    });
    await appendSupervisorAttentionReason(id, clientId, "fsm_rejected_transition");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ai-call-bot] recordFsmRejection failed: ${msg}`);
  }
}

export async function applyTwilioWebhookToAiCallBotFsm(payload: TwilioStatusPayload): Promise<void> {
  try {
    const row = await findAiCallBotSessionForTwilioStatus(payload.CallSid, payload.ParentCallSid || null);
    if (!row) return;

    const currentState = row.currentState as AiCallBotTransferState;
    if (currentState === "terminal") return;

    /** Transfer child leg (Dial) answered — ParentCallSid present; avoid parent-call in-progress noise. */
    if (currentState === "transfer_initiated" && payload.ParentCallSid) {
      const st = (payload.CallStatus || "").toLowerCase().trim();
      if (st === "in-progress" || st === "answered") {
        await markAgentAnswered(row.id, row.clientId);
        return;
      }
    }

    const event = mapTwilioStatusToFsmEvent(currentState, payload);
    if (!event) return;

    const result = await transitionSession(row.id, row.clientId, event);
    if (!result.ok) {
      logRejectedTransition(payload.CallSid, event, result.error);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ai-call-bot-fsm] applyTwilioWebhook error: ${msg}`);
  }
}

export async function transitionSession(
  id: number,
  clientId: string,
  event: TransferMachineEvent,
  patch?: Partial<{
    transferBlockReason: string;
    transferFailureReason: string;
    transferFailureDetail: string;
    calleeType: string;
  }>
): Promise<{ ok: true; state: AiCallBotTransferState } | { ok: false; error: string }> {
  const row = await getSessionById(id, clientId);
  if (!row) return { ok: false, error: "Session not found" };

  if (event === "initiate_transfer" && row.supervisorPauseAutoTransfer) {
    await recordFsmRejection(
      id,
      clientId,
      "initiate_transfer blocked: supervisor_pause_auto_transfer active",
      row.callSid ?? null
    );
    return { ok: false, error: "initiate_transfer blocked: supervisor pause (do-not-auto-transfer) is active" };
  }

  const current = row.currentState as AiCallBotTransferState;
  const result = applyTransition(current, event);
  if (!result.ok) {
    await recordFsmRejection(id, clientId, result.reason, row.callSid ?? null);
    return { ok: false, error: result.reason };
  }

  if (event === "initiate_transfer") {
    if (!row.transferAgreedAt) {
      const allowUnsafe =
        process.env.AI_CALL_BOT_ALLOW_UNSAFE_TRANSFER === "1" ||
        process.env.AI_CALL_BOT_ALLOW_UNSAFE_TRANSFER === "true";
      if (!allowUnsafe) {
        logTransferInitiatedWithoutAgreement(row.id, row.clientId);
        await recordFsmRejection(
          id,
          clientId,
          "initiate_transfer blocked: transfer_agreed_at required (set AI_CALL_BOT_ALLOW_UNSAFE_TRANSFER only for debug)",
          row.callSid ?? null
        );
        await appendSupervisorAttentionReason(id, clientId, "transfer_attempted_without_agreement");
        return { ok: false, error: "initiate_transfer blocked: transfer_agreed_at required (set AI_CALL_BOT_ALLOW_UNSAFE_TRANSFER only for debug)" };
      }
    }
  }

  const now = new Date();
  const updates: Record<string, unknown> = {
    currentState: result.next,
    updatedAt: now,
  };
  if (patch?.transferBlockReason) updates.transferBlockReason = patch.transferBlockReason;
  if (patch?.transferFailureReason) updates.transferFailureReason = patch.transferFailureReason;
  if (patch?.transferFailureDetail) updates.transferFailureDetail = patch.transferFailureDetail;
  if (patch?.calleeType) updates.calleeType = patch.calleeType;

  if (event === "offer_transfer") updates.transferOfferedAt = now;
  if (event === "agree_transfer") updates.transferAgreedAt = now;
  if (event === "initiate_transfer") updates.transferInitiatedAt = now;
  if (event === "transfer_success") updates.transferCompletedAt = now;
  if (event === "agent_no_answer") {
    updates.agentAnswered = false;
    updates.transferFailureReason = "agent_no_answer";
  }

  if (event === "fallback_capture_started") {
    updates.sessionFallbackFsmCount = sql`${aiCallBotSessions.sessionFallbackFsmCount} + 1`;
  }

  const [updatedRow] = await db
    .update(aiCallBotSessions)
    .set(updates as any)
    .where(eq(aiCallBotSessions.id, id))
    .returning({ sessionFallbackFsmCount: aiCallBotSessions.sessionFallbackFsmCount });

  if (event === "fallback_capture_started") {
    const { recordFallbackTriggered } = await import("./anti-drift");
    recordFallbackTriggered("fsm_fallback_capture_started");
    const th = (await import("./supervisor-thresholds")).getSupervisorFallbackFsmEscalationThreshold();
    const cnt = updatedRow?.sessionFallbackFsmCount ?? 0;
    if (cnt >= th) {
      await appendSupervisorAttentionReason(id, clientId, "repeated_fallback_in_session");
    }
  }

  return { ok: true, state: result.next };
}

export async function markAgentIntercepted(id: number, clientId: string): Promise<boolean> {
  const row = await getSessionById(id, clientId);
  if (!row) return false;
  const now = new Date();
  const tr = applyTransition(row.currentState as AiCallBotTransferState, "human_intercept");
  const nextState = tr.ok ? tr.next : "human_takeover_active";
  await db
    .update(aiCallBotSessions)
    .set({
      agentIntercepted: true,
      agentInterceptedAt: now,
      currentState: nextState,
      updatedAt: now,
    })
    .where(eq(aiCallBotSessions.id, id));
  return true;
}

export async function markAgentAnswered(id: number, clientId: string): Promise<void> {
  const now = new Date();
  await db
    .update(aiCallBotSessions)
    .set({ agentAnswered: true, agentAnsweredAt: now, updatedAt: now })
    .where(and(eq(aiCallBotSessions.id, id), eq(aiCallBotSessions.clientId, clientId)));
}

export async function finalizeTerminal(params: {
  id: number;
  clientId: string;
  outcome: AiCallTerminalOutcome;
  decisionMakerName?: string | null;
  decisionMakerTitle?: string | null;
  interestLevel?: string | null;
  objections?: string[] | null;
  followUpDate?: string | null;
  nextBestAction?: string | null;
  otherNotes?: string | null;
  buyingSignals?: string[] | null;
}): Promise<void> {
  if (params.outcome === "other" && !(params.otherNotes || "").trim()) {
    const { logMissingOtherNotes } = await import("./anti-drift");
    logMissingOtherNotes(params.id);
    throw new Error("Terminal outcome 'other' requires other_notes");
  }

  const now = new Date();
  await db
    .update(aiCallBotSessions)
    .set({
      currentState: "terminal",
      callOutcome: params.outcome,
      decisionMakerName: params.decisionMakerName ?? null,
      decisionMakerTitle: params.decisionMakerTitle ?? null,
      interestLevel: params.interestLevel ?? null,
      objections: params.objections?.length ? JSON.stringify(params.objections) : null,
      followUpDate: params.followUpDate ?? null,
      nextBestAction: params.nextBestAction ?? null,
      otherNotes: params.otherNotes ?? null,
      buyingSignals: params.buyingSignals?.length ? JSON.stringify(params.buyingSignals) : null,
      manualCleanupRequired: false,
      updatedAt: now,
    })
    .where(and(eq(aiCallBotSessions.id, params.id), eq(aiCallBotSessions.clientId, params.clientId)));
}

export async function attachCallSid(id: number, clientId: string, callSid: string): Promise<void> {
  await db
    .update(aiCallBotSessions)
    .set({ callSid, updatedAt: new Date() })
    .where(and(eq(aiCallBotSessions.id, id), eq(aiCallBotSessions.clientId, clientId)));
}

export async function updateSignalFields(
  id: number,
  clientId: string,
  fields: Partial<{
    calleeType: string;
    relevanceStatus: string;
    opennessStatus: string;
    hesitationDetected: boolean;
    hesitationReason: string;
    fallbackCaptureUsed: boolean;
    fallbackCaptureType: string;
    transferStatus: string;
  }>
): Promise<void> {
  await db
    .update(aiCallBotSessions)
    .set({ ...fields, updatedAt: new Date() } as any)
    .where(and(eq(aiCallBotSessions.id, id), eq(aiCallBotSessions.clientId, clientId)));
}
