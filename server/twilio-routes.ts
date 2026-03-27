import type { Express, Request, Response } from "express";
import {
  sendSms,
  initiateCall,
  getCallStatus,
  isTwilioConnected,
  listRecentCalls,
  listRecentMessages,
  downloadRecording,
  getRecordingsForCall,
  listAllRecordings,
  getCallDetails,
  mintVoiceAccessToken,
  normalizePhone,
  getTwilioFromNumber,
} from "./twilio-service";
import { transcribeAudio, analyzeContainmentDeterministic, analyzeContainment, extractFollowupDate, analyzeLeadQuality, analyzeCallIntelligence } from "./openai";
import { detectNoAuthority, detectNoAuthorityFromAnalysis } from "./authority-detection";
import { eventBus } from "./events";
import { db } from "./db";
import {
  twilioRecordings,
  clients,
  companyFlows,
  actionQueue,
  inboundMessages,
  outreachPipeline,
  users,
  callSessions,
} from "@shared/schema";
import { eq, and, or, desc, sql, isNull, isNotNull, type SQL } from "drizzle-orm";
import { registerCoachingSession, subscribeToCoaching, getActiveSessions } from "./realtime-coaching";
import { validateToken, getTokenEntry } from "./auth";
import {
  activeCallMeta,
  broadcastCallStatus,
  callStatusSSEClients,
  callStatusSSEClientsByCallSessionId,
} from "./twilio-call-state";
import {
  assignActiveCallSessionToSeat,
  clearVoiceSeatActiveCallSessionForEndedSession,
  clearVoiceSeatActiveCallSessionPointer,
  ensureVoiceSeat,
  getVoiceSeatBrowserCallRecovery,
  promoteBrowserCallSessionToInProgressFromTwilioLeg,
  getTwilioIdentityFromCallSessionMetadata,
  isCallSessionTerminalForSeatGuard,
  isBrowserCallSessionAbortableDbStatus,
  markBrowserCallSessionAbortedAndClearSeat,
  TERMINAL_CALL_SESSION_STATUSES,
} from "./voice-seat";

const log = (msg: string) => {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [twilio-routes] ${msg}`);
};

function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}`;
}

/**
 * Store PSTN child CallSid on the browser session row (first eligible child-leg status webhook).
 * Does not overwrite a different child; idempotent for the same sid.
 */
async function persistOutboundChildCallSidFromStatusIfEligible(params: {
  callSid: string;
  parentSid: string | null;
}): Promise<void> {
  const parentFromBody = params.parentSid?.trim();
  const callSid = String(params.callSid || "").trim();
  if (!parentFromBody || !callSid.startsWith("CA")) return;
  if (callSid === parentFromBody) return;

  const [cand] = await db
    .select()
    .from(callSessions)
    .where(and(eq(callSessions.parentCallSid, parentFromBody), isNull(callSessions.childCallSid)))
    .limit(1);

  if (!cand || !getTwilioIdentityFromCallSessionMetadata(cand.metadata)) return;
  if (isCallSessionTerminalForSeatGuard(cand)) return;

  await db
    .update(callSessions)
    .set({ childCallSid: callSid, updatedAt: new Date() })
    .where(
      and(
        eq(callSessions.id, cand.id),
        or(isNull(callSessions.childCallSid), eq(callSessions.childCallSid, callSid)),
      ),
    );
}

/** Resolve call_sessions.id for browser Voice Dial status callbacks (client or child leg). */
async function resolveBrowserCallSessionIdForTwilioWebhook(params: {
  callSid: string;
  parentSid: string | null;
}): Promise<string | null> {
  const sid = String(params.callSid || "").trim();

  const [byChild] = await db
    .select({ id: callSessions.id })
    .from(callSessions)
    .where(eq(callSessions.childCallSid, sid))
    .limit(1);
  if (byChild?.id) return byChild.id;

  const meta =
    activeCallMeta.get(sid) ||
    (params.parentSid ? activeCallMeta.get(String(params.parentSid).trim()) : undefined);
  if (meta?.voiceBrowser && meta.callSessionId) {
    return meta.callSessionId;
  }
  const parentConds = [eq(callSessions.parentCallSid, sid)];
  if (params.parentSid) {
    parentConds.push(eq(callSessions.parentCallSid, String(params.parentSid).trim()));
  }
  const [row] = await db
    .select({ id: callSessions.id })
    .from(callSessions)
    .where(or(...parentConds))
    .limit(1);
  return row?.id ?? null;
}

/** Seconds since answered_at for UI (Twilio-style string); null if no anchor. */
function browserSessionDurationFromAnswered(
  answeredAt: Date | null,
  endMs: number | null,
): string | null {
  if (!answeredAt) return null;
  const start = answeredAt.getTime();
  const end = endMs ?? Date.now();
  const sec = Math.floor((end - start) / 1000);
  return String(Math.max(0, sec));
}

/** ISO timeline fields for browser session status + session-keyed SSE (null-safe for older rows). */
function browserSessionTimelineFromRow(sess: typeof callSessions.$inferSelect): {
  connectedAt: string | null;
  answeredAt: string | null;
  disconnectedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
} {
  return {
    connectedAt: sess.connectedAt ? sess.connectedAt.toISOString() : null,
    answeredAt: sess.answeredAt ? sess.answeredAt.toISOString() : null,
    disconnectedAt: sess.disconnectedAt ? sess.disconnectedAt.toISOString() : null,
    endedAt: sess.endedAt ? sess.endedAt.toISOString() : null,
    endedReason: sess.endedReason?.trim() || null,
  };
}

/** Map call_sessions row to UI live status (Focus Mode / session poll). */
function mapCallSessionRowToBrowserLiveStatus(sess: typeof callSessions.$inferSelect): {
  status: string;
  duration: string | null;
  connectedAt: string | null;
  answeredAt: string | null;
  disconnectedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
} {
  const timeline = browserSessionTimelineFromRow(sess);
  const st = sess.status;
  if (st === "aborted") return { status: "canceled", duration: null, ...timeline };
  if (st === "prepared") return { status: "dialing", duration: null, ...timeline };
  if (st === "dialing") return { status: "dialing", duration: null, ...timeline };
  if (st === "in-progress") {
    return {
      status: "in-progress",
      duration: browserSessionDurationFromAnswered(sess.answeredAt, null),
      ...timeline,
    };
  }
  if (TERMINAL_CALL_SESSION_STATUSES.has(st) || sess.endedAt) {
    const duration =
      sess.answeredAt && sess.endedAt
        ? browserSessionDurationFromAnswered(sess.answeredAt, sess.endedAt.getTime())
        : null;
    return { status: st, duration, ...timeline };
  }
  return { status: st, duration: null, ...timeline };
}

/**
 * Same meanings as session-keyed call_status SSE artifact fields.
 * Uses the latest twilio_recordings row for this session (by createdAt desc), matching recording-by-call-session.
 */
function browserSessionArtifactFlagsFromRecording(
  rec: typeof twilioRecordings.$inferSelect | null | undefined,
): {
  recordingArtifactsReady: boolean;
  hasRecording: boolean;
  hasTranscript: boolean;
  hasAnalysis: boolean;
} {
  if (!rec) {
    return {
      recordingArtifactsReady: false,
      hasRecording: false,
      hasTranscript: false,
      hasAnalysis: false,
    };
  }
  const tx = rec.transcription?.trim() ?? "";
  const ax = rec.analysis?.trim() ?? "";
  const analyzed = rec.status === "analyzed" && rec.processedAt != null;
  return {
    recordingArtifactsReady: analyzed,
    hasRecording: true,
    hasTranscript: tx.length > 0,
    hasAnalysis: ax.length > 0,
  };
}

/** Lightweight latest-recording snapshot for session status (no transcript/analysis bodies). */
function browserSessionLatestRecordingSummarySnapshot(
  rec: typeof twilioRecordings.$inferSelect | null | undefined,
): {
  latestRecordingSid: string | null;
  latestRecordingStatus: string | null;
  processedAt: string | null;
  summaryAvailable: boolean;
} {
  if (!rec) {
    return {
      latestRecordingSid: null,
      latestRecordingStatus: null,
      processedAt: null,
      summaryAvailable: false,
    };
  }
  let summaryAvailable = false;
  if (rec.status === "analyzed" && rec.processedAt != null && rec.callIntelligenceJson?.trim()) {
    try {
      const ci = JSON.parse(rec.callIntelligenceJson) as { summary?: unknown };
      if (typeof ci.summary === "string" && ci.summary.trim().length > 0) {
        summaryAvailable = true;
      }
    } catch {
      /* ignore */
    }
  }
  return {
    latestRecordingSid: rec.recordingSid,
    latestRecordingStatus: rec.status,
    processedAt: rec.processedAt ? rec.processedAt.toISOString() : null,
    summaryAvailable,
  };
}

/**
 * Derived: session is terminal (Twilio-style), not operator-aborted, and latest linked recording has
 * analyzed artifacts plus a non-empty call-intelligence summary (same gates as recordingArtifactsReady + summaryAvailable).
 * Aborted sessions are never post-call ready.
 */
function browserSessionPostCallReady(params: {
  session: typeof callSessions.$inferSelect;
  latestRec: typeof twilioRecordings.$inferSelect | null | undefined;
}): boolean {
  if (params.session.status === "aborted") return false;
  const terminal =
    TERMINAL_CALL_SESSION_STATUSES.has(params.session.status) || params.session.endedAt != null;
  if (!terminal) return false;
  const artifacts = browserSessionArtifactFlagsFromRecording(params.latestRec ?? null);
  const snap = browserSessionLatestRecordingSummarySnapshot(params.latestRec ?? null);
  return artifacts.recordingArtifactsReady && snap.summaryAvailable;
}

/** Same call_status payload as the Twilio webhook path; drives session-keyed + parent CallSid SSE maps. */
async function broadcastCallStatusFromCallSessionRow(
  session: typeof callSessions.$inferSelect,
  artifactOpts?: {
    recordingArtifactsReady?: boolean;
    hasRecording?: boolean;
    hasTranscript?: boolean;
    hasAnalysis?: boolean;
    /** When set, avoids extra DB read (e.g. processRecording already loaded this row). */
    latestRecordingRow?: typeof twilioRecordings.$inferSelect | null;
  },
) {
  const live = mapCallSessionRowToBrowserLiveStatus(session);
  const sseCallSid = session.parentCallSid?.trim() || "";
  let latestRec: typeof twilioRecordings.$inferSelect | null | undefined = artifactOpts?.latestRecordingRow;
  if (latestRec === undefined) {
    const [r] = await db
      .select()
      .from(twilioRecordings)
      .where(eq(twilioRecordings.callSessionId, session.id))
      .orderBy(desc(twilioRecordings.createdAt))
      .limit(1);
    latestRec = r ?? null;
  }
  const recordingSummarySnapshot = browserSessionLatestRecordingSummarySnapshot(latestRec ?? null);
  const postCallReady = browserSessionPostCallReady({ session, latestRec });
  broadcastCallStatus(sseCallSid, live.status, live.duration ?? undefined, {
    callSessionId: session.id,
    sessionTimeline: browserSessionTimelineFromRow(session),
    recordingArtifactsReady: artifactOpts?.recordingArtifactsReady,
    hasRecording: artifactOpts?.hasRecording,
    hasTranscript: artifactOpts?.hasTranscript,
    hasAnalysis: artifactOpts?.hasAnalysis,
    recordingSummarySnapshot,
    postCallReady,
  });
}

