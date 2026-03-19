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
  phone?: string | null;
}): Promise<{ created: boolean; existing: boolean }> {
  const [existing] = await db
    .select({
      id: outreachPipeline.id,
      website: outreachPipeline.website,
      phone: outreachPipeline.phone,
      city: outreachPipeline.city,
      state: outreachPipeline.state,
    })
    .from(outreachPipeline)
    .where(
      and(
        eq(outreachPipeline.clientId, params.clientId),
        eq(outreachPipeline.companyId, params.companyId)
      )
    )
    .limit(1);

  if (existing) {
    const updates: Record<string, any> = {};
    if (!(existing.website?.trim()) && params.website?.trim()) updates.website = params.website.trim();
    if (!(existing.phone?.trim()) && params.phone?.trim()) updates.phone = params.phone.trim();
    if (!(existing.city?.trim()) && params.city?.trim()) updates.city = params.city.trim();
    if (!(existing.state?.trim()) && params.state?.trim()) updates.state = params.state.trim();
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db
        .update(outreachPipeline)
        .set(updates)
        .where(eq(outreachPipeline.id, existing.id));
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
        phone: params.phone ?? null,
        nextTouchDate: now,
        pipelineStatus: "ACTIVE",
      })
      .onConflictDoNothing({
        target: [outreachPipeline.clientId, outreachPipeline.companyId],
      })
      .returning({ id: outreachPipeline.id });
    const created = inserted.length > 0;
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
