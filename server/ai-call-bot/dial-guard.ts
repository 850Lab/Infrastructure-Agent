/**
 * Rails-first: only ready_call + valid phone + company context + outreach reason may dial.
 */
import { db } from "../db";
import { companyFlows, outreachPipeline } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { normalizePhone } from "../twilio-service";

export type DialGuardFailureReason =
  | "not_ready_call"
  | "invalid_phone"
  | "missing_company_context"
  | "missing_outreach_reason"
  | "flow_not_found";

export interface DialGuardResult {
  allowed: boolean;
  reason?: DialGuardFailureReason;
  message?: string;
  flowId?: number;
  companyId?: string;
  companyName?: string;
  normalizedPhone?: string;
}

export async function validateReadyCallDial(params: {
  clientId: string;
  flowId: number;
  outreachReason: string;
}): Promise<DialGuardResult> {
  const reason = (params.outreachReason || "").trim();
  if (reason.length < 3) {
    return { allowed: false, reason: "missing_outreach_reason", message: "Clear reason for outreach is required (min 3 chars)." };
  }

  const [flow] = await db
    .select({
      id: companyFlows.id,
      companyId: companyFlows.companyId,
      companyName: companyFlows.companyName,
      outreachReadiness: companyFlows.outreachReadiness,
    })
    .from(companyFlows)
    .where(and(eq(companyFlows.id, params.flowId), eq(companyFlows.clientId, params.clientId)))
    .limit(1);

  if (!flow) {
    return { allowed: false, reason: "flow_not_found", message: "Flow not found for client." };
  }

  if (flow.outreachReadiness !== "ready_call") {
    return {
      allowed: false,
      reason: "not_ready_call",
      message: "Only leads with outreach_readiness=ready_call may enter the dialer.",
    };
  }

  const [pipe] = await db
    .select({ phone: outreachPipeline.phone, companyName: outreachPipeline.companyName })
    .from(outreachPipeline)
    .where(and(eq(outreachPipeline.clientId, params.clientId), eq(outreachPipeline.companyId, flow.companyId)))
    .limit(1);

  const phone = pipe?.phone?.trim() || "";
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { allowed: false, reason: "invalid_phone", message: "Valid phone number required on pipeline record." };
  }

  const companyName = (flow.companyName || pipe?.companyName || "").trim();
  if (!companyName || companyName.length < 2) {
    return { allowed: false, reason: "missing_company_context", message: "Company name/context required." };
  }

  return {
    allowed: true,
    flowId: flow.id,
    companyId: flow.companyId,
    companyName,
    normalizedPhone: normalized,
  };
}