/** Resolve session then promote to in-progress when the dialed leg is live (see voice-seat helper). */
async function promoteBrowserCallSessionToInProgressFromTwilioStatus(params: {
  callSid: string;
  parentSid: string | null;
  mappedStatus: string;
}): Promise<void> {
  const sessionId = await resolveBrowserCallSessionIdForTwilioWebhook({
    callSid: params.callSid,
    parentSid: params.parentSid,
  });
  if (!sessionId) return;
  await promoteBrowserCallSessionToInProgressFromTwilioLeg(
    sessionId,
    params.callSid,
    params.parentSid,
    params.mappedStatus,
  );
}

/**
 * Mark browser call_sessions terminal (idempotent ended_at). Runs before activeCallMeta delete.
 * Resolves session via voiceBrowser meta or parent_call_sid matching Twilio CallSid / ParentCallSid.
 */
async function finalizeCallSessionFromTwilioStatus(params: {
  callSid: string;
  parentSid: string | null;
  mappedStatus: string;
}): Promise<void> {
  if (!TERMINAL_CALL_SESSION_STATUSES.has(params.mappedStatus)) return;

  const sessionId = await resolveBrowserCallSessionIdForTwilioWebhook({
    callSid: params.callSid,
    parentSid: params.parentSid,
  });
  if (!sessionId) return;

  await db
    .update(callSessions)
    .set({
      status: params.mappedStatus,
      updatedAt: new Date(),
      endedAt: sql`COALESCE(call_sessions.ended_at, NOW())`,
      endedReason: sql`COALESCE(call_sessions.ended_reason, ${params.mappedStatus})`,
    })
    .where(eq(callSessions.id, sessionId));

  await clearVoiceSeatActiveCallSessionForEndedSession(sessionId);
}

/** Resolve company/client for pipeline when twilio_recordings.call_session_id is set (browser path). */
async function enrichContextFromCallSession(
  rec: typeof twilioRecordings.$inferSelect | undefined | null
): Promise<{ companyName: string | null; clientId: string | null }> {
  let companyName = rec?.companyName ?? null;
  let cid = rec?.clientId ?? null;
  if (!rec?.callSessionId) return { companyName, clientId: cid };
  const [s] = await db.select().from(callSessions).where(eq(callSessions.id, rec.callSessionId)).limit(1);
  if (!s) return { companyName, clientId: cid };
  if (!cid) cid = s.clientId;
  if (!companyName && s.metadata) {
    try {
      const m = JSON.parse(s.metadata) as Record<string, unknown>;
      if (typeof m.companyName === "string") companyName = m.companyName;
    } catch {
      /* ignore */
    }
  }
  return { companyName, clientId: cid };
}

/** Browser session id when recording webhook CallSid is the persisted PSTN child leg. */
async function resolveBrowserCallSessionIdFromRecordingCallSid(callSid: string): Promise<string | null> {
  const sid = String(callSid || "").trim();
  if (!sid.startsWith("CA")) return null;
  const [session] = await db
    .select()
    .from(callSessions)
    .where(eq(callSessions.childCallSid, sid))
    .limit(1);
  if (!session?.id || !getTwilioIdentityFromCallSessionMetadata(session.metadata)) return null;
  return session.id;
}

type RecordingWebhookLookup = {
  row: typeof twilioRecordings.$inferSelect | null;
  /** Set call_session_id on this row when found via parent-leg pending row (idempotent). */
  browserCallSessionIdToLink: string | null;
};

/**
 * Find twilio_recordings row for recording webhook.
 * Order: child_call_sid session → row by call_session_id → row by parent call_sid; then CallSid/parent/REST fallbacks.
 */
async function findRecordingRowForWebhook(
  CallSid: string,
  bodyParentCallSid?: string | null,
): Promise<RecordingWebhookLookup> {
  const browserSessionId = await resolveBrowserCallSessionIdFromRecordingCallSid(CallSid);
  if (browserSessionId) {
    const [bySessionId] = await db
      .select()
      .from(twilioRecordings)
      .where(eq(twilioRecordings.callSessionId, browserSessionId))
      .limit(1);
    if (bySessionId) {
      return { row: bySessionId, browserCallSessionIdToLink: null };
    }
    const [sess] = await db
      .select({ parentCallSid: callSessions.parentCallSid })
      .from(callSessions)
      .where(eq(callSessions.id, browserSessionId))
      .limit(1);
    const parentLeg = sess?.parentCallSid?.trim();
    if (parentLeg) {
      const [byParent] = await db
        .select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.callSid, parentLeg))
        .limit(1);
      if (byParent) {
        const existing = byParent.callSessionId?.trim();
        if (existing && existing !== browserSessionId) {
          return { row: byParent, browserCallSessionIdToLink: null };
        }
        return {
          row: byParent,
          browserCallSessionIdToLink: existing ? null : browserSessionId,
        };
      }
    }
  }

  const [direct] = await db.select().from(twilioRecordings).where(eq(twilioRecordings.callSid, CallSid)).limit(1);
  if (direct) return { row: direct, browserCallSessionIdToLink: null };

  const parentFromBody =
    bodyParentCallSid && String(bodyParentCallSid).startsWith("CA") ? String(bodyParentCallSid) : null;
  if (parentFromBody) {
    const [byParent] = await db
      .select()
      .from(twilioRecordings)
      .where(eq(twilioRecordings.callSid, parentFromBody))
      .limit(1);
    if (byParent) return { row: byParent, browserCallSessionIdToLink: null };
  }

  const details = await getCallDetails(CallSid);
  const p = details?.parentCallSid && String(details.parentCallSid).startsWith("CA") ? String(details.parentCallSid) : null;
  if (p && p !== CallSid) {
    const [byFetchedParent] = await db
      .select()
      .from(twilioRecordings)
      .where(eq(twilioRecordings.callSid, p))
      .limit(1);
    if (byFetchedParent) return { row: byFetchedParent, browserCallSessionIdToLink: null };
  }

  return { row: null, browserCallSessionIdToLink: null };
}

async function buildRecordingReadPayload(
  recording: typeof twilioRecordings.$inferSelect,
  clientId: string | null | undefined
) {
  if (clientId && recording.clientId && recording.clientId !== clientId) {
    return { error: "forbidden" as const };
  }

  let updatedFlowAction: string | null = null;
  let updatedFlowNotes: string | null = null;
  let updatedFlowDueAt: string | null = null;

  const ctx = await enrichContextFromCallSession(recording);
  const effCompany = recording.companyName || ctx.companyName;
  const effClientId = recording.clientId || ctx.clientId;

  if (recording.processedAt && effCompany && effClientId) {
    const [flow] = await db
      .select()
      .from(companyFlows)
      .where(
        and(eq(companyFlows.clientId, effClientId), eq(companyFlows.companyName, effCompany)),
      )
      .orderBy(desc(companyFlows.updatedAt))
      .limit(1);
    if (flow) {
      updatedFlowAction = flow.nextAction;
      updatedFlowNotes = flow.notes;
      updatedFlowDueAt = flow.nextDueAt ? flow.nextDueAt.toISOString() : null;
    }
  }

  return {
    payload: {
      id: recording.id,
      callSid: recording.callSid,
      callSessionId: recording.callSessionId,
      recordingSid: recording.recordingSid,
      duration: recording.duration,
      transcription: recording.transcription,
      analysis: recording.analysis,
      problemDetected: recording.problemDetected,
      noAuthority: recording.noAuthority,
      authorityReason: recording.authorityReason,
      suggestedRole: recording.suggestedRole,
      followupDate: recording.followupDate,
      companyName: recording.companyName,
      contactName: recording.contactName,
      status: recording.status,
      createdAt: recording.createdAt,
      processedAt: recording.processedAt,
      leadQualityScore: recording.leadQualityScore,
      leadQualityLabel: recording.leadQualityLabel,
      leadQualitySignals: recording.leadQualitySignals ? JSON.parse(recording.leadQualitySignals) : null,
      callIntelligence: recording.callIntelligenceJson ? JSON.parse(recording.callIntelligenceJson) : null,
      updatedFlowAction,
      updatedFlowNotes,
      updatedFlowDueAt,
    },
  };
}

