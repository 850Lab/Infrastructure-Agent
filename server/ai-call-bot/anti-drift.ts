/**
 * Runtime anti-drift logging — no silent violations of AI Call Bot contract.
 * In-process ring buffer supports staging drift-review (no alternate FSM writes).
 */
import { log } from "../logger";

const TAG = "ai-call-bot-drift";
const FALLBACK_WINDOW_MS = 60 * 60 * 1000;
const FALLBACK_ALERT_THRESHOLD = 15;
let fallbackTimestamps: number[] = [];

/** In-process: same CallSid exceeding long-call threshold more than once in a process lifetime. */
const longCallRepeatCount = new Map<string, number>();

const DRIFT_RING_MAX = 1000;
const driftRing: DriftEvent[] = [];

export type DriftEventKind =
  | "reply_over_contract"
  | "long_call"
  | "repeated_long_call_pattern"
  | "transfer_without_agreement"
  | "other_outcome_missing_notes"
  | "missing_transfer_target_env"
  | "manual_cleanup_required_true"
  | "fallback_triggered"
  | "fallback_high_rate"
  | "fsm_rejected_transition";

export interface DriftEvent {
  ts: number;
  kind: DriftEventKind;
  callSid?: string;
  sessionId?: number;
  clientId?: string;
  detail?: string;
}

export function recordDriftEvent(e: Omit<DriftEvent, "ts"> & { ts?: number }): void {
  const ev: DriftEvent = {
    ts: e.ts ?? Date.now(),
    kind: e.kind,
    callSid: e.callSid,
    sessionId: e.sessionId,
    clientId: e.clientId,
    detail: e.detail,
  };
  driftRing.push(ev);
  while (driftRing.length > DRIFT_RING_MAX) driftRing.shift();
}

export function getRecentDriftEvents(filter?: {
  kinds?: DriftEventKind[];
  callSid?: string;
  sessionId?: number;
  sinceTs?: number;
}): DriftEvent[] {
  let out = [...driftRing];
  if (filter?.sinceTs != null) out = out.filter((e) => e.ts >= filter.sinceTs!);
  if (filter?.kinds?.length) out = out.filter((e) => filter.kinds!.includes(e.kind));
  const idFns: ((e: DriftEvent) => boolean)[] = [];
  if (filter?.callSid) idFns.push((e) => e.callSid === filter.callSid);
  if (filter?.sessionId != null) idFns.push((e) => e.sessionId === filter.sessionId);
  if (idFns.length > 0) out = out.filter((e) => idFns.some((fn) => fn(e)));
  return out;
}

export function getDriftReviewSummary(): {
  generatedAt: number;
  eventCountInRing: number;
  countsByKind: Partial<Record<DriftEventKind, number>>;
  fallbackInWindow: number;
  fallbackAlertThreshold: number;
  fallbackWindowMs: number;
} {
  const countsByKind: Partial<Record<DriftEventKind, number>> = {};
  for (const e of driftRing) {
    countsByKind[e.kind] = (countsByKind[e.kind] || 0) + 1;
  }
  const now = Date.now();
  const inWindow = fallbackTimestamps.filter((t) => now - t < FALLBACK_WINDOW_MS).length;
  return {
    generatedAt: now,
    eventCountInRing: driftRing.length,
    countsByKind,
    fallbackInWindow: inWindow,
    fallbackAlertThreshold: FALLBACK_ALERT_THRESHOLD,
    fallbackWindowMs: FALLBACK_WINDOW_MS,
  };
}

/** Test / staging reset only — does not touch DB. */
export function clearDriftTelemetryForTests(): void {
  driftRing.length = 0;
  fallbackTimestamps = [];
  longCallRepeatCount.clear();
}

