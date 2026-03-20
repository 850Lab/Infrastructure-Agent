/**
 * Explicit transfer state machine — valid transitions only.
 */
import type { AiCallBotTransferState } from "./types";

export type TransferMachineEvent =
  | "dial_started"
  | "answered_human"
  | "answered_voicemail"
  | "no_answer_signal"
  | "bad_number_signal"
  | "callee_classified_gatekeeper"
  | "callee_classified_dm"
  | "callee_classified_influencer"
  | "callee_classified_unknown"
  | "rules_transfer_eligible"
  | "rules_transfer_blocked"
  | "offer_transfer"
  | "agree_transfer"
  | "initiate_transfer"
  | "transfer_success"
  | "agent_no_answer"
  | "bridge_failed"
  | "fallback_capture_started"
  | "human_intercept"
  | "terminal_reached";

const TRANSITIONS: Record<AiCallBotTransferState, Partial<Record<TransferMachineEvent, AiCallBotTransferState>>> = {
  queued_ready_call: {
    dial_started: "dialing",
  },
  dialing: {
    answered_human: "human_detected",
    answered_voicemail: "voicemail_detected",
    no_answer_signal: "no_answer",
    bad_number_signal: "bad_number",
  },
  human_detected: {
    callee_classified_gatekeeper: "gatekeeper_detected",
    callee_classified_dm: "decision_maker_detected",
    callee_classified_influencer: "strong_influencer_detected",
    callee_classified_unknown: "unknown_callee",
  },
  voicemail_detected: {
    terminal_reached: "terminal",
  },
  no_answer: {
    terminal_reached: "terminal",
  },
  bad_number: {
    terminal_reached: "terminal",
  },
  gatekeeper_detected: {
    rules_transfer_eligible: "transfer_eligible",
    rules_transfer_blocked: "transfer_blocked",
    fallback_capture_started: "fallback_capture",
    human_intercept: "human_takeover_active",
  },
  decision_maker_detected: {
    rules_transfer_eligible: "transfer_eligible",
    rules_transfer_blocked: "transfer_blocked",
    fallback_capture_started: "fallback_capture",
    human_intercept: "human_takeover_active",
  },
  strong_influencer_detected: {
    rules_transfer_eligible: "transfer_eligible",
    rules_transfer_blocked: "transfer_blocked",
    fallback_capture_started: "fallback_capture",
    human_intercept: "human_takeover_active",
  },
  unknown_callee: {
    rules_transfer_eligible: "transfer_eligible",
    rules_transfer_blocked: "transfer_blocked",
    fallback_capture_started: "fallback_capture",
    human_intercept: "human_takeover_active",
  },
  transfer_eligible: {
    offer_transfer: "transfer_offered",
    rules_transfer_blocked: "transfer_blocked",
    fallback_capture_started: "fallback_capture",
    human_intercept: "human_takeover_active",
  },
  transfer_blocked: {
    fallback_capture_started: "fallback_capture",
    terminal_reached: "terminal",
    human_intercept: "human_takeover_active",
  },
  transfer_offered: {
    agree_transfer: "transfer_agreed",
    fallback_capture_started: "fallback_capture",
    rules_transfer_blocked: "transfer_blocked",
    human_intercept: "human_takeover_active",
  },
  transfer_agreed: {
    initiate_transfer: "transfer_initiated",
    bridge_failed: "transfer_failed",
    human_intercept: "human_takeover_active",
  },
  transfer_initiated: {
    transfer_success: "transfer_completed",
    agent_no_answer: "transfer_no_agent_answer",
    bridge_failed: "transfer_failed",
  },
  transfer_completed: {
    terminal_reached: "terminal",
  },
  transfer_no_agent_answer: {
    fallback_capture_started: "fallback_capture",
    terminal_reached: "terminal",
  },
  transfer_failed: {
    fallback_capture_started: "fallback_capture",
    terminal_reached: "terminal",
  },
  fallback_capture: {
    terminal_reached: "terminal",
    human_intercept: "human_takeover_active",
  },
  human_takeover_active: {
    terminal_reached: "terminal",
  },
  terminal: {},
};

export function applyTransition(
  current: AiCallBotTransferState,
  event: TransferMachineEvent
): { ok: true; next: AiCallBotTransferState } | { ok: false; reason: string } {
  const row = TRANSITIONS[current];
  const next = row?.[event];
  if (!next) {
    return { ok: false, reason: `Invalid transition: state=${current} event=${event}` };
  }
  return { ok: true, next };
}
