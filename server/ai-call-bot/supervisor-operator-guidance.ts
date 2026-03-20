/**
 * Deterministic operator quick-reference (no AI, no new writes).
 * Input shape matches SupervisorLiveSessionView fields used for decisions; see runbook § API guidance mapping.
 */
export type OperatorGuidanceLevel =
  | "monitor_only"
  | "prepare_intercept"
  | "pause_auto_transfer_recommended"
  | "manual_follow_up_recommended"
  | "needs_supervisor_attention_now";

export interface OperatorGuidancePayload {
  level: OperatorGuidanceLevel;
  headline: string;
  detailLines: string[];
  /** Which inputs fired (auditable, stable strings). */
  matchedSignals: string[];
}

/** Subset of live view — structural match only, avoids circular imports. */
export interface OperatorGuidanceInput {
  currentFsmState: string;
  transferEligibility: "eligible" | "not_eligible" | "unknown";
  supervisorPauseAutoTransfer: boolean;
  rejectedTransitionCount: number;
  agentIntercepted: boolean;
  durationSecondsSoFar: number;
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
}

const TRANSFER_PATH_STATES = new Set([
  "transfer_eligible",
  "transfer_offered",
  "transfer_agreed",
  "transfer_initiated",
]);

function prepareInterceptMinSec(): number {
  const v = parseInt(process.env.AI_CALL_BOT_PREPARE_INTERCEPT_MIN_SEC || "45", 10);
  return Number.isFinite(v) && v >= 15 ? v : 45;
}

/**
 * Single pass: most severe matching tier wins. See docs/AI_CALL_BOT_SUPERVISOR_RUNBOOK.md.
 */
export function buildOperatorGuidanceFromLiveView(live: OperatorGuidanceInput): OperatorGuidancePayload {
  const d = live.driftFlags;
  const signals: string[] = [];

  if (d.persistentSupervisorAttentionRequired) {
    signals.push("persistent_supervisor_attention");
    if (d.persistentAttentionReasons.length) {
      signals.push(`attention_reasons:${d.persistentAttentionReasons.join(",")}`);
    }
  }
  if (d.terminalContractGaps) signals.push("terminal_contract_gaps");
  if (d.processWideFallbackHighRate) signals.push("process_wide_fallback_high_rate");
  if (d.repeatedFallbackInSession) signals.push("repeated_fallback_in_session");
  if (d.replyOverContract) signals.push("reply_over_contract");
  if (d.transferAttemptedWithoutAgreement) signals.push("transfer_attempted_without_agreement");

  if (
    d.persistentSupervisorAttentionRequired ||
    d.terminalContractGaps ||
    d.processWideFallbackHighRate ||
    d.repeatedFallbackInSession ||
    d.replyOverContract ||
    d.transferAttemptedWithoutAgreement
  ) {
    const lines: string[] = [
      "Review driftFlags and supervisor_attention_reasons on the session row.",
      "Use GET verify-report or supervised /live for full snapshot.",
    ];
    if (d.replyOverContract) lines.push("Assistant exceeded reply-length contract — confirm prompt / takeover if ongoing.");
    if (d.transferAttemptedWithoutAgreement) {
      lines.push("Transfer was blocked without agreement — do not bypass rails without explicit checklist exception.");
    }
    if (d.repeatedFallbackInSession) {
      lines.push("Multiple fallback FSM transitions on this session — review capture path and callee signals.");
    }
    if (d.processWideFallbackHighRate) {
      lines.push("Process-wide fallback rate is high — review cohort and dial/transfer config.");
    }
    return {
      level: "needs_supervisor_attention_now",
      headline: "Needs supervisor attention now",
      detailLines: lines,
      matchedSignals: [...signals],
    };
  }

  if (d.missingTransferTargetTransferEligible) signals.push("missing_transfer_target_transfer_eligible");
  if (d.longCallExceedsThreshold) signals.push("long_call_threshold");

  if (d.missingTransferTargetTransferEligible || d.longCallExceedsThreshold) {
    const lines: string[] = [];
    if (d.missingTransferTargetTransferEligible) {
      lines.push(
        "Transfer was rule-eligible but bridge target env is missing — fix AI_CALL_BOT_TRANSFER_TARGET_E164 / AGENT_PHONE before allowing transfer."
      );
    }
    if (d.longCallExceedsThreshold) {
      lines.push("Call duration exceeded long-call threshold — prefer callback / clean exit per checklist.");
    }
    lines.push("Log outcome in CRM / pipeline after the call; note env or duration issue in internal notes.");
    return {
      level: "manual_follow_up_recommended",
      headline: "Manual follow-up recommended",
      detailLines: lines,
      matchedSignals: [...signals],
    };
  }

  const pauseCandidate =
    !live.supervisorPauseAutoTransfer &&
    live.transferEligibility === "eligible" &&
    live.rejectedTransitionCount > 0 &&
    TRANSFER_PATH_STATES.has(live.currentFsmState);

  if (pauseCandidate) {
    signals.push("rejected_transition_on_transfer_path");
    return {
      level: "pause_auto_transfer_recommended",
      headline: "Pause auto-transfer recommended",
      detailLines: [
        "At least one FSM rejection occurred while session is on the transfer path.",
        "POST /api/ai-call-bot/supervised/sessions/:id/pause-auto-transfer until the situation is clear.",
        "Do not initiate_transfer until agreement and rails are explicitly satisfied.",
      ],
      matchedSignals: [...signals],
    };
  }

  const minSec = prepareInterceptMinSec();
  const prepare =
    !live.agentIntercepted &&
    live.currentFsmState !== "terminal" &&
    live.durationSecondsSoFar >= minSec;

  if (prepare) {
    signals.push(`duration_ge_${minSec}s`);
    signals.push("not_intercepted");
    return {
      level: "prepare_intercept",
      headline: "Prepare to intercept",
      detailLines: [
        `Call has been active ≥ ${minSec}s — stay ready to POST .../supervised/sessions/:id/intercept if the human must take over.`,
        "If callee shows confusion, gatekeeper risk, or checklist drift, intercept before transfer.",
      ],
      matchedSignals: [...signals],
    };
  }

  signals.push("default");
  const lines = ["No escalation tier matched — observe FSM, transfer eligibility, and driftFlags periodically."];
  if (live.agentIntercepted) {
    lines.unshift("Human intercept already active — support the live agent; AI audio is stopped for this call.");
    signals.push("agent_intercepted");
  }
  if (live.currentFsmState === "human_takeover_active") {
    lines.unshift("FSM in human_takeover_active — monitor only unless a new issue appears.");
    signals.push("fsm_human_takeover_active");
  }

  return {
    level: "monitor_only",
    headline: "Monitor only",
    detailLines: lines,
    matchedSignals: [...signals],
  };
}
