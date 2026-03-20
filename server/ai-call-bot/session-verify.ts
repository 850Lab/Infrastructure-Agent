/**
 * Read-only staging verification for ai_call_bot_sessions (checklist-aligned).
 * Does not mutate state; drift events read from in-process buffer only.
 */
import type { AiCallBotSession } from "@shared/schema";
import type { AiCallBotTransferState, AiCallTerminalOutcome } from "./types";
import { isValidTerminalOutcome } from "./types";
import { getRecentDriftEvents, type DriftEventKind } from "./anti-drift";

export interface SessionVerifyReport {
  sessionId: number;
  clientId: string;
  callSid: string | null;
  currentState: AiCallBotTransferState;
  callOutcome: AiCallTerminalOutcome | null;
  fsmRejectedTransitionCount: number;
  lastFsmRejectedReason: string | null;
  terminalFieldGaps: string[];
  driftEventsForSession: {
    kinds: DriftEventKind[];
    count: number;
  };
  okForTerminalContract: boolean;
}

const TERMINAL: AiCallBotTransferState = "terminal";

export function verifyAiCallBotSessionRow(row: AiCallBotSession): SessionVerifyReport {
  const currentState = row.currentState as AiCallBotTransferState;
  const callOutcome = row.callOutcome && isValidTerminalOutcome(row.callOutcome) ? (row.callOutcome as AiCallTerminalOutcome) : null;

  const terminalFieldGaps: string[] = [];
  if (currentState === TERMINAL) {
    if (!row.callOutcome || !isValidTerminalOutcome(row.callOutcome)) {
      terminalFieldGaps.push("terminal state requires valid call_outcome");
    }
    if (row.callOutcome === "other" && !(row.otherNotes || "").trim()) {
      terminalFieldGaps.push("outcome 'other' requires non-empty other_notes");
    }
  }

  const driftForSession = getRecentDriftEvents({
    sessionId: row.id,
    callSid: row.callSid ?? undefined,
  });
  const kinds = driftForSession.map((e) => e.kind);

  const okForTerminalContract = terminalFieldGaps.length === 0;

  return {
    sessionId: row.id,
    clientId: row.clientId,
    callSid: row.callSid,
    currentState,
    callOutcome,
    fsmRejectedTransitionCount: row.fsmRejectedTransitionCount ?? 0,
    lastFsmRejectedReason: row.lastFsmRejectedReason ?? null,
    terminalFieldGaps,
    driftEventsForSession: {
      kinds,
      count: driftForSession.length,
    },
    okForTerminalContract,
  };
}
