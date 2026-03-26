import { db } from "./db";
import { voiceSeats, callSessions } from "@shared/schema";
import { and, eq, sql, inArray, isNull, ne, not, or } from "drizzle-orm";

/**
 * Terminal browser call_session.status values — same set used when finalizing from Twilio status webhooks
 * (server/twilio-routes finalizeCallSessionFromTwilioStatus).
 */
export const TERMINAL_CALL_SESSION_STATUSES = new Set([
  "completed",
  "failed",
  "busy",
  "no-answer",
  "canceled",
  /** Operator/browser aborted before or without a normal Twilio terminal webhook. */
  "aborted",
]);

export function isCallSessionTerminalForSeatGuard(session: {
  status: string;
  endedAt: Date | null;
}): boolean {
  return TERMINAL_CALL_SESSION_STATUSES.has(session.status) || session.endedAt != null;
}

/** Twilio Client identity persisted on browser prepare-outbound (call_sessions.metadata.twilioIdentity). */
export function getTwilioIdentityFromCallSessionMetadata(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata) as Record<string, unknown>;
    const v = m.twilioIdentity;
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Promote browser call_sessions to in-progress when Twilio reports the **dialed child** leg answered
 * (mapped in-progress), not the browser/parent leg alone. Idempotent; never revives terminal sessions.
 */
export async function promoteBrowserCallSessionToInProgressFromTwilioLeg(
  sessionId: string,
  callSid: string,
  parentSid: string | null,
  mappedStatus: string,
): Promise<void> {
  if (mappedStatus !== "in-progress") return;

  const [sess] = await db.select().from(callSessions).where(eq(callSessions.id, sessionId)).limit(1);
  if (!sess || !getTwilioIdentityFromCallSessionMetadata(sess.metadata)) return;

  const incoming = String(callSid).trim();
  const storedChild = sess.childCallSid?.trim();
  if (storedChild && incoming === storedChild) {
    /* canonical PSTN leg */
  } else {
    const clientLeg = sess.parentCallSid?.trim();
    if (!clientLeg) return;
    const p = parentSid?.trim();
    if (!p || p !== clientLeg) return;
    if (incoming === clientLeg) return;
  }

  const terminalStatuses = Array.from(TERMINAL_CALL_SESSION_STATUSES) as string[];
  await db
    .update(callSessions)
    .set({
      status: "in-progress",
      updatedAt: new Date(),
      answeredAt: sql`COALESCE(call_sessions.answered_at, NOW())`,
    })
    .where(
      and(
        eq(callSessions.id, sessionId),
        isNull(callSessions.endedAt),
        not(inArray(callSessions.status, terminalStatuses)),
        or(ne(callSessions.status, "in-progress"), isNull(callSessions.answeredAt)),
      ),
    );
}

/** Clear the seat pointer when the session row is missing (orphaned active_call_session_id). */
export async function clearVoiceSeatActiveCallSessionPointer(seatId: string): Promise<void> {
  await db
    .update(voiceSeats)
    .set({ activeCallSessionId: null, updatedAt: new Date() })
    .where(eq(voiceSeats.id, seatId));
}

/** Bind the prepared/browser session to this seat (overwrites any previous pointer; new prepare-outbound is authoritative). */
export async function assignActiveCallSessionToSeat(seatId: string, callSessionId: string): Promise<void> {
  await db
    .update(voiceSeats)
    .set({ activeCallSessionId: callSessionId, updatedAt: new Date() })
    .where(eq(voiceSeats.id, seatId));
}

/**
 * Clear seat busy state when a call session ends. Idempotent; only rows pointing at this session are updated.
 */
export async function clearVoiceSeatActiveCallSessionForEndedSession(callSessionId: string): Promise<void> {
  await db
    .update(voiceSeats)
    .set({ activeCallSessionId: null, updatedAt: new Date() })
    .where(eq(voiceSeats.activeCallSessionId, callSessionId));
}

/** DB states that can be ended via browser abort (pre-live or not yet answered on the parent leg). */
export function isBrowserCallSessionAbortableDbStatus(status: string): boolean {
  return status === "prepared" || status === "dialing";
}

/** Mark session aborted and clear seat pointer for that session id only. */
export async function markBrowserCallSessionAbortedAndClearSeat(callSessionId: string): Promise<void> {
  await db
    .update(callSessions)
    .set({
      status: "aborted",
      updatedAt: new Date(),
      endedAt: sql`COALESCE(call_sessions.ended_at, NOW())`,
      endedReason: sql`COALESCE(call_sessions.ended_reason, 'aborted')`,
    })
    .where(eq(callSessions.id, callSessionId));
  await clearVoiceSeatActiveCallSessionForEndedSession(callSessionId);
}

