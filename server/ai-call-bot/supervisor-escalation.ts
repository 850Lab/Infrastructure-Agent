/**
 * Explicit supervisor-attention reason codes (auditable, checklist-aligned).
 * DB stores `supervisor_attention_reasons` as JSON string[] of these literals.
 */
export const SUPERVISOR_ATTENTION_REASONS = [
  "repeated_fallback_in_session",
  "reply_over_contract",
  "transfer_attempted_without_agreement",
  "fsm_rejected_transition",
  "long_call_threshold_exceeded",
  "missing_transfer_target_transfer_eligible",
] as const;

export type SupervisorAttentionReasonCode = (typeof SUPERVISOR_ATTENTION_REASONS)[number];

export function isSupervisorAttentionReasonCode(s: string): s is SupervisorAttentionReasonCode {
  return (SUPERVISOR_ATTENTION_REASONS as readonly string[]).includes(s);
}

export function parseSupervisorAttentionReasonsJson(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const a = JSON.parse(raw) as unknown;
    if (!Array.isArray(a)) return [];
    return a.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

/**
 * Escalation rules (documentation + runtime checks for live view driftFlags).
 * Marking the session uses transfer-controller.appendSupervisorAttentionReason only.
 */
export const SUPERVISOR_ESCALATION_RULES = {
  repeated_fallback_in_session:
    "Append when session_fallback_fsm_count reaches AI_CALL_BOT_SUPERVISOR_FALLBACK_COUNT_THRESHOLD after a successful fallback_capture_started transition.",
  reply_over_contract:
    "Append when Realtime assistant output exceeds the 1–2 sentence contract for a linked ai_call_bot session.",
  transfer_attempted_without_agreement:
    "Append when initiate_transfer is blocked because transfer_agreed_at is missing (guardrail).",
  fsm_rejected_transition:
    "Append on every transfer-controller recordFsmRejection (invalid FSM edge, pause block, etc.).",
  long_call_threshold_exceeded:
    "Append when a linked coaching session ends and duration ≥ AI_CALL_BOT_LONG_CALL_THRESHOLD_SEC.",
  missing_transfer_target_transfer_eligible:
    "Append when evaluate-transfer rules allow transfer but TwiML cannot be built (missing env target) and supervisor pause is not active.",
} as const;
