/**
 * Twilio integration points: TwiML fragments for supervised transfer (no hardcoded numbers).
 * Caller must pass agent E.164 from env at runtime.
 *
 * Checklist: after agreement, bot says exactly "connecting you now", then immediate Dial — no dead air in Twilio layer
 * (use short Say or connect in same Response).
 */
import { getTransferPhraseSpoken } from "./transfer-constants";
import { logMissingTransferTargetEnv } from "./anti-drift";

export function getAgentNumberForTransfer(): string | null {
  const raw = process.env.AI_CALL_BOT_TRANSFER_TARGET_E164 || process.env.AGENT_PHONE || process.env.AI_CALL_BOT_AGENT_E164 || "";
  const trimmed = raw.trim();
  return trimmed.length >= 10 ? trimmed : null;
}

/**
 * TwiML: speak contract phrase then bridge to agent. Use after callee agrees to connect.
 * Returns null if agent number missing (fail closed — do not emit empty Dial).
 */
export function buildPostAgreementTransferTwiml(): string | null {
  const agent = getAgentNumberForTransfer();
  if (!agent) {
    logMissingTransferTargetEnv("buildPostAgreementTransferTwiml");
    return null;
  }
  const phrase = getTransferPhraseSpoken();
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(phrase)}</Say><Dial>${escapeXml(agent)}</Dial></Response>`;
}

/** Fallback when agent does not answer — short message, no silent failure */
export function buildAgentNoAnswerFallbackTwiml(): string {
  const msg =
    process.env.AI_CALL_BOT_AGENT_NO_ANSWER_MESSAGE ||
    "Sorry, we could not complete the connection. We will follow up shortly.";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(msg)}</Say></Response>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