export function logReplyExceedsContract(
  callSid: string,
  textSample: string,
  sentenceCount: number,
  charCount: number,
  opts?: { sessionId?: number; clientId?: string }
): void {
  recordDriftEvent({
    kind: "reply_over_contract",
    callSid,
    sessionId: opts?.sessionId,
    clientId: opts?.clientId,
    detail: `sentences=${sentenceCount} chars=${charCount} sample=${textSample.slice(0, 120)}`,
  });
  log(
    `[DRIFT] reply_over_contract callSid=${callSid} sentences=${sentenceCount} chars=${charCount} sample=${JSON.stringify(textSample.slice(0, 120))}`,
    TAG
  );
  if (opts?.sessionId != null && opts.clientId) {
    void import("./transfer-controller").then(({ appendSupervisorAttentionReason }) =>
      appendSupervisorAttentionReason(opts.sessionId!, opts.clientId!, "reply_over_contract")
    );
  }
}

export function logRepeatedLongCall(
  callSid: string,
  durationSec: number,
  thresholdSec: number,
  opts?: { sessionId?: number; clientId?: string }
): void {
  if (durationSec < thresholdSec) return;
  const n = (longCallRepeatCount.get(callSid) || 0) + 1;
  longCallRepeatCount.set(callSid, n);
  recordDriftEvent({
    kind: "long_call",
    callSid,
    sessionId: opts?.sessionId,
    clientId: opts?.clientId,
    detail: `durationSec=${durationSec} threshold=${thresholdSec} repeatInProcess=${n}`,
  });
  log(
    `[DRIFT] long_call callSid=${callSid} durationSec=${durationSec} threshold=${thresholdSec} repeatInProcess=${n}`,
    TAG
  );
  if (opts?.sessionId != null && opts.clientId) {
    void import("./transfer-controller").then(({ appendSupervisorAttentionReason }) =>
      appendSupervisorAttentionReason(opts.sessionId!, opts.clientId!, "long_call_threshold_exceeded")
    );
  }
  if (n >= 2) {
    recordDriftEvent({
      kind: "repeated_long_call_pattern",
      callSid,
      sessionId: opts?.sessionId,
      clientId: opts?.clientId,
      detail: `count=${n}`,
    });
    log(`[DRIFT] repeated_long_call_pattern callSid=${callSid} count=${n}`, TAG);
  }
}

export function logTransferInitiatedWithoutAgreement(sessionId: number, clientId: string): void {
  recordDriftEvent({
    kind: "transfer_without_agreement",
    sessionId,
    clientId,
  });
  log(`[DRIFT] transfer_without_agreement sessionId=${sessionId} clientId=${clientId}`, TAG);
}

export function logMissingOtherNotes(sessionId: number): void {
  recordDriftEvent({ kind: "other_outcome_missing_notes", sessionId });
  log(`[DRIFT] other_outcome_missing_notes sessionId=${sessionId}`, TAG);
}

export function logMissingTransferTargetEnv(context: string): void {
  recordDriftEvent({ kind: "missing_transfer_target_env", detail: context });
  log(`[DRIFT] missing_transfer_target_env context=${context}`, TAG);
}

export function logManualCleanupRequiredTrue(sessionId: number, source: string): void {
  recordDriftEvent({
    kind: "manual_cleanup_required_true",
    sessionId,
    detail: source,
  });
  log(`[DRIFT] manual_cleanup_required_true sessionId=${sessionId} source=${source} — investigate`, TAG);
}

export function recordFallbackTriggered(kind: string): void {
  const now = Date.now();
  fallbackTimestamps = fallbackTimestamps.filter((t) => now - t < FALLBACK_WINDOW_MS);
  fallbackTimestamps.push(now);
  recordDriftEvent({ kind: "fallback_triggered", detail: kind });
  if (fallbackTimestamps.length >= FALLBACK_ALERT_THRESHOLD) {
    recordDriftEvent({
      kind: "fallback_high_rate",
      detail: `count=${fallbackTimestamps.length} windowMs=${FALLBACK_WINDOW_MS} lastKind=${kind}`,
    });
    log(
      `[DRIFT] fallback_high_rate count=${fallbackTimestamps.length} in_window_ms=${FALLBACK_WINDOW_MS} lastKind=${kind}`,
      TAG
    );
  }
}

export function countSentences(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
}

export function exceedsSentenceContract(text: string, maxSentences: number): boolean {
  return countSentences(text) > maxSentences;
}
