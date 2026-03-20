/**
 * Sandbox scenario labels — planning / review only; do not force callee behavior.
 */
export const SANDBOX_SCENARIO_TYPES = [
  "decision_maker_transfer",
  "gatekeeper_referral",
  "wrong_person_no_referral",
  "hesitation_callback",
  "not_interested",
  "voicemail_expected",
  "other_edge_case",
] as const;

export type SandboxScenarioType = (typeof SANDBOX_SCENARIO_TYPES)[number];

export function isSandboxScenarioType(s: string): s is SandboxScenarioType {
  return (SANDBOX_SCENARIO_TYPES as readonly string[]).includes(s);
}

/** Stable company key for ai_call_bot_sessions.company_id (never a pipeline id). */
export function sandboxSessionCompanyId(clientId: string, sandboxContactId: number): string {
  return `sandbox:${clientId}:${sandboxContactId}`;
}

export function sandboxSessionContactKey(sandboxContactId: number): string {
  return `sandbox-contact:${sandboxContactId}`;
}
