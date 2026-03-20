/**
 * Server-side contract for live supervisor monitoring (read-mostly + explicit flags).
 */
import type { AiCallBotSession } from "@shared/schema";
import { outreachPipeline } from "@shared/schema";
import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { getRecentDriftEvents, getDriftReviewSummary } from "./anti-drift";
import { verifyAiCallBotSessionRow } from "./session-verify";
import { parseSupervisorAttentionReasonsJson } from "./supervisor-escalation";
import { getLongCallThresholdSec, getSupervisorFallbackFsmEscalationThreshold } from "./supervisor-thresholds";
import {
  buildOperatorGuidanceFromLiveView,
  type OperatorGuidancePayload,
  type OperatorGuidanceInput,
} from "./supervisor-operator-guidance";

export interface SupervisorLiveSessionView {
  sessionId: number;
  clientId: string;
  callSid: string | null;
  companyId: string;
  companyName: string;
  currentFsmState: string;
  terminalOutcome: string | null;
  calleeClassification: string | null;
  relevanceStatus: string | null;
  opennessStatus: string | null;
  transferEligibility: "eligible" | "not_eligible" | "unknown";
  transferStatus: string | null;
  fallbackTriggered: boolean;
  agentAnswered: boolean;
  agentIntercepted: boolean;
  driftFlags: {
    persistentSupervisorAttentionRequired: boolean;
    persistentAttentionReasons: string[];
    replyOverContract: boolean;
    longCallExceedsThreshold: boolean;
    transferAttemptedWithoutAgreement: boolean;
    fsmRejectedTransition: boolean;
    missingTransferTargetTransferEligible: boolean;
    repeatedFallbackInSession: boolean;
    processWideFallbackHighRate: boolean;
    terminalContractGaps: boolean;
  };
  rejectedTransitionCount: number;
  lastRejectedTransitionReason: string | null;
  startedAtIso: string;
  durationSecondsSoFar: number;
  supervisorPauseAutoTransfer: boolean;
  supervisorPausedAtIso: string | null;
  supervisorPauseReason: string | null;
  sessionFallbackFsmCount: number;
  gatheredAtIso: string;
  isSandboxSession: boolean;
  sandboxContactId: number | null;
  /** Deterministic operator quick-reference from driftFlags + session shape (see runbook). */
  operatorGuidance: OperatorGuidancePayload;
}

async function resolveCompanyName(clientId: string, companyId: string): Promise<string> {
  const [r] = await db
    .select({ companyName: outreachPipeline.companyName })
    .from(outreachPipeline)
    .where(and(eq(outreachPipeline.clientId, clientId), eq(outreachPipeline.companyId, companyId)))
    .limit(1);
  return r?.companyName?.trim() || companyId;
}

function computeTransferEligibility(row: AiCallBotSession): "eligible" | "not_eligible" | "unknown" {
  const ts = row.transferStatus;
  if (ts === "allowed") return "eligible";
  if (ts === "blocked") return "not_eligible";
  const s = row.currentState;
  if (
    s === "transfer_eligible" ||
    s === "transfer_offered" ||
    s === "transfer_agreed" ||
    s === "transfer_initiated"
  ) {
    return "eligible";
  }
  return "unknown";
}

