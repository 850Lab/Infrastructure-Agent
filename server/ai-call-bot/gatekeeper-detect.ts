/**
 * Best-effort deterministic callee labeling from utterance text (stored label, not vague AI-only).
 */
import type { CalleeType } from "./types";

const GK_PHRASES = [
  "front desk",
  "reception",
  "operator",
  "main line",
  "how may i direct",
  "hold please",
  "transfer you",
  "i can take a message",
  "he's not in",
  "she's not in",
  "not available right now",
  "wrong department",
];

const DM_PHRASES = [
  "i'm the",
  "i am the",
  "i handle",
  "i make those",
  "i decide",
  "that's me",
  "i'm in charge",
  "operations manager",
  "plant manager",
  "safety manager",
  "project manager",
  "superintendent",
];

const INFLUENCER_PHRASES = [
  "i influence",
  "i recommend",
  "i advise",
  "my boss",
  "the owner",
  "have to run it by",
  "not the final say",
];

export function classifyCalleeFromUtterance(text: string): CalleeType {
  const lower = text.toLowerCase();
  if (!lower.trim()) return "unknown";

  for (const p of DM_PHRASES) {
    if (lower.includes(p)) return "decision_maker";
  }
  for (const p of INFLUENCER_PHRASES) {
    if (lower.includes(p)) return "strong_influencer";
  }
  for (const p of GK_PHRASES) {
    if (lower.includes(p)) return "gatekeeper";
  }

  return "unknown";
}