async function processRecording(callSid: string, recordingSid: string, clientId?: string) {
  try {
    log(`Processing recording ${recordingSid} for call ${callSid}...`);

    const recording = await downloadRecording(recordingSid);
    if (!recording) {
      log(`Failed to download recording ${recordingSid}`);
      await db.update(twilioRecordings)
        .set({ status: "download_failed" })
        .where(eq(twilioRecordings.recordingSid, recordingSid));
      return;
    }

    let [recRow] = await db.select().from(twilioRecordings).where(eq(twilioRecordings.recordingSid, recordingSid)).limit(1);
    if (recRow && !recRow.callSessionId?.trim()) {
      const sessionId = await resolveBrowserCallSessionIdFromRecordingCallSid(recRow.callSid);
      if (sessionId) {
        await db
          .update(twilioRecordings)
          .set({ callSessionId: sessionId })
          .where(and(eq(twilioRecordings.id, recRow.id), isNull(twilioRecordings.callSessionId)));
        const [again] = await db
          .select()
          .from(twilioRecordings)
          .where(eq(twilioRecordings.id, recRow.id))
          .limit(1);
        if (again) recRow = again;
      }
    }
    const sessionCtx0 = await enrichContextFromCallSession(recRow);
    const companyName = sessionCtx0.companyName;
    const clientIdForPublish = clientId ?? sessionCtx0.clientId ?? undefined;
    if (!recRow?.toNumber || !recRow?.fromNumber) {
      const callDetails = await getCallDetails(callSid);
      if (callDetails) {
        await db.update(twilioRecordings)
          .set({ toNumber: callDetails.to || recRow?.toNumber, fromNumber: callDetails.from || recRow?.fromNumber })
          .where(eq(twilioRecordings.recordingSid, recordingSid));
      }
    }

    log(`Transcribing recording ${recordingSid} (${(recording.buffer.length / 1024).toFixed(0)}KB, ${recording.duration}s)...`);
    const transcription = await transcribeAudio(recording.buffer, `${recordingSid}.mp3`);

    const deterministicResult = analyzeContainmentDeterministic(transcription);
    log(`Deterministic analysis for ${recordingSid}: problem=${deterministicResult.problem_detected || "none"}, confidence=${deterministicResult.confidence || "n/a"}`);

    log(`Running GPT containment analysis for ${recordingSid}...`);
    const analysis = await analyzeContainment(transcription);

    const transcriptAuthority = detectNoAuthority(transcription);
    const analysisAuthority = detectNoAuthorityFromAnalysis(analysis);
    const authorityDetected = transcriptAuthority.detected || analysisAuthority.detected;
    const authorityResult = transcriptAuthority.detected ? transcriptAuthority : analysisAuthority;

    const followupExtraction = extractFollowupDate(transcription);
    let extractedFollowupDate: string | null = null;
    if (followupExtraction.detected && followupExtraction.isoDate) {
      extractedFollowupDate = followupExtraction.isoDate;
    }

    log(`Running call intelligence analysis for ${recordingSid}...`);
    const callIntel = await analyzeCallIntelligence(transcription, companyName || undefined);
    const followUpDate = callIntel.follow_up_date || extractedFollowupDate;

    log(`Running lead quality analysis for ${recordingSid}...`);
    const leadQuality = await analyzeLeadQuality(transcription, companyName || undefined);

    await db.update(twilioRecordings)
      .set({
        transcription,
        analysis,
        analysisJson: JSON.stringify(deterministicResult),
        problemDetected: deterministicResult.problem_detected || null,
        proposedPatchType: deterministicResult.proposed_patch_type || null,
        analysisConfidence: deterministicResult.confidence || null,
        noAuthority: authorityDetected,
        authorityReason: authorityResult.reason || null,
        suggestedRole: authorityResult.suggestedRole || null,
        followupDate: followUpDate,
        followupSource: followupExtraction.rawPhrase || null,
        leadQualityScore: leadQuality.score,
        leadQualityLabel: leadQuality.label,
        leadQualitySignals: JSON.stringify(leadQuality.signals),
        callIntelligenceJson: JSON.stringify(callIntel),
        duration: recording.duration,
        status: "analyzed",
        processedAt: new Date(),
      })
      .where(eq(twilioRecordings.recordingSid, recordingSid));

    eventBus.publish("CALL_ANALYSIS_COMPLETE", {
      callId: callSid,
      source: "twilio_recording",
      recordingSid,
      transcription: transcription.slice(0, 2000),
      analysis,
      callIntelligence: callIntel,
      problemDetected: deterministicResult.problem_detected || null,
      proposedPatchType: deterministicResult.proposed_patch_type || null,
      confidence: deterministicResult.confidence || null,
      noAuthority: authorityDetected,
      authorityReason: authorityResult.reason || null,
      suggestedRole: authorityResult.suggestedRole || null,
      extractedFollowupDate: followUpDate,
      followupSource: followupExtraction.rawPhrase || null,
      leadQualityScore: leadQuality.score,
      leadQualityLabel: leadQuality.label,
      leadQualitySignals: leadQuality.signals,
      ts: Date.now(),
    }, clientIdForPublish);

    try {
      const recData = await db.select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.recordingSid, recordingSid))
        .limit(1);
      const companyName = recData[0]?.companyName ?? sessionCtx0.companyName;

      if (companyName && process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
        const escapedName = companyName.replace(/'/g, "\\'");
        const formula = encodeURIComponent(`AND(LOWER({Company})=LOWER('${escapedName}'),{Transcription}='')`);
        const callSearchUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent("Calls")}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc&pageSize=1`;
        const callRes = await fetch(callSearchUrl, {
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
        });
        if (callRes.ok) {
          const callData = await callRes.json();
          const airtableCall = callData.records?.[0];
          if (airtableCall) {
            const writebackFields: Record<string, any> = {
              Transcription: transcription,
              Analysis: analysis,
              Analysis_JSON: JSON.stringify(deterministicResult),
            };
            if (deterministicResult.problem_detected) {
              writebackFields.Problem_Detected = deterministicResult.problem_detected;
              writebackFields.Proposed_Patch_Type = deterministicResult.proposed_patch_type;
              writebackFields.Analysis_Confidence = deterministicResult.confidence;
            }
            if (authorityDetected) {
              writebackFields.No_Authority = true;
              writebackFields.Authority_Reason = authorityResult.reason;
            }
            if (followUpDate) {
              writebackFields.Next_Followup = followUpDate;
              writebackFields.Followup_Source = `Twilio recording: "${followupExtraction.rawPhrase}" (${followupExtraction.confidence} confidence)`;
            }

            await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent("Calls")}/${airtableCall.id}`, {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ fields: writebackFields }),
            });
            log(`Airtable writeback complete for ${companyName} (call ${airtableCall.id})`);
          }
        }
      }
    } catch (airtableErr: any) {
      log(`Airtable writeback failed (non-blocking): ${airtableErr.message}`);
    }

    try {
      const recData2 = await db.select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.recordingSid, recordingSid))
        .limit(1);
      const rec = recData2[0];
      const flowCtx = await enrichContextFromCallSession(rec);
      if (flowCtx.companyName && flowCtx.clientId) {
        const aiNotes: string[] = [];
        const flowUpdates: Record<string, any> = { updatedAt: new Date() };

        if (followUpDate) {
          const fuDate = new Date(followUpDate);
          if (fuDate > new Date()) {
            flowUpdates.callbackAt = fuDate;
            flowUpdates.nextAction = `Follow up on ${fuDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
            aiNotes.push(`Follow-up date extracted: ${fuDate.toLocaleDateString()}`);
          }
        }

        if (authorityDetected) {
          aiNotes.push(`No decision authority detected${authorityResult.reason ? ` — ${authorityResult.reason}` : ""}`);
          if (authorityResult.suggestedRole) {
            aiNotes.push(`Suggested target role: ${authorityResult.suggestedRole}`);
          }
        }

        if (deterministicResult.problem_detected) {
          aiNotes.push(`Issue detected: ${deterministicResult.problem_detected}`);
        }

        const [activeFlow] = await db.select()
          .from(companyFlows)
          .where(and(
            eq(companyFlows.clientId, flowCtx.clientId),
            eq(companyFlows.companyName, flowCtx.companyName),
            eq(companyFlows.status, "active"),
          ))
          .orderBy(desc(companyFlows.updatedAt))
          .limit(1);

        if (activeFlow) {
          flowUpdates.verifiedQualityScore = callIntel.quality_score;
          flowUpdates.verifiedQualityLabel = leadQuality.label;
          flowUpdates.qualitySignals = JSON.stringify({
            buyingSignals: callIntel.buying_signals.length ? callIntel.buying_signals : leadQuality.buyingSignals,
            objections: callIntel.objections.length ? callIntel.objections : leadQuality.objections,
            signals: leadQuality.signals,
            nextStepReason: leadQuality.nextStepReason,
            intent: callIntel.intent,
            decisionMakerStatus: callIntel.decision_maker_status,
            nextBestAction: callIntel.next_best_action,
          });
          flowUpdates.transcriptSummary = callIntel.summary || leadQuality.summary;
          if (leadQuality.nextStepReason) {
            flowUpdates.nextAction = leadQuality.nextStepReason;
          }

          if (callIntel.intent === "interested" || callIntel.next_best_action === "warm_lead") {
            flowUpdates.lastOutcome = "interested";
            flowUpdates.warmStage = "verified_warm";
            aiNotes.push(`Call intent: interested — moved to warm lead`);
          } else if (callIntel.intent === "not_interested" || callIntel.next_best_action === "park") {
            flowUpdates.lastOutcome = "not_interested";
            flowUpdates.priority = Math.min(activeFlow.priority, 20);
            aiNotes.push(`Call intent: not interested — parked`);
          } else if (callIntel.intent === "callback_requested") {
            flowUpdates.lastOutcome = "followup_scheduled";
            if (followUpDate) {
              flowUpdates.nextDueAt = new Date(followUpDate);
              flowUpdates.nextAction = `Callback requested — follow up ${followUpDate}`;
            }
            aiNotes.push(`Call intent: callback requested`);
          } else if (callIntel.intent === "wrong_contact" || callIntel.next_best_action === "research_more") {
            flowUpdates.bestChannel = "research_more";
            flowUpdates.routingReason = `Wrong contact — need to find DM (${callIntel.decision_maker_status})`;
            flowUpdates.lastOutcome = "wrong_contact";
            aiNotes.push(`Call intent: wrong contact — push to research`);
          }

          if (callIntel.quality_score <= 3) {
            const WARM_OUTCOMES = ["interested", "meeting_requested", "followup_scheduled", "replied", "live_answer"];
            const currentOutcome = flowUpdates.lastOutcome ?? activeFlow.lastOutcome;
            if (currentOutcome && WARM_OUTCOMES.includes(currentOutcome)) {
              flowUpdates.lastOutcome = "not_qualified_by_transcript";
              flowUpdates.priority = Math.min(activeFlow.priority, 20);
              aiNotes.push(`Transcript override: outcome "${currentOutcome}" downgraded — lead scored ${callIntel.quality_score}/10`);
              log(`TRANSCRIPT OVERRIDE: ${rec.companyName} was "${currentOutcome}" but transcript scored ${callIntel.quality_score}/10 — downgrading [quality-check]`);
            }
          } else if (callIntel.quality_score <= 5 && activeFlow.lastOutcome === "live_answer") {
            aiNotes.push(`Transcript caution: live answer scored only ${callIntel.quality_score}/10 — may not be a real opportunity`);
          }

          if (aiNotes.length > 0) {
            flowUpdates.notes = aiNotes.join(" | ");
          }

          await db.update(companyFlows).set(flowUpdates).where(eq(companyFlows.id, activeFlow.id));

          if (followUpDate && flowUpdates.nextAction) {
            await db.update(actionQueue).set({
              taskType: flowUpdates.nextAction,
              dueAt: new Date(followUpDate),
            }).where(and(
              eq(actionQueue.flowId, activeFlow.id),
              eq(actionQueue.status, "pending"),
            ));
          }

          log(`Post-analysis flow update for ${rec.companyName}: intent=${callIntel.intent} next=${callIntel.next_best_action} quality=${callIntel.quality_score}/10`);
        }
      }
    } catch (flowErr: any) {
      log(`Post-analysis flow update failed (non-blocking): ${flowErr.message}`);
    }

    try {
      const [recForSse] = await db
        .select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.recordingSid, recordingSid))
        .limit(1);
      const linkSid = recForSse?.callSessionId?.trim();
      if (linkSid) {
        const [sessRow] = await db
          .select()
          .from(callSessions)
          .where(eq(callSessions.id, linkSid))
          .limit(1);
        if (sessRow) {
          await broadcastCallStatusFromCallSessionRow(sessRow, {
            recordingArtifactsReady: true,
            hasRecording: true,
            hasTranscript: transcription.length > 0,
            hasAnalysis: analysis.length > 0,
            latestRecordingRow: recForSse ?? null,
          });
        }
      }
    } catch (sseArtifactErr: any) {
      log(`Session artifact call_status broadcast failed (non-blocking): ${sseArtifactErr.message}`);
    }

    log(`Recording ${recordingSid} fully analyzed — transcription: ${transcription.length} chars, authority: ${authorityDetected ? "NO AUTHORITY" : "ok"}, problem: ${deterministicResult.problem_detected || "none"}`);
  } catch (err: any) {
    log(`Recording processing error for ${recordingSid}: ${err.message}`);
    try {
      await db.update(twilioRecordings)
        .set({ status: "error" })
        .where(eq(twilioRecordings.recordingSid, recordingSid));
    } catch {}
  }
}

export function registerTwilioRoutes(app: Express, authMiddleware: any) {
  app.get("/api/twilio/status", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const connected = await isTwilioConnected();
      const browserVoiceReady =
        connected && !!process.env.TWILIO_TWIML_APPLICATION_SID?.trim();
      res.json({ connected, recordingEnabled: true, browserVoiceReady });
    } catch (err: any) {
      res.json({ connected: false, error: err.message });
    }
  });

  app.post("/api/twilio/voice/token", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId as string | null | undefined;
      const email = (req as any).user?.email as string | undefined;
      if (!clientId || !email) {
        return res.status(400).json({ error: "User must be scoped to a client to use browser voice" });
      }
      const [userRow] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!userRow) {
        return res.status(401).json({ error: "User record not found" });
      }
      const { recovery, twilioIdentity } = await getVoiceSeatBrowserCallRecovery(clientId, userRow.id);
      const { token, ttl } = await mintVoiceAccessToken(twilioIdentity);
      res.json({
        token,
        identity: twilioIdentity,
        ttl,
        activeCallSessionId: recovery.activeCallSessionId,
        browserCallRecovery: recovery,
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("TWILIO_TWIML_APPLICATION_SID")) {
        return res.status(503).json({ error: msg });
      }
      log(`voice/token error: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/twilio/voice/prepare-outbound", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId as string | null | undefined;
      const email = (req as any).user?.email as string | undefined;
      if (!clientId || !email) {
        return res.status(400).json({ error: "User must be scoped to a client" });
      }
      const {
        to,
        workspaceKey,
        companyName,
        contactName,
        flowId,
        companyId,
        contactId,
        flowType,
        taskId,
      } = req.body || {};
      if (!to || typeof to !== "string") {
        return res.status(400).json({ error: "Phone number 'to' is required" });
      }
      if (!workspaceKey || typeof workspaceKey !== "string") {
        return res.status(400).json({ error: "workspaceKey is required" });
      }
      const normalizedTo = normalizePhone(to);
      if (!normalizedTo) {
        return res.status(400).json({ error: "Invalid phone number" });
      }
      const [userRow] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!userRow) {
        return res.status(401).json({ error: "User record not found" });
      }
      const seat = await ensureVoiceSeat(clientId, userRow.id);

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
        } else if (isCallSessionTerminalForSeatGuard(linked)) {
          await clearVoiceSeatActiveCallSessionForEndedSession(activeId);
        } else {
          return res.status(409).json({
            error: "VOICE_SEAT_ACTIVE_BROWSER_CALL",
            callSessionId: activeId,
          });
        }
      }

      let fromNumber: string;
      const seatDefault = seat.defaultCallerIdNumber?.trim();
      if (seatDefault) {
        const n = normalizePhone(seatDefault);
        if (n) fromNumber = n;
        else fromNumber = (await getTwilioFromNumber()).trim();
      } else {
        const sys = await getTwilioFromNumber();
        if (!sys?.trim()) {
          return res.status(400).json({ error: "No Twilio caller ID configured for this account" });
        }
        const n = normalizePhone(sys);
        fromNumber = n || sys.trim();
      }
      if (!fromNumber) {
        return res.status(400).json({ error: "Could not resolve caller ID" });
      }

      const metadata = JSON.stringify({
        companyName: companyName ?? null,
        contactName: contactName ?? null,
        flowId: flowId ?? null,
        companyId: companyId ?? null,
        contactId: contactId ?? null,
        flowType: flowType ?? null,
        taskId: taskId ?? null,
        twilioIdentity: seat.twilioIdentity,
      });

      const [session] = await db
        .insert(callSessions)
        .values({
          clientId,
          workspaceKey: workspaceKey.trim(),
          userId: userRow.id,
          seatId: seat.id,
          leadE164: normalizedTo,
          fromNumber,
          status: "prepared",
          metadata,
        })
        .returning();

      if (!session) {
        return res.status(500).json({ error: "Failed to create call session" });
      }

      await assignActiveCallSessionToSeat(seat.id, session.id);

      res.json({
        sessionId: session.id,
        identity: seat.twilioIdentity,
        fromNumber,
        normalizedTo,
      });
    } catch (err: any) {
      log(`voice/prepare-outbound error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/twilio/voice/abort-browser-call", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId as string | null | undefined;
      const email = (req as any).user?.email as string | undefined;
      const callSessionId =
        typeof req.body?.callSessionId === "string" ? req.body.callSessionId.trim() : "";
      if (!clientId || !email) {
        return res.status(400).json({ error: "User must be scoped to a client" });
      }
      if (!callSessionId) {
        return res.status(400).json({ error: "callSessionId is required" });
      }
      const [userRow] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!userRow) {
        return res.status(401).json({ error: "User record not found" });
      }
      const seat = await ensureVoiceSeat(clientId, userRow.id);

      const [session] = await db
        .select()
        .from(callSessions)
        .where(
          and(
            eq(callSessions.id, callSessionId),
            eq(callSessions.clientId, clientId),
            eq(callSessions.userId, userRow.id),
          ),
        )
        .limit(1);

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.seatId && session.seatId !== seat.id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (isCallSessionTerminalForSeatGuard(session)) {
        await clearVoiceSeatActiveCallSessionForEndedSession(callSessionId);
        const [freshTerminal] = await db
          .select()
          .from(callSessions)
          .where(eq(callSessions.id, callSessionId))
          .limit(1);
        if (freshTerminal) await broadcastCallStatusFromCallSessionRow(freshTerminal);
        return res.json({ ok: true, alreadyTerminal: true });
      }

      if (session.status === "in-progress") {
        return res.status(409).json({ error: "CALL_ALREADY_LIVE" });
      }

      if (!isBrowserCallSessionAbortableDbStatus(session.status)) {
        return res.status(409).json({ error: "SESSION_NOT_ABORTABLE" });
      }

      // Race: callee answered before status webhook promoted DB to in-progress
      if (session.status === "dialing") {
        const parent = session.parentCallSid?.trim();
        if (parent) {
          const tw = await getCallStatus(parent);
          if (tw?.status === "in-progress") {
            return res.status(409).json({ error: "CALL_ALREADY_LIVE" });
          }
        }
      }

      await markBrowserCallSessionAbortedAndClearSeat(callSessionId);
      const [freshAborted] = await db
        .select()
        .from(callSessions)
        .where(eq(callSessions.id, callSessionId))
        .limit(1);
      if (freshAborted) await broadcastCallStatusFromCallSessionRow(freshAborted);
      res.json({ ok: true });
    } catch (err: any) {
      log(`voice/abort-browser-call error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  /** One-shot marker: browser SDK connect succeeded (parent leg up). Does not touch status / answered_at / ended_at. */
  app.post("/api/twilio/voice/mark-browser-call-connected", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId as string | null | undefined;
      const email = (req as any).user?.email as string | undefined;
      const callSessionId =
        typeof req.body?.callSessionId === "string" ? req.body.callSessionId.trim() : "";
      if (!clientId || !email) {
        return res.status(400).json({ error: "User must be scoped to a client" });
      }
      if (!callSessionId) {
        return res.status(400).json({ error: "callSessionId is required" });
      }
      const [userRow] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!userRow) {
        return res.status(401).json({ error: "User record not found" });
      }
      const seat = await ensureVoiceSeat(clientId, userRow.id);

      const [session] = await db
        .select()
        .from(callSessions)
        .where(
          and(
            eq(callSessions.id, callSessionId),
            eq(callSessions.clientId, clientId),
            eq(callSessions.userId, userRow.id),
          ),
        )
        .limit(1);

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.seatId && session.seatId !== seat.id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await db
        .update(callSessions)
        .set({
          updatedAt: new Date(),
          connectedAt: new Date(),
        })
        .where(
          and(
            eq(callSessions.id, callSessionId),
            eq(callSessions.clientId, clientId),
            eq(callSessions.userId, userRow.id),
            isNull(callSessions.connectedAt),
          ),
        );

      const [freshConnected] = await db
        .select()
        .from(callSessions)
        .where(
          and(
            eq(callSessions.id, callSessionId),
            eq(callSessions.clientId, clientId),
            eq(callSessions.userId, userRow.id),
          ),
        )
        .limit(1);
      if (freshConnected) await broadcastCallStatusFromCallSessionRow(freshConnected);

      res.json({ ok: true });
    } catch (err: any) {
      log(`voice/mark-browser-call-connected error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  /** One-shot marker: browser SDK Call disconnected; does not touch status / connected_at / answered_at / ended_at. */
  app.post("/api/twilio/voice/mark-browser-call-disconnected", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId as string | null | undefined;
      const email = (req as any).user?.email as string | undefined;
      const callSessionId =
        typeof req.body?.callSessionId === "string" ? req.body.callSessionId.trim() : "";
      if (!clientId || !email) {
        return res.status(400).json({ error: "User must be scoped to a client" });
      }
      if (!callSessionId) {
        return res.status(400).json({ error: "callSessionId is required" });
      }
      const [userRow] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!userRow) {
        return res.status(401).json({ error: "User record not found" });
      }
      const seat = await ensureVoiceSeat(clientId, userRow.id);

      const [session] = await db
        .select()
        .from(callSessions)
        .where(
          and(
            eq(callSessions.id, callSessionId),
            eq(callSessions.clientId, clientId),
            eq(callSessions.userId, userRow.id),
          ),
        )
        .limit(1);

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.seatId && session.seatId !== seat.id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await db
        .update(callSessions)
        .set({
          updatedAt: new Date(),
          disconnectedAt: new Date(),
        })
        .where(
          and(
            eq(callSessions.id, callSessionId),
            eq(callSessions.clientId, clientId),
            eq(callSessions.userId, userRow.id),
            isNull(callSessions.disconnectedAt),
          ),
        );

      const [freshDisconnected] = await db
        .select()
        .from(callSessions)
        .where(
          and(
            eq(callSessions.id, callSessionId),
            eq(callSessions.clientId, clientId),
            eq(callSessions.userId, userRow.id),
          ),
        )
        .limit(1);
      if (freshDisconnected) await broadcastCallStatusFromCallSessionRow(freshDisconnected);

      res.json({ ok: true });
    } catch (err: any) {
      log(`voice/mark-browser-call-disconnected error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/twilio/sms", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { to, body } = req.body;
      if (!to || !body) {
        return res.status(400).json({ error: "Both 'to' phone number and 'body' message are required" });
      }
      if (typeof body !== "string" || body.length > 1600) {
        return res.status(400).json({ error: "Message body must be a string under 1600 characters" });
      }

      const result = await sendSms(to, body);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      log(`SMS sent by user to ${to}`);
      res.json({ ok: true, sid: result.sid });
    } catch (err: any) {
      log(`SMS route error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/twilio/call", authMiddleware, async (req: Request, res: Response) => {
    try {
      const {
        to,
        companyName,
        contactName,
        talkingPoints,
        flowId,
        companyId,
        contactId,
        flowType,
        taskId,
        enforceAiCallBotDial,
        outreachReason,
        createAiCallBotSession,
      } = req.body;
      if (!to) {
        return res.status(400).json({ error: "Phone number 'to' is required" });
      }

      const clientId = (req as any).user?.clientId || null;
      if (enforceAiCallBotDial && clientId && flowId && outreachReason) {
        const { validateReadyCallDial } = await import("./ai-call-bot/dial-guard");
        const guard = await validateReadyCallDial({
          clientId,
          flowId: Number(flowId),
          outreachReason: String(outreachReason),
        });
        if (!guard.allowed) {
          return res.status(403).json({ error: guard.message || "Dial guard rejected", reason: guard.reason });
        }
      }

      const baseUrl = getBaseUrl(req);
      const statusCallbackUrl = `${baseUrl}/api/twilio/webhook/status`;
      const recordingCallbackUrl = `${baseUrl}/api/twilio/webhook/recording`;

      let coachingActive = false;
      if (clientId) {
        const [clientRecord] = await db.select({ coachingEnabled: clients.coachingEnabled }).from(clients).where(eq(clients.id, clientId)).limit(1);
        coachingActive = clientRecord?.coachingEnabled ?? true;
      }

      let mediaStreamUrl: string | undefined;
      if (coachingActive) {
        const wsProtocol = baseUrl.startsWith("https") ? "wss" : "ws";
        const host = baseUrl.replace(/^https?:\/\//, "");
        mediaStreamUrl = `${wsProtocol}://${host}/media-stream`;
      }

      const useBidirectionalCoachingTwiml =
        !!mediaStreamUrl &&
        !!createAiCallBotSession &&
        !!clientId &&
        !!companyId &&
        !!outreachReason;

      const result = await initiateCall(to, statusCallbackUrl, recordingCallbackUrl, mediaStreamUrl, {
        coachingPublicBaseUrl: useBidirectionalCoachingTwiml ? baseUrl : undefined,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      let aiCallBotSessionId: number | undefined;

      if (result.sid) {
        try {
          const fid =
            flowId != null && flowId !== "" && Number.isFinite(Number(flowId)) ? Number(flowId) : null;
          await db.insert(twilioRecordings).values({
            callSid: result.sid,
            recordingSid: `pending-${result.sid}`,
            clientId,
            toNumber: to,
            companyName: companyName || null,
            contactName: contactName || null,
            companyId: companyId ? String(companyId) : null,
            contactId: contactId ? String(contactId) : null,
            flowId: fid,
            status: "call_initiated",
          });
        } catch (e: any) {
          log(`Failed to create recording record: ${e.message}`);
        }

        const sessionMeta = {
          flowId: flowId || null,
          companyId: companyId || null,
          contactId: contactId || null,
          flowType: flowType || null,
          taskId: taskId || null,
          clientId,
        };
        activeCallMeta.set(result.sid, sessionMeta);

        if (createAiCallBotSession && clientId && companyId && outreachReason) {
          try {
            const { createSession, transitionSession } = await import("./ai-call-bot/transfer-controller");
            const row = await createSession({
              clientId,
              companyId: String(companyId),
              contactId: contactId ? String(contactId) : null,
              flowId: flowId ? Number(flowId) : null,
              callSid: result.sid,
              outreachReason: String(outreachReason),
            });
            await transitionSession(row.id, clientId, "dial_started");
            aiCallBotSessionId = row.id;
          } catch (e: any) {
            log(`AI Call Bot session create failed (non-blocking): ${e.message}`);
          }
        }

        if (coachingActive) {
          registerCoachingSession(
            result.sid,
            companyName || "",
            contactName || "",
            Array.isArray(talkingPoints) ? talkingPoints : [],
            typeof aiCallBotSessionId !== "undefined"
              ? {
                  aiCallBotSessionId,
                  aiCallBotClientId: clientId ?? undefined,
                  voiceToPstn: true,
                }
              : { voiceToPstn: false }
          );
        }
      }

      log(`Call initiated by user to ${to} (recording: yes, coaching: ${coachingActive ? "yes" : "off"}, SID: ${result.sid}, flow: ${flowId || "none"}, company: ${companyId || "none"})`);
      res.json({
        ok: true,
        sid: result.sid,
        recordingEnabled: true,
        coachingEnabled: coachingActive,
        aiCallBotSessionId: typeof aiCallBotSessionId !== "undefined" ? aiCallBotSessionId : undefined,
      });
    } catch (err: any) {
      log(`Call route error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/call-session/:sid", authMiddleware, async (req: Request, res: Response) => {
    try {
      const sid = typeof req.params.sid === "string" ? req.params.sid : req.params.sid?.[0];
      if (!sid) {
        return res.status(400).json({ error: "Missing call sid" });
      }
      const status = await getCallStatus(sid);
      const meta = activeCallMeta.get(sid) || null;
      res.json({
        ...(status || { status: "unknown" }),
        meta,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Voice TwiML webhooks (coaching-outbound, lead-bidi-stream) are registered in server/index.ts before SPA layers. */

  app.post("/api/twilio/webhook/status", async (req: Request, res: Response) => {
    try {
      const { CallSid, CallStatus, CallDuration, AnsweredBy, ParentCallSid, Direction } = req.body;
      if (!CallSid || !CallStatus) {
        return res.status(200).send("<Response></Response>");
      }

      void import("./ai-call-bot/transfer-controller").then(({ applyTwilioWebhookToAiCallBotFsm }) =>
        applyTwilioWebhookToAiCallBotFsm({
          CallSid,
          CallStatus,
          CallDuration,
          AnsweredBy,
          ParentCallSid,
          Direction,
        })
      );

      const statusMap: Record<string, string> = {
        initiated: "dialing",
        ringing: "ringing",
        "in-progress": "in-progress",
        answered: "in-progress",
        completed: "completed",
        busy: "busy",
        failed: "failed",
        "no-answer": "no-answer",
        canceled: "canceled",
      };
      const mapped = statusMap[CallStatus] || CallStatus;
      log(`Status webhook: SID=${CallSid}, Status=${CallStatus} -> ${mapped}, Duration=${CallDuration || "n/a"}`);

      const parentSid =
        ParentCallSid && String(ParentCallSid).startsWith("CA") ? String(ParentCallSid) : null;
      /** Browser Voice SDK SSE listens on the parent (client) leg; Dial callbacks often use the child CallSid. */
      const sseCallSid = parentSid || CallSid;
      const browserSessionIdForBroadcast = await resolveBrowserCallSessionIdForTwilioWebhook({
        callSid: CallSid,
        parentSid,
      });

      await persistOutboundChildCallSidFromStatusIfEligible({
        callSid: CallSid,
        parentSid,
      });

      await promoteBrowserCallSessionToInProgressFromTwilioStatus({
        callSid: CallSid,
        parentSid,
        mappedStatus: mapped,
      });

      if (["completed", "failed", "busy", "no-answer", "canceled"].includes(mapped)) {
        await finalizeCallSessionFromTwilioStatus({
          callSid: CallSid,
          parentSid,
          mappedStatus: mapped,
        });
        activeCallMeta.delete(CallSid);
        if (parentSid) activeCallMeta.delete(parentSid);
      }

      let sessionTimeline: ReturnType<typeof browserSessionTimelineFromRow> | null = null;
      let recordingSummarySnapshot: ReturnType<typeof browserSessionLatestRecordingSummarySnapshot> | undefined;
      let postCallReadyWebhook = false;
      if (browserSessionIdForBroadcast) {
        const [sRow] = await db
          .select()
          .from(callSessions)
          .where(eq(callSessions.id, browserSessionIdForBroadcast))
          .limit(1);
        if (sRow) sessionTimeline = browserSessionTimelineFromRow(sRow);
        const [latestRecWebhook] = await db
          .select()
          .from(twilioRecordings)
          .where(eq(twilioRecordings.callSessionId, browserSessionIdForBroadcast))
          .orderBy(desc(twilioRecordings.createdAt))
          .limit(1);
        recordingSummarySnapshot = browserSessionLatestRecordingSummarySnapshot(latestRecWebhook ?? null);
        if (sRow) {
          postCallReadyWebhook = browserSessionPostCallReady({
            session: sRow,
            latestRec: latestRecWebhook ?? null,
          });
        }
      }
      broadcastCallStatus(sseCallSid, mapped, CallDuration, {
        callSessionId: browserSessionIdForBroadcast,
        sessionTimeline,
        recordingSummarySnapshot,
        postCallReady: postCallReadyWebhook,
      });

      res.status(200).send("<Response></Response>");
    } catch (err: any) {
      log(`Status webhook error: ${err.message}`);
      res.status(200).send("<Response></Response>");
    }
  });

  app.get("/api/twilio/call-status-stream/:sid", (req: Request, res: Response) => {
    const token = req.query.token as string | undefined;
    if (!token || !validateToken(token)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const sid = typeof req.params.sid === "string" ? req.params.sid : req.params.sid?.[0];
    if (!sid) {
      return res.status(400).json({ error: "Missing call sid" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ callSid: sid })}\n\n`);

    if (!callStatusSSEClients.has(sid)) {
      callStatusSSEClients.set(sid, new Set());
    }
    callStatusSSEClients.get(sid)!.add(res);

    const heartbeat = setInterval(() => {
      try { res.write(`:heartbeat\n\n`); } catch { clearInterval(heartbeat); }
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      const clients = callStatusSSEClients.get(sid);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) callStatusSSEClients.delete(sid);
      }
    });
  });

  app.get("/api/twilio/browser-call-session-status/:callSessionId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId as string | null | undefined;
      const callSessionId =
        typeof req.params.callSessionId === "string"
          ? req.params.callSessionId
          : req.params.callSessionId?.[0];
      if (!callSessionId) {
        return res.status(400).json({ error: "Missing call session id" });
      }
      const [session] = await db.select().from(callSessions).where(eq(callSessions.id, callSessionId)).limit(1);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (clientId && session.clientId !== clientId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const live = mapCallSessionRowToBrowserLiveStatus(session);
      const [latestRec] = await db
        .select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.callSessionId, callSessionId))
        .orderBy(desc(twilioRecordings.createdAt))
        .limit(1);
      const artifacts = browserSessionArtifactFlagsFromRecording(latestRec ?? null);
      const recSnap = browserSessionLatestRecordingSummarySnapshot(latestRec ?? null);
      const postCallReady = browserSessionPostCallReady({ session, latestRec });
      res.json({
        status: live.status,
        duration: live.duration,
        connectedAt: live.connectedAt,
        answeredAt: live.answeredAt,
        disconnectedAt: live.disconnectedAt,
        endedAt: live.endedAt,
        endedReason: live.endedReason,
        recordingArtifactsReady: artifacts.recordingArtifactsReady,
        hasRecording: artifacts.hasRecording,
        hasTranscript: artifacts.hasTranscript,
        hasAnalysis: artifacts.hasAnalysis,
        latestRecordingSid: recSnap.latestRecordingSid,
        latestRecordingStatus: recSnap.latestRecordingStatus,
        processedAt: recSnap.processedAt,
        summaryAvailable: recSnap.summaryAvailable,
        postCallReady,
        callSessionId: session.id,
        parentCallSid: session.parentCallSid,
        childCallSid: session.childCallSid,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/browser-call-status-stream/:callSessionId", async (req: Request, res: Response) => {
    const token = req.query.token as string | undefined;
    if (!token || !validateToken(token)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const entry = getTokenEntry(token);
    const clientId = entry?.clientId ?? null;

    const callSessionId =
      typeof req.params.callSessionId === "string"
        ? req.params.callSessionId
        : req.params.callSessionId?.[0];
    if (!callSessionId) {
      return res.status(400).json({ error: "Missing call session id" });
    }

    const [session] = await db.select().from(callSessions).where(eq(callSessions.id, callSessionId)).limit(1);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (clientId && session.clientId !== clientId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ callSessionId })}\n\n`);

    if (!callStatusSSEClientsByCallSessionId.has(callSessionId)) {
      callStatusSSEClientsByCallSessionId.set(callSessionId, new Set());
    }
    callStatusSSEClientsByCallSessionId.get(callSessionId)!.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`:heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      const clients = callStatusSSEClientsByCallSessionId.get(callSessionId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) callStatusSSEClientsByCallSessionId.delete(callSessionId);
      }
    });
  });

  app.get("/api/twilio/recording-by-company/:companyName", authMiddleware, async (req: Request, res: Response) => {
    try {
      const companyName =
        typeof req.params.companyName === "string" ? req.params.companyName : req.params.companyName?.[0];
      if (!companyName) return res.json([]);

      const recordings = await db.select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.companyName, companyName))
        .orderBy(desc(twilioRecordings.createdAt))
        .limit(50);

      res.json(recordings.map(r => ({
        callSid: r.callSid,
        recordingSid: r.recordingSid,
        duration: r.duration,
        transcription: r.transcription,
        analysis: r.analysis,
        problemDetected: r.problemDetected,
        noAuthority: r.noAuthority,
        authorityReason: r.authorityReason,
        suggestedRole: r.suggestedRole,
        followupDate: r.followupDate,
        status: r.status,
        contactName: r.contactName,
        createdAt: r.createdAt,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Authenticated MP3 proxy for HTML5 audio (client should fetch with Bearer token → blob URL).
   */
  app.get("/api/twilio/recording-stream/:recordingSid", authMiddleware, async (req: Request, res: Response) => {
    try {
      const recordingSid =
        typeof req.params.recordingSid === "string"
          ? req.params.recordingSid.trim()
          : String(req.params.recordingSid?.[0] || "").trim();
      if (!recordingSid || recordingSid.startsWith("pending-")) {
        return res.status(404).json({ error: "Recording not ready" });
      }
      const clientId = (req as any).user?.clientId as string | null | undefined;
      const [rec] = await db
        .select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.recordingSid, recordingSid))
        .limit(1);
      if (!rec) {
        return res.status(404).json({ error: "Not found" });
      }
      if (clientId && rec.clientId && rec.clientId !== clientId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const audio = await downloadRecording(recordingSid);
      if (!audio?.buffer?.length) {
        return res.status(502).json({ error: "Could not load recording from Twilio" });
      }
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=120");
      res.send(audio.buffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Focus Mode: latest recording scoped by flow + company + contact ids when present, then
   * contact name, then company / flow fallbacks. See tier order in handler.
   */
  app.get("/api/twilio/focus-last-call-review", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId as string | null | undefined;
      const companyName =
        typeof req.query.companyName === "string" ? req.query.companyName.trim() : "";
      const companyIdQ =
        typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
      const contactNameRaw =
        typeof req.query.contactName === "string" ? req.query.contactName.trim() : "";
      const contactIdQ =
        typeof req.query.contactId === "string" ? req.query.contactId.trim() : "";
      const flowIdRaw = req.query.flowId;
      const flowIdParsed =
        flowIdRaw != null && String(flowIdRaw).trim() !== ""
          ? Number(String(flowIdRaw).trim())
          : NaN;
      const flowIdOk = Number.isFinite(flowIdParsed) && flowIdParsed > 0 ? flowIdParsed : null;

      if (!companyName && !companyIdQ) {
        return res.json({
          recording: null,
          matchedScope: "none" as const,
          processingHint: null as null,
        });
      }

      const mapRow = (r: typeof twilioRecordings.$inferSelect) => ({
        callSid: r.callSid,
        recordingSid: r.recordingSid,
        duration: r.duration,
        transcription: r.transcription,
        analysis: r.analysis,
        problemDetected: r.problemDetected,
        noAuthority: r.noAuthority,
        authorityReason: r.authorityReason,
        suggestedRole: r.suggestedRole,
        followupDate: r.followupDate,
        status: r.status,
        contactName: r.contactName,
        createdAt: r.createdAt,
        processedAt: r.processedAt,
      });

      const processingHintFor = (r: typeof twilioRecordings.$inferSelect | null) => {
        if (!r) return null;
        const sid = r.recordingSid || "";
        if (sid.startsWith("pending-")) return "pending_audio" as const;
        if (r.status === "analyzed" && r.processedAt) return "ready" as const;
        if (r.transcription?.trim()) return "ready" as const;
        return "processing" as const;
      };

      function withTenant(...conds: SQL[]) {
        if (clientId) {
          return and(eq(twilioRecordings.clientId, clientId), ...conds);
        }
        return and(...conds);
      }

      const companyMatch = () => {
        if (companyIdQ && companyName) {
          return or(
            eq(twilioRecordings.companyId, companyIdQ),
            and(isNull(twilioRecordings.companyId), eq(twilioRecordings.companyName, companyName)),
          );
        }
        if (companyIdQ) {
          return eq(twilioRecordings.companyId, companyIdQ);
        }
        return eq(twilioRecordings.companyName, companyName);
      };

      let picked: typeof twilioRecordings.$inferSelect | null = null;
      type FocusMatchScope = "flow_contact" | "contact" | "flow_company" | "company" | "none";
      let matchedScope: FocusMatchScope = "none";

      const tryOne = async (whereExpr: SQL, scope: FocusMatchScope) => {
        if (picked) return;
        const [row] = await db
          .select()
          .from(twilioRecordings)
          .where(whereExpr)
          .orderBy(desc(twilioRecordings.createdAt))
          .limit(1);
        if (row) {
          picked = row;
          matchedScope = scope;
        }
      };

      // 1) Same flow + company id + contact id
      if (flowIdOk && companyIdQ && contactIdQ) {
        await tryOne(
          withTenant(
            eq(twilioRecordings.flowId, flowIdOk),
            eq(twilioRecordings.companyId, companyIdQ),
            eq(twilioRecordings.contactId, contactIdQ),
          ),
          "flow_contact",
        );
      }

      // 2) Company id + contact id (any flow)
      if (companyIdQ && contactIdQ) {
        await tryOne(
          withTenant(eq(twilioRecordings.companyId, companyIdQ), eq(twilioRecordings.contactId, contactIdQ)),
          "contact",
        );
      }

      // 3) Same flow + company (latest call on this flow for the account)
      if (flowIdOk) {
        await tryOne(withTenant(eq(twilioRecordings.flowId, flowIdOk), companyMatch()), "flow_company");
      }

      // 4) Contact name (legacy / missing ids)
      if (contactNameRaw) {
        const contactNorm = contactNameRaw.toLowerCase();
        await tryOne(
          withTenant(
            companyMatch(),
            isNotNull(twilioRecordings.contactName),
            sql`lower(trim(${twilioRecordings.contactName})) = ${contactNorm}`,
          ),
          "contact",
        );
      }

      // 5) Company-wide
      await tryOne(withTenant(companyMatch()), "company");

      if (!picked) {
        return res.json({ recording: null, matchedScope: "none", processingHint: null });
      }

      return res.json({
        recording: mapRow(picked),
        matchedScope,
        processingHint: processingHintFor(picked),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/twilio/webhook/recording", async (req: Request, res: Response) => {
    try {
      const {
        RecordingSid,
        RecordingUrl,
        RecordingStatus,
        RecordingDuration,
        CallSid,
        AccountSid,
        From,
        To,
      } = req.body;

      log(`Recording webhook: SID=${RecordingSid}, Status=${RecordingStatus}, Duration=${RecordingDuration}s, Call=${CallSid}, From=${From || "n/a"}, To=${To || "n/a"}`);

      if (RecordingStatus !== "completed") {
        return res.status(200).send("<Response></Response>");
      }

      if (!RecordingSid || !CallSid) {
        log("Recording webhook missing SID fields");
        return res.status(200).send("<Response></Response>");
      }

      const duration = parseInt(RecordingDuration || "0", 10);
      if (duration < 5) {
        log(`Recording ${RecordingSid} too short (${duration}s), skipping analysis`);
        return res.status(200).send("<Response></Response>");
      }

      const parentCallSidBody =
        req.body.ParentCallSid && String(req.body.ParentCallSid).startsWith("CA")
          ? String(req.body.ParentCallSid)
          : null;
      const { row: existingRow, browserCallSessionIdToLink } = await findRecordingRowForWebhook(
        CallSid,
        parentCallSidBody,
      );

      const dialMeta =
        activeCallMeta.get(CallSid) ||
        (parentCallSidBody ? activeCallMeta.get(parentCallSidBody) : undefined);

      let clientId: string | undefined;

      let callSessionIdForRow: string | null =
        existingRow?.callSessionId?.trim() || browserCallSessionIdToLink || null;
      if (
        existingRow?.callSessionId?.trim() &&
        browserCallSessionIdToLink &&
        existingRow.callSessionId !== browserCallSessionIdToLink
      ) {
        callSessionIdForRow = existingRow.callSessionId;
      }

      const recordingPayload: Record<string, unknown> = {
        recordingSid: RecordingSid,
        duration,
        status: "recording_ready" as const,
        ...(From && { fromNumber: String(From) }),
        ...(To && { toNumber: String(To) }),
        ...(callSessionIdForRow ? { callSessionId: callSessionIdForRow } : {}),
      };

      if (dialMeta) {
        if (dialMeta.clientId && !existingRow?.clientId) {
          recordingPayload.clientId = dialMeta.clientId;
        }
        if (dialMeta.companyId && !existingRow?.companyId) {
          recordingPayload.companyId = dialMeta.companyId;
        }
        if (dialMeta.contactId && !existingRow?.contactId) {
          recordingPayload.contactId = dialMeta.contactId;
        }
        if (
          dialMeta.flowId != null &&
          Number.isFinite(dialMeta.flowId) &&
          !existingRow?.flowId
        ) {
          recordingPayload.flowId = dialMeta.flowId;
        }
      }

      if (existingRow) {
        clientId = (existingRow.clientId || (recordingPayload.clientId as string | undefined)) || undefined;
        await db.update(twilioRecordings)
          .set(recordingPayload as any)
          .where(eq(twilioRecordings.id, existingRow.id));
      } else {
        const insertSessionId =
          callSessionIdForRow || (await resolveBrowserCallSessionIdFromRecordingCallSid(CallSid));
        await db.insert(twilioRecordings).values({
          callSid: CallSid,
          recordingSid: RecordingSid,
          duration,
          status: "recording_ready",
          fromNumber: From ? String(From) : null,
          toNumber: To ? String(To) : null,
          clientId: (recordingPayload.clientId as string | null | undefined) ?? null,
          companyId: (recordingPayload.companyId as string | null | undefined) ?? null,
          contactId: (recordingPayload.contactId as string | null | undefined) ?? null,
          flowId: (recordingPayload.flowId as number | null | undefined) ?? null,
          ...(insertSessionId ? { callSessionId: insertSessionId } : {}),
        });
      }

      res.status(200).send("<Response></Response>");

      activeCallMeta.delete(CallSid);
      if (parentCallSidBody) {
        activeCallMeta.delete(parentCallSidBody);
      }
      if (callSessionIdForRow) {
        const [sess] = await db
          .select({ parentCallSid: callSessions.parentCallSid })
          .from(callSessions)
          .where(eq(callSessions.id, callSessionIdForRow))
          .limit(1);
        if (sess?.parentCallSid) {
          activeCallMeta.delete(sess.parentCallSid);
        }
      }

      setImmediate(() => {
        processRecording(CallSid, RecordingSid, clientId).catch((err) => {
          log(`Background recording processing failed: ${err.message}`);
        });
      });
    } catch (err: any) {
      log(`Recording webhook error: ${err.message}`);
      res.status(200).send("<Response></Response>");
    }
  });

  app.get("/api/twilio/recordings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const clientId = (req as any).user?.clientId;

      let query = db.select().from(twilioRecordings).orderBy(desc(twilioRecordings.createdAt)).limit(limit);

      const recordings = await query;
      const filtered = clientId
        ? recordings.filter(r => r.clientId === clientId || !r.clientId)
        : recordings;

      res.json(filtered.map(r => ({
        id: r.id,
        callSid: r.callSid,
        recordingSid: r.recordingSid,
        toNumber: r.toNumber,
        companyName: r.companyName,
        contactName: r.contactName,
        duration: r.duration,
        status: r.status,
        problemDetected: r.problemDetected,
        noAuthority: r.noAuthority,
        authorityReason: r.authorityReason,
        suggestedRole: r.suggestedRole,
        analysisConfidence: r.analysisConfidence,
        followupDate: r.followupDate,
        createdAt: r.createdAt,
        processedAt: r.processedAt,
      })));
    } catch (err: any) {
      log(`List recordings error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/recordings/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const rawId = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
      const id = rawId ? parseInt(rawId, 10) : NaN;
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid recording ID" });
      }

      const [recording] = await db.select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.id, id))
        .limit(1);

      if (!recording) {
        return res.status(404).json({ error: "Recording not found" });
      }

      res.json(recording);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/recording-by-call-session/:callSessionId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const callSessionId =
        typeof req.params.callSessionId === "string"
          ? req.params.callSessionId
          : req.params.callSessionId?.[0];
      if (!callSessionId) return res.json(null);
      const clientId = (req as any).user?.clientId;

      const [session] = await db.select().from(callSessions).where(eq(callSessions.id, callSessionId)).limit(1);
      if (!session) return res.json(null);
      if (clientId && session.clientId !== clientId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const [recording] = await db
        .select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.callSessionId, callSessionId))
        .orderBy(desc(twilioRecordings.createdAt))
        .limit(1);

      if (!recording) return res.json(null);

      const built = await buildRecordingReadPayload(recording, clientId);
      if ("error" in built && built.error === "forbidden") {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json("payload" in built ? built.payload : null);
    } catch (err: any) {
      log(`Recording by callSessionId error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/recording-by-callsid/:callSid", authMiddleware, async (req: Request, res: Response) => {
    try {
      const callSid =
        typeof req.params.callSid === "string" ? req.params.callSid : req.params.callSid?.[0];
      if (!callSid) return res.json(null);
      const clientId = (req as any).user?.clientId;

      const [recording] = await db.select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.callSid, callSid))
        .orderBy(desc(twilioRecordings.createdAt))
        .limit(1);

      if (!recording) return res.json(null);

      const built = await buildRecordingReadPayload(recording, clientId);
      if ("error" in built && built.error === "forbidden") {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json("payload" in built ? built.payload : null);
    } catch (err: any) {
      log(`Recording by callSid error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/call/:sid", authMiddleware, async (req: Request, res: Response) => {
    try {
      const sid = typeof req.params.sid === "string" ? req.params.sid : req.params.sid?.[0];
      if (!sid) {
        return res.status(400).json({ error: "Missing sid" });
      }
      const status = await getCallStatus(sid);
      if (!status) {
        return res.status(404).json({ error: "Call not found" });
      }

      const recordings = await getRecordingsForCall(sid);
      res.json({ ...status, recordings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/calls", authMiddleware, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const calls = await listRecentCalls(limit);
      res.json(calls);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const messages = await listRecentMessages(limit);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/twilio/webhook/voice", async (req: Request, res: Response) => {
    try {
      const { CallSid, From, To, Direction } = req.body;
      log(`Inbound call: SID=${CallSid}, From=${From}, To=${To}, Direction=${Direction || "inbound"}`);

      const baseUrl = getBaseUrl(req);
      const recordingCallbackUrl = `${baseUrl}/api/twilio/webhook/recording`;

      const agentPhone = process.env.AGENT_PHONE || process.env.AI_CALL_BOT_AGENT_E164 || "";

      if (!agentPhone) {
        log("Inbound voice: AGENT_PHONE / AI_CALL_BOT_AGENT_E164 not set — cannot forward");
        return res.type("text/xml").send("<Response><Say>Service unavailable.</Say></Response>");
      }
      const twiml = `<Response><Dial record="record-from-answer-dual" callerId="${To}" recordingStatusCallback="${recordingCallbackUrl}" recordingStatusCallbackMethod="POST">${agentPhone}</Dial></Response>`;

      let clientId: string | null = null;
      try {
        const allClients = await db.select({ id: clients.id }).from(clients).limit(1);
        clientId = allClients[0]?.id || null;
        await db.insert(twilioRecordings).values({
          callSid: CallSid,
          recordingSid: `pending-${CallSid}`,
          clientId,
          toNumber: From,
          companyName: null,
          contactName: null,
          status: "inbound_call",
        });
      } catch (e: any) {
        log(`Failed to create inbound recording record: ${e.message}`);
      }

      activeCallMeta.set(CallSid, {
        flowId: null,
        companyId: null,
        contactId: null,
        flowType: null,
        taskId: null,
        clientId,
        direction: "inbound",
        callerNumber: From,
      });

      log(`Inbound call forwarding to agent ${agentPhone} (recording: yes)`);
      res.type("text/xml").send(twiml);
    } catch (err: any) {
      log(`Inbound call webhook error: ${err.message}`);
      res.type("text/xml").send("<Response><Say>Service unavailable.</Say></Response>");
    }
  });

  app.post("/api/twilio/webhook/sms", async (req: Request, res: Response) => {
    try {
      const { MessageSid, From, To, Body, NumMedia, MediaUrl0 } = req.body;
      log(`Inbound SMS: From=${From}, To=${To}, Body="${(Body || "").substring(0, 80)}"`);

      const mediaUrl = NumMedia && parseInt(NumMedia) > 0 ? MediaUrl0 || null : null;

      let matchedCompany: string | null = null;
      let matchedFlowId: number | null = null;

      const normalizedFrom = (From || "").replace(/[^0-9+]/g, "");
      if (normalizedFrom) {
        const pipelineMatch = await db.select({ companyName: outreachPipeline.companyName })
          .from(outreachPipeline)
          .where(sql`REPLACE(REPLACE(REPLACE(${outreachPipeline.phone}, ' ', ''), '-', ''), '(', '') LIKE ${"%" + normalizedFrom.replace("+1", "").slice(-10)}`)
          .limit(1);
        if (pipelineMatch.length > 0) {
          matchedCompany = pipelineMatch[0].companyName;
        }

        if (matchedCompany) {
          const flowMatch = await db.select({ id: companyFlows.id })
            .from(companyFlows)
            .where(and(
              sql`LOWER(${companyFlows.companyName}) = LOWER(${matchedCompany})`,
              eq(companyFlows.status, "active"),
            ))
            .orderBy(desc(companyFlows.updatedAt))
            .limit(1);
          if (flowMatch.length > 0) {
            matchedFlowId = flowMatch[0].id;
            await db.update(companyFlows).set({
              lastOutcome: "replied",
              outcomeSource: `SMS reply: "${(Body || "").substring(0, 100)}"`,
              updatedAt: new Date(),
            }).where(eq(companyFlows.id, matchedFlowId));
            log(`SMS matched to company "${matchedCompany}" (flow ${matchedFlowId}) — outcome updated to "replied"`);
          }
        }
      }

      await db.insert(inboundMessages).values({
        messageSid: MessageSid || null,
        fromNumber: From || "",
        toNumber: To || "",
        body: Body || "",
        mediaUrl,
        matchedCompany,
        matchedFlowId,
        status: "unread",
      });

      eventBus.publish("SMS_RECEIVED", {
        from: From,
        to: To,
        body: (Body || "").substring(0, 500),
        matchedCompany,
        ts: Date.now(),
      });

      res.type("text/xml").send("<Response></Response>");
    } catch (err: any) {
      log(`Inbound SMS webhook error: ${err.message}`);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  app.get("/api/twilio/inbound-messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const messages = await db.select().from(inboundMessages).orderBy(desc(inboundMessages.createdAt)).limit(50);
      const unreadCount = messages.filter(m => m.status === "unread").length;
      res.json({ messages, unreadCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/twilio/inbound-messages/:id/read", authMiddleware, async (req: Request, res: Response) => {
    try {
      const rawId = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
      const id = rawId ? parseInt(rawId, 10) : NaN;
      await db.update(inboundMessages).set({ status: "read" }).where(eq(inboundMessages.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/coaching/:callSid", (req: Request, res: Response) => {
    const token = req.query.token as string | undefined;
    if (!token || !validateToken(token)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const callSid =
      typeof req.params.callSid === "string" ? req.params.callSid : req.params.callSid?.[0];
    if (!callSid) {
      return res.status(400).json({ error: "Missing callSid" });
    }
    const subscribed = subscribeToCoaching(callSid, res);
    if (!subscribed) {
      res.status(404).json({ error: "No active coaching session for this call" });
    }
  });

  app.get("/api/twilio/coaching-sessions", authMiddleware, (_req: Request, res: Response) => {
    res.json(getActiveSessions());
  });

  app.post("/api/twilio/sync-recordings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const daysBack = Math.min(parseInt(req.body?.daysBack || "3", 10), 14);
      const since = new Date();
      since.setDate(since.getDate() - daysBack);

      log(`[sync] Starting Twilio recording sync (last ${daysBack} days, since ${since.toISOString()})...`);

      const recordings = await listAllRecordings(since, 200);
      log(`[sync] Found ${recordings.length} recordings in Twilio`);

      const existingRecordings = await db.select({ recordingSid: twilioRecordings.recordingSid })
        .from(twilioRecordings);
      const existingSids = new Set(existingRecordings.map(r => r.recordingSid));
      const existingPendingSids = new Set(
        existingRecordings
          .filter(r => r.recordingSid.startsWith("pending-"))
          .map(r => r.recordingSid.replace("pending-", ""))
      );

      const newRecordings = recordings.filter(r =>
        r.duration >= 5 &&
        !existingSids.has(r.sid) &&
        !existingPendingSids.has(r.callSid)
      );

      log(`[sync] ${newRecordings.length} new recordings to process (filtered out ${recordings.length - newRecordings.length} existing/short)`);

      const airtableRecords: any[] = [];
      if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
        let offset: string | undefined;
        do {
          const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent("Calls")}?pageSize=100${offset ? `&offset=${offset}` : ""}`;
          const atRes = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
          });
          if (atRes.ok) {
            const atData = await atRes.json();
            airtableRecords.push(...(atData.records || []));
            offset = atData.offset;
          } else {
            offset = undefined;
          }
        } while (offset);
        log(`[sync] Loaded ${airtableRecords.length} Airtable call records for phone matching`);
      }

      const phoneToCompany = new Map<string, string>();
      for (const rec of airtableRecords) {
        const phone = rec.fields.phone || rec.fields.Phone || "";
        const company = rec.fields.company_name || rec.fields.Company_Name || rec.fields.Company || "";
        if (phone && company) {
          const digits = phone.replace(/[^0-9]/g, "").slice(-10);
          if (digits.length === 10) {
            phoneToCompany.set(digits, company);
          }
        }
      }

      const pipelineRecords = await db.select({
        companyName: outreachPipeline.companyName,
        phone: outreachPipeline.phone,
      }).from(outreachPipeline);

      for (const pr of pipelineRecords) {
        if (pr.phone && pr.companyName) {
          const digits = pr.phone.replace(/[^0-9]/g, "").slice(-10);
          if (digits.length === 10 && !phoneToCompany.has(digits)) {
            phoneToCompany.set(digits, pr.companyName);
          }
        }
      }

      log(`[sync] Phone-to-company map: ${phoneToCompany.size} entries`);

      const results: any[] = [];
      let processed = 0;
      let transcribed = 0;
      let matched = 0;
      const errors: string[] = [];

      for (const rec of newRecordings) {
        try {
          const callDetails = await getCallDetails(rec.callSid);
          if (!callDetails) {
            errors.push(`Could not fetch call details for ${rec.callSid}`);
            continue;
          }

          const agentDigits = (process.env.AGENT_PHONE || process.env.AI_CALL_BOT_AGENT_E164 || "").replace(/[^0-9]/g, "").slice(-10);
          const toDigits = (callDetails.to || "").replace(/[^0-9]/g, "").slice(-10);
          const fromDigits = (callDetails.from || "").replace(/[^0-9]/g, "").slice(-10);

          const childDigits = (callDetails.childNumbers || []).map((n: string) => n.replace(/[^0-9]/g, "").slice(-10));

          let leadNumber = "";
          if (childDigits.length > 0) {
            leadNumber = childDigits.find((d: string) => d !== agentDigits) || childDigits[0];
          } else if (toDigits === agentDigits) {
            leadNumber = fromDigits;
          } else if (fromDigits === agentDigits) {
            leadNumber = toDigits;
          } else {
            leadNumber = toDigits;
          }

          let companyName = phoneToCompany.get(leadNumber) || null;
          if (!companyName) {
            for (const cd of childDigits) {
              companyName = phoneToCompany.get(cd) || null;
              if (companyName) break;
            }
          }
          if (!companyName) {
            companyName = phoneToCompany.get(toDigits) || phoneToCompany.get(fromDigits) || null;
          }

          const leadPhone = leadNumber ? `+1${leadNumber}` : (callDetails.to || null);
          await db.insert(twilioRecordings).values({
            callSid: rec.callSid,
            recordingSid: rec.sid,
            toNumber: leadPhone,
            fromNumber: callDetails.from || null,
            companyName,
            duration: rec.duration,
            status: "recording_ready",
          }).onConflictDoNothing();

          processed++;
          if (companyName) matched++;

          log(`[sync] ${processed}/${newRecordings.length}: ${rec.sid} (${rec.duration}s) → ${companyName || "unmatched"} [lead:+1${leadNumber}] [to:${callDetails.to}] [children:${childDigits.join(",")}]`);

          const recording = await downloadRecording(rec.sid);
          if (!recording || !recording.buffer || recording.buffer.length < 1000) {
            log(`[sync] Skipping ${rec.sid} — download failed or too small`);
            continue;
          }

          log(`[sync] Transcribing ${rec.sid} (${(recording.buffer.length / 1024).toFixed(0)}KB)...`);
          const transcription = await transcribeAudio(recording.buffer, `${rec.sid}.mp3`);
          if (!transcription || transcription.length < 10) {
            log(`[sync] Transcription empty for ${rec.sid}`);
            await db.update(twilioRecordings)
              .set({ status: "transcription_empty", processedAt: new Date() })
              .where(eq(twilioRecordings.recordingSid, rec.sid));
            continue;
          }

          transcribed++;
          log(`[sync] Transcribed ${rec.sid}: "${transcription.substring(0, 80)}..."`);

          if (!companyName && transcription.length > 30) {
            const firstWords = transcription.substring(0, 300).toLowerCase();
            for (const [digits, name] of Array.from(phoneToCompany.entries())) {
              if (firstWords.includes(name.toLowerCase().split(/[\s,]+/)[0].toLowerCase()) && name.length > 4) {
                companyName = name;
                log(`[sync] Transcript-matched to "${name}" by keyword`);
                break;
              }
            }
            if (!companyName) {
              for (const atRec of airtableRecords) {
                const atName = atRec.fields.company_name || atRec.fields.Company_Name || atRec.fields.Company || "";
                if (atName.length > 4) {
                  const keyword = atName.split(/[\s,]+/)[0].toLowerCase();
                  if (keyword.length > 3 && firstWords.includes(keyword)) {
                    companyName = atName;
                    log(`[sync] Transcript-matched to "${atName}" by Airtable keyword "${keyword}"`);
                    break;
                  }
                }
              }
            }
          }

          const deterministicResult = analyzeContainmentDeterministic(transcription);
          const analysis = await analyzeContainment(transcription);
          const transcriptAuthority = detectNoAuthority(transcription);
          const analysisAuthority = detectNoAuthorityFromAnalysis(analysis);
          const authorityDetected = transcriptAuthority.detected || analysisAuthority.detected;
          const authorityResult = transcriptAuthority.detected ? transcriptAuthority : analysisAuthority;
          const followupExtraction = extractFollowupDate(transcription);
          const extractedFollowupDate = followupExtraction.detected && followupExtraction.isoDate ? followupExtraction.isoDate : null;
          const callIntel = await analyzeCallIntelligence(transcription, companyName || undefined);
          const leadQuality = await analyzeLeadQuality(transcription, companyName ?? undefined);
          const followUpDate = callIntel.follow_up_date || extractedFollowupDate;

          await db.update(twilioRecordings)
            .set({
              transcription,
              analysis,
              analysisJson: JSON.stringify(deterministicResult),
              problemDetected: deterministicResult.problem_detected || null,
              proposedPatchType: deterministicResult.proposed_patch_type || null,
              analysisConfidence: deterministicResult.confidence || null,
              noAuthority: authorityDetected,
              authorityReason: authorityResult.reason || null,
              suggestedRole: authorityResult.suggestedRole || null,
              followupDate: followUpDate,
              followupSource: followupExtraction.rawPhrase || null,
              leadQualityScore: leadQuality.score,
              leadQualityLabel: leadQuality.label,
              leadQualitySignals: JSON.stringify(leadQuality.signals),
              callIntelligenceJson: JSON.stringify(callIntel),
              companyName: companyName,
              duration: rec.duration,
              status: "analyzed",
              processedAt: new Date(),
            })
            .where(eq(twilioRecordings.recordingSid, rec.sid));

          if (companyName) {
            const [activeFlow] = await db.select()
              .from(companyFlows)
              .where(and(
                sql`LOWER(${companyFlows.companyName}) = LOWER(${companyName})`,
                eq(companyFlows.status, "active"),
              ))
              .orderBy(desc(companyFlows.updatedAt))
              .limit(1);

            if (activeFlow) {
              const flowUpdates: Record<string, any> = {
                verifiedQualityScore: callIntel.quality_score,
                verifiedQualityLabel: leadQuality.label,
                qualitySignals: JSON.stringify({
                  buyingSignals: callIntel.buying_signals.length ? callIntel.buying_signals : leadQuality.buyingSignals,
                  objections: callIntel.objections.length ? callIntel.objections : leadQuality.objections,
                  signals: leadQuality.signals,
                  nextStepReason: leadQuality.nextStepReason,
                  intent: callIntel.intent,
                  decisionMakerStatus: callIntel.decision_maker_status,
                  nextBestAction: callIntel.next_best_action,
                }),
                transcriptSummary: callIntel.summary || leadQuality.summary,
                updatedAt: new Date(),
              };
              if (leadQuality.nextStepReason) {
                flowUpdates.nextAction = leadQuality.nextStepReason;
              }
              if (followUpDate) {
                flowUpdates.callbackAt = new Date(followUpDate);
              }
              if (callIntel.intent === "interested" || callIntel.next_best_action === "warm_lead") {
                flowUpdates.lastOutcome = "interested";
                flowUpdates.warmStage = "verified_warm";
              } else if (callIntel.intent === "not_interested" || callIntel.next_best_action === "park") {
                flowUpdates.lastOutcome = "not_interested";
                flowUpdates.priority = Math.min(activeFlow.priority, 20);
              } else if (callIntel.intent === "callback_requested") {
                flowUpdates.lastOutcome = "followup_scheduled";
              } else if (callIntel.intent === "wrong_contact" || callIntel.next_best_action === "research_more") {
                flowUpdates.bestChannel = "research_more";
                flowUpdates.routingReason = `Wrong contact — need to find DM (${callIntel.decision_maker_status})`;
                flowUpdates.lastOutcome = "wrong_contact";
              }
              await db.update(companyFlows).set(flowUpdates).where(eq(companyFlows.id, activeFlow.id));
              log(`[sync] Updated flow for ${companyName}: intent=${callIntel.intent} quality=${callIntel.quality_score}/10`);
            }
          }

          results.push({
            recordingSid: rec.sid,
            callSid: rec.callSid,
            duration: rec.duration,
            companyName,
            leadPhone: leadPhone,
            to: callDetails.to,
            from: callDetails.from,
            qualityScore: callIntel.quality_score,
            qualityLabel: leadQuality.label,
            summary: callIntel.summary?.substring(0, 150) || leadQuality.summary?.substring(0, 150),
            followupDate: followUpDate,
            intent: callIntel.intent,
            nextBestAction: callIntel.next_best_action,
            transcriptPreview: transcription.substring(0, 100),
          });
        } catch (err: any) {
          errors.push(`${rec.sid}: ${err.message}`);
          log(`[sync] Error processing ${rec.sid}: ${err.message}`);
        }
      }

      log(`[sync] Complete: ${processed} processed, ${transcribed} transcribed, ${matched} matched to companies, ${errors.length} errors`);

      res.json({
        totalInTwilio: recordings.length,
        alreadySynced: recordings.length - newRecordings.length,
        processed,
        transcribed,
        matched,
        results,
        errors,
      });
    } catch (err: any) {
      log(`[sync] Sync error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  log("Twilio routes registered (with recording intelligence pipeline + live coaching)");
}