/**
 * Stable Twilio Client identity per (client, user). Row is created on first token request.
 */
export async function ensureVoiceSeat(clientId: string, userId: string) {
  const twilioIdentity = `v1_${clientId}_${userId}`;
  await db
    .insert(voiceSeats)
    .values({
      clientId,
      userId,
      twilioIdentity,
      status: "active",
    })
    .onConflictDoNothing({ target: [voiceSeats.clientId, voiceSeats.userId] });

  const [row] = await db
    .select()
    .from(voiceSeats)
    .where(and(eq(voiceSeats.clientId, clientId), eq(voiceSeats.userId, userId)))
    .limit(1);

  if (!row) {
    throw new Error("voice_seat_missing_after_upsert");
  }
  return row;
}

/** JSON-safe payload for Focus Mode / browser voice recovery after refresh. */
export type BrowserCallRecoveryPayload = {
  seatId: string;
  activeCallSessionId: string | null;
  /** True when seat points at a non-terminal call_sessions row for this client. */
  isLive: boolean;
  session: {
    id: string;
    status: string;
    endedAt: string | null;
    parentCallSid: string | null;
  } | null;
};

async function refreshVoiceSeatRow(clientId: string, userId: string) {
  const [row] = await db
    .select()
    .from(voiceSeats)
    .where(and(eq(voiceSeats.clientId, clientId), eq(voiceSeats.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Heal stale seat pointers (missing / terminal session), then return recovery truth for the UI.
 * Scoped to the authenticated (clientId, userId) seat only.
 */
export async function getVoiceSeatBrowserCallRecovery(
  clientId: string,
  userId: string,
): Promise<{ recovery: BrowserCallRecoveryPayload; twilioIdentity: string }> {
  let seat = await ensureVoiceSeat(clientId, userId);

  const activeId =
    typeof seat.activeCallSessionId === "string" ? seat.activeCallSessionId.trim() : "";
  if (activeId) {
    const [linked] = await db
      .select()
      .from(callSessions)
      .where(and(eq(callSessions.id, activeId), eq(callSessions.clientId, clientId)))
      .limit(1);
    if (!linked) {
      await clearVoiceSeatActiveCallSessionPointer(seat.id);
      const refreshed = await refreshVoiceSeatRow(clientId, userId);
      if (refreshed) seat = refreshed;
    } else if (isCallSessionTerminalForSeatGuard(linked)) {
      await clearVoiceSeatActiveCallSessionForEndedSession(activeId);
      const refreshed = await refreshVoiceSeatRow(clientId, userId);
      if (refreshed) seat = refreshed;
    }
  }

  const activeAfter =
    typeof seat.activeCallSessionId === "string" ? seat.activeCallSessionId.trim() : "";
  if (!activeAfter) {
    return {
      twilioIdentity: seat.twilioIdentity,
      recovery: {
        seatId: seat.id,
        activeCallSessionId: null,
        isLive: false,
        session: null,
      },
    };
  }

  const [sess] = await db
    .select()
    .from(callSessions)
    .where(and(eq(callSessions.id, activeAfter), eq(callSessions.clientId, clientId)))
    .limit(1);

  if (!sess || isCallSessionTerminalForSeatGuard(sess)) {
    if (sess && isCallSessionTerminalForSeatGuard(sess)) {
      await clearVoiceSeatActiveCallSessionForEndedSession(activeAfter);
    } else {
      await clearVoiceSeatActiveCallSessionPointer(seat.id);
    }
    const refreshed = await refreshVoiceSeatRow(clientId, userId);
    const s = refreshed ?? seat;
    return {
      twilioIdentity: s.twilioIdentity,
      recovery: {
        seatId: s.id,
        activeCallSessionId: null,
        isLive: false,
        session: null,
      },
    };
  }

  const sessionIdentity = getTwilioIdentityFromCallSessionMetadata(sess.metadata);
  if (!sessionIdentity || sessionIdentity !== seat.twilioIdentity) {
    return {
      twilioIdentity: seat.twilioIdentity,
      recovery: {
        seatId: seat.id,
        activeCallSessionId: null,
        isLive: false,
        session: null,
      },
    };
  }

  return {
    twilioIdentity: seat.twilioIdentity,
    recovery: {
      seatId: seat.id,
      activeCallSessionId: sess.id,
      isLive: true,
      session: {
        id: sess.id,
        status: sess.status,
        endedAt: sess.endedAt ? sess.endedAt.toISOString() : null,
        parentCallSid: sess.parentCallSid,
      },
    },
  };
}
