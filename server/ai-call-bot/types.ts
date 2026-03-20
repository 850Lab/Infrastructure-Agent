/**
 * AI Call Bot — No Drift: enums and types for transfer flow (contract-aligned).
 * Store DB values as these string literals only.
 */

export const AI_CALL_BOT_TRANSFER_STATES = [
  "queued_ready_call",
  "dialing",
  "human_detected",
  "voicemail_detected",
  "no_answer",
  "bad_number",
  "gatekeeper_detected",
  "decision_maker_detected",
  "strong_influencer_detected",
  "unknown_callee",
  "transfer_eligible",
  "transfer_blocked",
  "transfer_offered",
  "transfer_agreed",
  "transfer_initiated",
  "transfer_completed",
  "transfer_no_agent_answer",
  "transfer_failed",
  "fallback_capture",
  "human_takeover_active",
  "terminal",
] as const;

export type AiCallBotTransferState = (typeof AI_CALL_BOT_TRANSFER_STATES)[number];

export const AI_CALL_TERMINAL_OUTCOMES = [
  "right_person_transfer",
  "right_person_callback",
  "wrong_person_with_referral",
  "wrong_person_no_referral",
  "not_interested",
  "voicemail",
  "no_answer",
  "bad_number",
  "other",
] as const;

export type AiCallTerminalOutcome = (typeof AI_CALL_TERMINAL_OUTCOMES)[number];

export const CALLEE_TYPES = ["gatekeeper", "decision_maker", "strong_influencer", "unknown"] as const;
export type CalleeType = (typeof CALLEE_TYPES)[number];

export const RELEVANCE_STATUSES = ["relevant", "not_relevant", "unknown"] as const;
export type RelevanceStatus = (typeof RELEVANCE_STATUSES)[number];

export const OPENNESS_STATUSES = ["negative", "neutral", "positive", "unknown"] as const;
export type OpennessStatus = (typeof OPENNESS_STATUSES)[number];

export const FALLBACK_CAPTURE_TYPES = [
  "callback_requested",
  "info_capture",
  "referral_only",
  "clean_exit",
  "unknown",
] as const;
export type FallbackCaptureType = (typeof FALLBACK_CAPTURE_TYPES)[number];

/** Contractual phrase — must match checklist exactly when spoken before bridge. */
export const CONTRACT_TRANSFER_PHRASE = "connecting you now";

export function isValidTerminalOutcome(v: string): v is AiCallTerminalOutcome {
  return (AI_CALL_TERMINAL_OUTCOMES as readonly string[]).includes(v);
}
