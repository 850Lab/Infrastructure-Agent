import { db } from "./db";
import { outreachPipeline } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * Ensures an outreach_pipeline row exists for the given company.
 * Idempotent: does nothing if a row already exists (by clientId + companyId).
 * Never overwrites existing pipeline data.
 */
export async function ensureOutreachPipelineRow(params: {
  clientId: string;
  companyId: string;
  companyName: string;
  contactName?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
}): Promise<{ created: boolean; existing: boolean }> {
  const [existing] = await db
    .select({ id: outreachPipeline.id, website: outreachPipeline.website })
    .from(outreachPipeline)
    .where(
      and(
        eq(outreachPipeline.clientId, params.clientId),
        eq(outreachPipeline.companyId, params.companyId)
      )
    )
    .limit(1);

  if (existing) {
    // Update website only if missing and we have one from Airtable
    const existingWebsite = existing.website?.trim() || null;
    const newWebsite = params.website?.trim() || null;
    if (!existingWebsite && newWebsite) {
      await db
        .update(outreachPipeline)
        .set({ website: newWebsite, updatedAt: new Date() })
        .where(eq(outreachPipeline.id, existing.id));
      console.log(`[PIPELINE] Website mapped from Airtable: ${params.companyName} → ${newWebsite}`);
    }
    return { created: false, existing: true };
  }

  const now = new Date();
  try {
    const inserted = await db
      .insert(outreachPipeline)
      .values({
        clientId: params.clientId,
        companyId: params.companyId,
        companyName: params.companyName,
        contactName: params.contactName ?? null,
        city: params.city ?? null,
        state: params.state ?? null,
        website: params.website ?? null,
        nextTouchDate: now,
        pipelineStatus: "ACTIVE",
      })
      .onConflictDoNothing({
        target: [outreachPipeline.clientId, outreachPipeline.companyId],
      })
      .returning({ id: outreachPipeline.id });
    const created = inserted.length > 0;
    if (created && (params.website?.trim())) {
      console.log(`[PIPELINE] Website mapped from Airtable: ${params.companyName} → ${params.website?.trim()}`);
    }
    return { created, existing: !created };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "23505") {
      // Unique violation: race (constraint exists but onConflictDoNothing target mismatch or edge case)
      return { created: false, existing: true };
    }
    throw e;
  }
}

const PIPELINE_STATUS_UPPER: Record<string, string> = {
  active: "ACTIVE",
  completed: "COMPLETED",
  responded: "RESPONDED",
  "not_interested": "NOT_INTERESTED",
};

/**
 * Normalizes legacy lowercase pipelineStatus (e.g. "active") to uppercase "ACTIVE".
 * Call during transition to fix existing rows.
 */
export async function normalizePipelineStatusForClient(clientId: string): Promise<number> {
  let total = 0;
  for (const [lower, upper] of Object.entries(PIPELINE_STATUS_UPPER)) {
    const result = await db
      .update(outreachPipeline)
      .set({ pipelineStatus: upper, updatedAt: new Date() })
      .where(
        and(
          eq(outreachPipeline.clientId, clientId),
          sql`LOWER(${outreachPipeline.pipelineStatus}) = ${lower}`
        )
      )
      .returning({ id: outreachPipeline.id });
    total += result.length;
  }
  return total;
}
