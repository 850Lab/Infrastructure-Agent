/**
 * Hard rails for sandbox test dials — no production pipeline, no silent mixing.
 */
import { db } from "../db";
import { aiCallBotSandboxContacts } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { normalizePhone } from "../twilio-service";
import { SANDBOX_SCENARIO_TYPES, isSandboxScenarioType } from "./sandbox-types";

export type SandboxDialFailureReason =
  | "contact_not_found"
  | "inactive_or_archived"
  | "consent_required"
  | "invalid_phone"
  | "missing_company_context"
  | "missing_outreach_reason"
  | "sandbox_not_ready"
  | "supervised_mode_required"
  | "invalid_scenario_type";

export interface SandboxDialGuardResult {
  allowed: boolean;
  reason?: SandboxDialFailureReason;
  message?: string;
  contact?: typeof aiCallBotSandboxContacts.$inferSelect;
  normalizedPhone?: string;
}

export async function validateSandboxTestDial(params: {
  clientId: string;
  sandboxContactId: number;
}): Promise<SandboxDialGuardResult> {
  const [contact] = await db
    .select()
    .from(aiCallBotSandboxContacts)
    .where(
      and(
        eq(aiCallBotSandboxContacts.id, params.sandboxContactId),
        eq(aiCallBotSandboxContacts.clientId, params.clientId)
      )
    )
    .limit(1);

  if (!contact) {
    return { allowed: false, reason: "contact_not_found", message: "Sandbox contact not found." };
  }

  if (!contact.active || contact.archivedAt) {
    return { allowed: false, reason: "inactive_or_archived", message: "Contact is inactive or archived." };
  }

  if (!contact.consentConfirmed) {
    return {
      allowed: false,
      reason: "consent_required",
      message: "Sandbox dialing requires consent_confirmed=true (recorded opt-in).",
    };
  }

  if (!contact.supervisedModeRequired) {
    return {
      allowed: false,
      reason: "supervised_mode_required",
      message: "Sandbox currently allows only supervised_mode_required=true.",
    };
  }

  const normalized = normalizePhone(contact.phoneE164.trim());
  if (!normalized) {
    return { allowed: false, reason: "invalid_phone", message: "Valid E.164 phone required." };
  }

  const company = (contact.companyName || "").trim();
  if (company.length < 2) {
    return { allowed: false, reason: "missing_company_context", message: "company_name required (min 2 chars)." };
  }

  const reason = (contact.outreachReason || "").trim();
  if (reason.length < 3) {
    return { allowed: false, reason: "missing_outreach_reason", message: "outreach_reason required (min 3 chars)." };
  }

  if (!contact.sandboxReadyCall) {
    return {
      allowed: false,
      reason: "sandbox_not_ready",
      message: "sandbox_ready_call must be true to dial (ready_call-style gate for sandbox).",
    };
  }

  if (!isSandboxScenarioType(contact.testScenarioType)) {
    return {
      allowed: false,
      reason: "invalid_scenario_type",
      message: `test_scenario_type must be one of: ${SANDBOX_SCENARIO_TYPES.join(", ")}`,
    };
  }

  return { allowed: true, contact, normalizedPhone: normalized };
}
