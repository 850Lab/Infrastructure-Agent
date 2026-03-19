import { db } from "./db";
import { companyFlows, outreachPipeline } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { log } from "./logger";

const TAG = "lead-triage";

export type WebsiteStatus = "has_website" | "no_website" | "website_candidate" | "website_blocked";
export type ContactStatus = "has_named_contact" | "has_generic_email" | "has_phone_only" | "no_contact_info";
export type OutreachReadiness =
  | "ready_email"
  | "ready_call"
  | "needs_website_lookup"
  | "needs_contact_enrichment"
  | "parked_low_value";

type FlowRow = {
  id: number;
  clientId: string;
  companyId: string;
  companyName: string;
  contactName: string | null;
  compositeScore: number | null;
};

type PipelineRow = {
  website: string | null;
  websiteLookupStatus: string | null;
  websiteCandidate: string | null;
  contactEmail: string | null;
  contactName: string | null;
  phone: string | null;
};

export function classifyWebsiteStatus(
  _flow: FlowRow,
  pipeline: PipelineRow | null
): WebsiteStatus {
  if (!pipeline) return "no_website";

  const website = pipeline.website?.trim();
  if (website) return "has_website";
  if (pipeline.websiteLookupStatus === "blocked_url") return "website_blocked";
  if (pipeline.websiteCandidate?.trim()) return "website_candidate";
  return "no_website";
}

export function classifyContactStatus(
  flow: FlowRow,
  pipeline: PipelineRow | null
): ContactStatus {
  const email = pipeline?.contactEmail?.trim();
  const phone = pipeline?.phone?.trim();
  const contactName = (flow.contactName || pipeline?.contactName || "").trim();

  if (email) {
    if (contactName) return "has_named_contact";
    return "has_generic_email";
  }
  if (phone) return "has_phone_only";
  return "no_contact_info";
}

const COMPOSITE_THRESHOLD = 40;

export function classifyOutreachReadiness(
  flow: FlowRow,
  pipeline: PipelineRow | null,
  websiteStatus: WebsiteStatus,
  contactStatus: ContactStatus
): OutreachReadiness {
  const composite = flow.compositeScore ?? 0;

  if (websiteStatus === "has_website") {
    if (
      (contactStatus === "has_named_contact" || contactStatus === "has_generic_email") &&
      composite >= COMPOSITE_THRESHOLD
    ) {
      return "ready_email";
    }
    if (contactStatus === "has_phone_only" && composite >= COMPOSITE_THRESHOLD) {
      return "ready_call";
    }
    if (contactStatus === "no_contact_info") {
      return "needs_contact_enrichment";
    }
  }

  if (websiteStatus === "website_blocked") return "parked_low_value";

  if (
    (websiteStatus === "no_website" || websiteStatus === "website_candidate") &&
    composite >= COMPOSITE_THRESHOLD
  ) {
    return "needs_website_lookup";
  }

  return "parked_low_value";
}

export async function runLeadTriageForFlow(clientId: string, flowId: number): Promise<{
  websiteStatus: WebsiteStatus;
  contactStatus: ContactStatus;
  outreachReadiness: OutreachReadiness;
} | null> {
  const [flow] = await db
    .select({
      id: companyFlows.id,
      clientId: companyFlows.clientId,
      companyId: companyFlows.companyId,
      companyName: companyFlows.companyName,
      contactName: companyFlows.contactName,
      compositeScore: companyFlows.compositeScore,
    })
    .from(companyFlows)
    .where(and(eq(companyFlows.id, flowId), eq(companyFlows.clientId, clientId)));

  if (!flow) return null;

  const [pipeline] = await db
    .select({
      website: outreachPipeline.website,
      websiteLookupStatus: outreachPipeline.websiteLookupStatus,
      websiteCandidate: outreachPipeline.websiteCandidate,
      contactEmail: outreachPipeline.contactEmail,
      contactName: outreachPipeline.contactName,
      phone: outreachPipeline.phone,
    })
    .from(outreachPipeline)
    .where(
      and(
        eq(outreachPipeline.clientId, flow.clientId),
        eq(outreachPipeline.companyId, flow.companyId)
      )
    );

  const websiteStatus = classifyWebsiteStatus(flow, pipeline ?? null);
  const contactStatus = classifyContactStatus(flow, pipeline ?? null);
  const outreachReadiness = classifyOutreachReadiness(
    flow,
    pipeline ?? null,
    websiteStatus,
    contactStatus
  );

  const now = new Date();
  await db
    .update(companyFlows)
    .set({
      websiteStatus,
      contactStatus,
      outreachReadiness,
      triageAt: now,
      updatedAt: now,
    })
    .where(eq(companyFlows.id, flowId));

  return { websiteStatus, contactStatus, outreachReadiness };
}

export async function runLeadTriage(clientId: string): Promise<{
  triaged: number;
  errors: number;
}> {
  const flows = await db
    .select({
      id: companyFlows.id,
      clientId: companyFlows.clientId,
      companyId: companyFlows.companyId,
      companyName: companyFlows.companyName,
      contactName: companyFlows.contactName,
      compositeScore: companyFlows.compositeScore,
    })
    .from(companyFlows)
    .where(
      and(
        eq(companyFlows.clientId, clientId),
        eq(companyFlows.status, "active")
      )
    );

  let triaged = 0;
  let errors = 0;

  for (const flow of flows) {
    try {
      await runLeadTriageForFlow(clientId, flow.id);
      triaged++;
    } catch (err: unknown) {
      log(`Triage error for flow #${flow.id} (${flow.companyName}): ${(err as Error).message}`, TAG);
      errors++;
    }
  }

  log(`Lead triage complete: ${triaged} triaged, ${errors} errors (client: ${clientId})`, TAG);
  return { triaged, errors };
}
