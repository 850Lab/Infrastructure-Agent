/**
 * One-off backfill: twilio_recordings.company_id, contact_id, flow_id
 * from call_sessions.metadata (browser Voice prepare-outbound shape).
 *
 * Safe / idempotent: only fills NULL columns; never overwrites.
 *
 * Usage:
 *   npx tsx scripts/backfill-twilio-recordings-from-call-sessions.ts              # dry-run
 *   npx tsx scripts/backfill-twilio-recordings-from-call-sessions.ts --execute   # apply
 *
 * Requires DATABASE_URL.
 */

import { sql, eq, and, or, isNull, isNotNull } from "drizzle-orm";
import { db, pool } from "../server/db";
import { twilioRecordings, callSessions } from "../shared/schema";

function normalizeVarcharId(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v.trim() : String(v).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "null" || lower === "undefined") return null;
  return s;
}

function normalizeFlowId(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i !== n) return null;
  const MAX = 2147483647;
  const MIN = -2147483648;
  if (i < MIN || i > MAX) return null;
  return i;
}

/** Matches JSON written in POST /api/twilio/voice/prepare-outbound (server/twilio-routes.ts). */
export function parseCallSessionMetadata(metadata: string | null): {
  companyId: string | null;
  contactId: string | null;
  flowId: number | null;
} {
  if (!metadata?.trim()) {
    return { companyId: null, contactId: null, flowId: null };
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return { companyId: null, contactId: null, flowId: null };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { companyId: null, contactId: null, flowId: null };
  }
  return {
    companyId: normalizeVarcharId(obj.companyId),
    contactId: normalizeVarcharId(obj.contactId),
    flowId: normalizeFlowId(obj.flowId),
  };
}

async function countRemainingNullsAmongSessionRows(): Promise<{
  withSession: number;
  companyNull: number;
  contactNull: number;
  flowNull: number;
}> {
  const base = isNotNull(twilioRecordings.callSessionId);

  const [withSession] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(twilioRecordings)
    .where(base);

  const [companyNull] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(twilioRecordings)
    .where(and(base, isNull(twilioRecordings.companyId)));

  const [contactNull] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(twilioRecordings)
    .where(and(base, isNull(twilioRecordings.contactId)));

  const [flowNull] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(twilioRecordings)
    .where(and(base, isNull(twilioRecordings.flowId)));

  return {
    withSession: Number(withSession?.c ?? 0),
    companyNull: Number(companyNull?.c ?? 0),
    contactNull: Number(contactNull?.c ?? 0),
    flowNull: Number(flowNull?.c ?? 0),
  };
}

async function countCandidateJoinRows(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(twilioRecordings)
    .innerJoin(callSessions, eq(twilioRecordings.callSessionId, callSessions.id))
    .where(
      and(
        isNotNull(twilioRecordings.callSessionId),
        or(
          isNull(twilioRecordings.companyId),
          isNull(twilioRecordings.contactId),
          isNull(twilioRecordings.flowId),
        ),
        isNotNull(callSessions.metadata),
        sql`btrim(${callSessions.metadata}) <> ''`,
      ),
    );
  return Number(row?.c ?? 0);
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage:
  npx tsx scripts/backfill-twilio-recordings-from-call-sessions.ts           # dry-run (no DB writes)
  npx tsx scripts/backfill-twilio-recordings-from-call-sessions.ts --execute  # apply updates

Requires DATABASE_URL.
`);
    process.exit(0);
  }

  console.log(execute ? "MODE: EXECUTE (writes enabled)" : "MODE: dry-run (no writes)");

  const beforeNulls = await countRemainingNullsAmongSessionRows();
  const joinCandidates = await countCandidateJoinRows();

  console.log("\n--- Verification: rows with call_session_id (before this run) ---");
  console.log(JSON.stringify(beforeNulls, null, 2));
  console.log(`\nCandidate join rows (session linked + nonempty metadata + any identity NULL): ${joinCandidates}`);

  const candidates = await db
    .select({
      id: twilioRecordings.id,
      companyId: twilioRecordings.companyId,
      contactId: twilioRecordings.contactId,
      flowId: twilioRecordings.flowId,
      metadata: callSessions.metadata,
    })
    .from(twilioRecordings)
    .innerJoin(callSessions, eq(twilioRecordings.callSessionId, callSessions.id))
    .where(
      and(
        isNotNull(twilioRecordings.callSessionId),
        or(
          isNull(twilioRecordings.companyId),
          isNull(twilioRecordings.contactId),
          isNull(twilioRecordings.flowId),
        ),
        isNotNull(callSessions.metadata),
        sql`btrim(${callSessions.metadata}) <> ''`,
      ),
    );

  let wouldApply = 0;
  let rowsUpdated = 0;
  const sample: { id: number; patch: Record<string, unknown> }[] = [];

  for (const row of candidates) {
    const parsed = parseCallSessionMetadata(row.metadata);
    const patch: { companyId?: string; contactId?: string; flowId?: number } = {};
    if (row.companyId == null && parsed.companyId != null) {
      patch.companyId = parsed.companyId;
    }
    if (row.contactId == null && parsed.contactId != null) {
      patch.contactId = parsed.contactId;
    }
    if (row.flowId == null && parsed.flowId != null) {
      patch.flowId = parsed.flowId;
    }

    if (Object.keys(patch).length === 0) {
      continue;
    }

    wouldApply += 1;
    if (sample.length < 15) {
      sample.push({ id: row.id, patch });
    }

    if (!execute) {
      continue;
    }

    const conditions = [eq(twilioRecordings.id, row.id)];
    if (patch.companyId !== undefined) {
      conditions.push(isNull(twilioRecordings.companyId));
    }
    if (patch.contactId !== undefined) {
      conditions.push(isNull(twilioRecordings.contactId));
    }
    if (patch.flowId !== undefined) {
      conditions.push(isNull(twilioRecordings.flowId));
    }

    const returned = await db
      .update(twilioRecordings)
      .set(patch)
      .where(and(...conditions))
      .returning({ id: twilioRecordings.id });

    if (returned.length > 0) {
      rowsUpdated += 1;
    }
  }

  console.log(`\nJoin rows scanned: ${candidates.length}`);
  console.log(`Rows with at least one applicable identity field from metadata: ${wouldApply}`);
  if (sample.length > 0) {
    console.log("\nSample patches (up to 15):");
    console.log(JSON.stringify(sample, null, 2));
  }

  if (execute) {
    console.log(`\nRows actually updated (RETURNING count): ${rowsUpdated}`);
    const afterNulls = await countRemainingNullsAmongSessionRows();
    console.log("\n--- Verification: rows with call_session_id (after this run) ---");
    console.log(JSON.stringify(afterNulls, null, 2));
  } else {
    console.log("\nDry-run complete. Re-run with --execute to apply.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
