/**
 * Single persistence path for AI Call Bot sessions. Failures throw; routes catch and avoid partial corrupt updates.
 */
import { db } from "../db";
import { aiCallBotSessions } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type { AiCallBotTransferState, AiCallTerminalOutcome } from "./types";
import { applyTransition, type TransferMachineEvent } from "./transfer-state-machine";
import { defaultSupervisedMode } from "./transfer-constants";

export async function createSession(params: {
  clientId: string;
  companyId: string;
  contactId?: string | null;
  flowId?: number | null;
  callSid?: string | null;
  streamSid?: string | null;
  outreachReason: string;
}): Promise<typeof aiCallBotSessions.$inferSelect> {
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
      supervisedMode: defaultSupervisedMode(),
      manualCleanupRequired: false,
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

export async function getSessionByCallSid(callSid: string, clientId: string) {
  const [row] = await db
    .select()
    .from(aiCallBotSessions)
    .where(and(eq(aiCallBotSessions.callSid, callSid), eq(aiCallBotSessions.clientId, clientId)))
    .orderBy(desc(aiCallBotSessions.createdAt))
    .limit(1);
  return row ?? null;
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

  const current = row.currentState as AiCallBotTransferState;
  const result = applyTransition(current, event);
  if (!result.ok) return { ok: false, error: result.reason };

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

  await db.update(aiCallBotSessions).set(updates as any).where(eq(aiCallBotSessions.id, id));

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
