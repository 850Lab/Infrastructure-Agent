/**
 * Pure boolean transfer decision rules — no side effects, no I/O.
 * Checklist: transfer allowed only when relevance + openness + agreement;
 * blocked on wrong person w/o direction, disinterest, confusion, voicemail.
 */
import type { CalleeType, OpennessStatus, RelevanceStatus } from "./types";

export interface TransferSignalSnapshot {
  calleeType: CalleeType;
  relevanceStatus: RelevanceStatus;
  opennessStatus: OpennessStatus;
  /** Responsibility for topic confirmed OR strong influencer path */
  relevanceConfirmedOrStrongInfluence: boolean;
  /** Explicit yes to connect / transfer */
  agreementToConnect: boolean;
  wrongPersonNoDirection: boolean;
  disinterest: boolean;
  confusionOrFriction: boolean;
  voicemail: boolean;
  noAnswer: boolean;
  badNumber: boolean;
  hesitation: boolean;
  callbackRequested: boolean;
  referralWithoutImmediateHandoff: boolean;
}

export function transferBlocked(s: TransferSignalSnapshot): boolean {
  if (s.voicemail || s.noAnswer || s.badNumber) return true;
  if (s.disinterest) return true;
  if (s.confusionOrFriction) return true;
  if (s.wrongPersonNoDirection) return true;
  if (s.referralWithoutImmediateHandoff && !s.agreementToConnect) return true;
  if (s.opennessStatus === "negative") return true;
  return false;
}

export function transferAllowed(s: TransferSignalSnapshot): boolean {
  if (transferBlocked(s)) return false;
  if (!s.relevanceConfirmedOrStrongInfluence) return false;
  if (s.opennessStatus !== "neutral" && s.opennessStatus !== "positive" && s.opennessStatus !== "unknown") return false;
  if (s.opennessStatus === "unknown" && !s.agreementToConnect) return false;
  if (!s.agreementToConnect) return false;
  return true;
}

/** Switch to information / callback capture instead of transfer */
export function shouldSwitchToInformationCapture(s: TransferSignalSnapshot): boolean {
  if (transferAllowed(s)) return false;
  if (s.callbackRequested) return true;
  if (s.hesitation) return true;
  if (s.opennessStatus === "neutral" && !s.agreementToConnect && !s.disinterest) return true;
  if (s.referralWithoutImmediateHandoff) return true;
  if (s.calleeType === "gatekeeper" && !s.agreementToConnect) return true;
  return false;
}

/** End call without corrupting state — no transfer, minimal capture */
export function shouldExitCleanly(s: TransferSignalSnapshot): boolean {
  if (s.voicemail || s.noAnswer || s.badNumber) return true;
  if (s.disinterest) return true;
  if (s.wrongPersonNoDirection && !s.callbackRequested) return true;
  return false;
}
