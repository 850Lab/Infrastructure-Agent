/**
 * Environment-driven constants. No phone numbers or routing targets here.
 */
import { CONTRACT_TRANSFER_PHRASE } from "./types";

/** Target call length guidance for prompts (seconds). */
export function getTargetCallDurationSeconds(): { min: number; max: number } {
  const min = Math.max(15, Math.min(60, parseInt(process.env.AI_CALL_BOT_TARGET_DURATION_MIN_SEC || "30", 10) || 30));
  const max = Math.max(min, Math.min(120, parseInt(process.env.AI_CALL_BOT_TARGET_DURATION_MAX_SEC || "45", 10) || 45));
  return { min, max };
}

/** Supervised mode default when env unset (initial supervised rollout). */
export function defaultSupervisedMode(): boolean {
  const v = process.env.AI_CALL_BOT_SUPERVISED_DEFAULT;
  if (v === undefined || v === "") return true;
  return v === "1" || v.toLowerCase() === "true";
}

/**
 * Phrase spoken immediately before transfer bridge. Checklist: exact "connecting you now".
 * Env AI_CALL_BOT_TRANSFER_PHRASE must match contract or is ignored (fail closed to contract).
 */
export function getTransferPhraseSpoken(): string {
  const env = (process.env.AI_CALL_BOT_TRANSFER_PHRASE || "").trim().toLowerCase();
  if (!env) return CONTRACT_TRANSFER_PHRASE;
  if (env === CONTRACT_TRANSFER_PHRASE) return CONTRACT_TRANSFER_PHRASE;
  return CONTRACT_TRANSFER_PHRASE;
}
