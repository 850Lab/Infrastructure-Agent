import { db } from "./db";
import { outreachPipeline } from "@shared/schema";
import { eq, and } from "drizzle-orm";

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
    .select({ id: outreachPipeline.id })
    .from(outreachPipeline)
    .where(
      and(
        eq(outreachPipeline.clientId, params.clientId),
        eq(outreachPipeline.companyId, params.companyId)
      )
    )
    .limit(1);

  if (existing) {
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
    return { created: inserted.length > 0, existing: inserted.length === 0 };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "23505") {
      // Unique violation: race (constraint exists but onConflictDoNothing target mismatch or edge case)
      return { created: false, existing: true };
    }
    throw e;
  }
}
