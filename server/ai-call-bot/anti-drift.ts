/**
 * Runtime anti-drift logging — no silent violations of AI Call Bot contract.
 */
import { log } from "../logger";

const TAG = "ai-call-bot-drift";
const FALLBACK_WINDOW_MS = 60 * 60 * 1000;
const FALLBACK_ALERT_THRESHOLD = 15;
let fallbackTimestamps: number[] = [];

/** In-process: same CallSid exceeding long-call threshold more than once in a process lifetime. */
const longCallRepeatCount = new Map<string, number>();

export function logReplyExceedsContract(callSid: string, textSample: string, sentenceCount: number, charCount: number): void {
  log(
    `[DRIFT] reply_over_contract callSid=${callSid} sentences=${sentenceCount} chars=${charCount} sample=${JSON.stringify(textSample.slice(0, 120))}`,
    TAG
  );
}

export function logRepeatedLongCall(callSid: string, durationSec: number, thresholdSec: number): void {
  if (durationSec < thresholdSec) return;
  const n = (longCallRepeatCount.get(callSid) || 0) + 1;
  longCallRepeatCount.set(callSid, n);
  log(
    `[DRIFT] long_call callSid=${callSid} durationSec=${durationSec} threshold=${thresholdSec} repeatInProcess=${n}`,
    TAG
  );
  if (n >= 2) {
    log(`[DRIFT] repeated_long_call_pattern callSid=${callSid} count=${n}`, TAG);
  }
}

export function logTransferInitiatedWithoutAgreement(sessionId: number, clientId: string): void {
  log(`[DRIFT] transfer_without_agreement sessionId=${sessionId} clientId=${clientId}`, TAG);
}

export function logMissingOtherNotes(sessionId: number): void {
  log(`[DRIFT] other_outcome_missing_notes sessionId=${sessionId}`, TAG);
}

export function logMissingTransferTargetEnv(context: string): void {
  log(`[DRIFT] missing_transfer_target_env context=${context}`, TAG);
}

export function logManualCleanupRequiredTrue(sessionId: number, source: string): void {
  log(`[DRIFT] manual_cleanup_required_true sessionId=${sessionId} source=${source} — investigate`, TAG);
}

export function recordFallbackTriggered(kind: string): void {
  const now = Date.now();
  fallbackTimestamps = fallbackTimestamps.filter((t) => now - t < FALLBACK_WINDOW_MS);
  fallbackTimestamps.push(now);
  if (fallbackTimestamps.length >= FALLBACK_ALERT_THRESHOLD) {
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
