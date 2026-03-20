import type { TransferMachineEvent } from "./transfer-state-machine";

export const TRANSFER_MACHINE_EVENTS: TransferMachineEvent[] = [
  "dial_started",
  "answered_human",
  "answered_voicemail",
  "no_answer_signal",
  "bad_number_signal",
  "callee_classified_gatekeeper",
  "callee_classified_dm",
  "callee_classified_influencer",
  "callee_classified_unknown",
  "rules_transfer_eligible",
  "rules_transfer_blocked",
  "offer_transfer",
  "agree_transfer",
  "initiate_transfer",
  "transfer_success",
  "agent_no_answer",
  "bridge_failed",
  "fallback_capture_started",
  "human_intercept",
  "terminal_reached",
];
