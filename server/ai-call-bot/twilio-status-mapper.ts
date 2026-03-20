/**
 * Single source: Twilio CallStatus (+ AnsweredBy, duration) → FSM events.
 * Applies updates only via transfer-controller.transitionSession — never silent DB writes.
 */
import type { AiCallBotTransferState } from "./types";
import type { TransferMachineEvent } from "./transfer-state-machine";
import { log } from "../logger";

const TAG = "ai-call-bot-twilio-map";

export interface TwilioStatusPayload {
  CallSid: string;
  CallStatus?: string;
  CallDuration?: string;
  AnsweredBy?: string;
  ParentCallSid?: string;
  Direction?: string;
}

/** Pick one FSM event per webhook (explicit, auditable). */
export function mapTwilioStatusToFsmEvent(
  currentState: AiCallBotTransferState,
  payload: TwilioStatusPayload
): TransferMachineEvent | null {
  const status = (payload.CallStatus || "").toLowerCase().trim();
  const answeredBy = (payload.AnsweredBy || "").toLowerCase().trim();
  const duration = parseInt(payload.CallDuration || "0", 10) || 0;

  const machineLike =
    answeredBy === "machine" ||
    answeredBy === "fax" ||
    (answeredBy === "unknown" && status === "completed" && duration < 3);

  if (currentState === "dialing") {
    if (machineLike && (status === "in-progress" || status === "completed")) {
      return "answered_voicemail";
    }
    if (status === "in-progress" || status === "answered") {
      if (!machineLike) return "answered_human";
    }
    if (status === "busy") return "no_answer_signal";
    if (status === "no-answer" || status === "no_answer") return "no_answer_signal";
    if (status === "failed") return "bad_number_signal";
    if (status === "canceled" || status === "cancelled") return "no_answer_signal";
    if (status === "completed" && duration === 0 && !answeredBy) return "no_answer_signal";
  }

  if (currentState === "transfer_initiated") {
    if (status === "completed") {
      if (duration > 0) return "transfer_success";
      return "agent_no_answer";
    }
    if (status === "busy" || status === "no-answer" || status === "no_answer" || status === "failed") {
      return "agent_no_answer";
    }
    if (status === "canceled" || status === "cancelled") {
      return "bridge_failed";
    }
  }

  const postConversationHangup: AiCallBotTransferState[] = [
    "human_detected",
    "gatekeeper_detected",
    "decision_maker_detected",
    "strong_influencer_detected",
    "unknown_callee",
    "transfer_eligible",
    "transfer_blocked",
    "transfer_offered",
    "transfer_agreed",
  ];
  if (status === "completed" && postConversationHangup.includes(currentState)) {
    return "terminal_reached";
  }

  if (currentState === "dialing" && status === "completed" && duration > 0 && !machineLike) {
    return "answered_human";
  }

  if (currentState === "voicemail_detected" && status === "completed") {
    return "terminal_reached";
  }

  if ((currentState === "no_answer" || currentState === "bad_number") && status === "completed") {
    return "terminal_reached";
  }

  if (currentState === "transfer_completed" && status === "completed") {
    return "terminal_reached";
  }

  if (
    (currentState === "transfer_failed" || currentState === "transfer_no_agent_answer") &&
    status === "completed"
  ) {
    return "terminal_reached";
  }

  return null;
}

export function logRejectedTransition(callSid: string, event: TransferMachineEvent, reason: string): void {
  log(`[ai-call-bot-fsm] rejected callSid=${callSid} event=${event} reason=${reason}`, TAG);
}