export async function buildSupervisorLiveSessionView(
  row: AiCallBotSession,
  coachingStartedAtMs: number | null
): Promise<SupervisorLiveSessionView> {
  const now = Date.now();
  const companyName = await resolveCompanyName(row.clientId, row.companyId);
  const verify = verifyAiCallBotSessionRow(row);
  const drift = getRecentDriftEvents({
    sessionId: row.id,
    callSid: row.callSid ?? undefined,
  });
  const kinds = new Set(drift.map((e) => e.kind));
  const persistentReasons = parseSupervisorAttentionReasonsJson(row.supervisorAttentionReasons);
  const longTh = getLongCallThresholdSec();
  const startedMs = coachingStartedAtMs ?? (row.createdAt ? new Date(row.createdAt).getTime() : now);
  const durationSec = Math.max(0, Math.floor((now - startedMs) / 1000));
  const summary = getDriftReviewSummary();
  const fallbackTh = getSupervisorFallbackFsmEscalationThreshold();

  const transferEligibility = computeTransferEligibility(row);
  const missingTarget =
    persistentReasons.includes("missing_transfer_target_transfer_eligible") ||
    (transferEligibility === "eligible" &&
      kinds.has("missing_transfer_target_env") &&
      !row.supervisorPauseAutoTransfer);

  const driftFlags = {
    persistentSupervisorAttentionRequired: row.supervisorAttentionRequired,
    persistentAttentionReasons: [...persistentReasons],
    replyOverContract: kinds.has("reply_over_contract") || persistentReasons.includes("reply_over_contract"),
    longCallExceedsThreshold:
      durationSec >= longTh ||
      kinds.has("long_call") ||
      kinds.has("repeated_long_call_pattern") ||
      persistentReasons.includes("long_call_threshold_exceeded"),
    transferAttemptedWithoutAgreement:
      kinds.has("transfer_without_agreement") || persistentReasons.includes("transfer_attempted_without_agreement"),
    fsmRejectedTransition:
      (row.fsmRejectedTransitionCount ?? 0) > 0 ||
      kinds.has("fsm_rejected_transition") ||
      persistentReasons.includes("fsm_rejected_transition"),
    missingTransferTargetTransferEligible: missingTarget,
    repeatedFallbackInSession:
      (row.sessionFallbackFsmCount ?? 0) >= fallbackTh || persistentReasons.includes("repeated_fallback_in_session"),
    processWideFallbackHighRate: summary.fallbackInWindow >= summary.fallbackAlertThreshold,
    terminalContractGaps: verify.terminalFieldGaps.length > 0,
  };

  const core = {
    sessionId: row.id,
    clientId: row.clientId,
    callSid: row.callSid,
    companyId: row.companyId,
    companyName,
    currentFsmState: row.currentState,
    terminalOutcome: row.callOutcome,
    calleeClassification: row.calleeType,
    relevanceStatus: row.relevanceStatus,
    opennessStatus: row.opennessStatus,
    transferEligibility,
    transferStatus: row.transferStatus,
    fallbackTriggered: row.fallbackCaptureUsed || (row.sessionFallbackFsmCount ?? 0) > 0,
    agentAnswered: row.agentAnswered,
    agentIntercepted: row.agentIntercepted,
    driftFlags,
    rejectedTransitionCount: row.fsmRejectedTransitionCount ?? 0,
    lastRejectedTransitionReason: row.lastFsmRejectedReason ?? null,
    startedAtIso: new Date(startedMs).toISOString(),
    durationSecondsSoFar: durationSec,
    supervisorPauseAutoTransfer: row.supervisorPauseAutoTransfer,
    supervisorPausedAtIso: row.supervisorPausedAt ? new Date(row.supervisorPausedAt).toISOString() : null,
    supervisorPauseReason: row.supervisorPauseReason ?? null,
    sessionFallbackFsmCount: row.sessionFallbackFsmCount ?? 0,
    gatheredAtIso: new Date(now).toISOString(),
    isSandboxSession: row.isSandboxSession ?? false,
    sandboxContactId: row.sandboxContactId ?? null,
  };

  const guidanceInput: OperatorGuidanceInput = {
    currentFsmState: core.currentFsmState,
    transferEligibility: core.transferEligibility,
    supervisorPauseAutoTransfer: core.supervisorPauseAutoTransfer,
    rejectedTransitionCount: core.rejectedTransitionCount,
    agentIntercepted: core.agentIntercepted,
    durationSecondsSoFar: core.durationSecondsSoFar,
    driftFlags: core.driftFlags,
  };

  return {
    ...core,
    operatorGuidance: buildOperatorGuidanceFromLiveView(guidanceInput),
  };
}
