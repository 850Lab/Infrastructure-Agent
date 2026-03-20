/** Shared thresholds for supervisor live view + escalation (explicit, env-overridable). */

export function getLongCallThresholdSec(): number {
  return Math.max(60, parseInt(process.env.AI_CALL_BOT_LONG_CALL_THRESHOLD_SEC || "120", 10) || 120);
}

export function getSupervisorFallbackFsmEscalationThreshold(): number {
  const v = parseInt(process.env.AI_CALL_BOT_SUPERVISOR_FALLBACK_COUNT_THRESHOLD || "2", 10);
  return Number.isFinite(v) && v >= 1 ? v : 2;
}
