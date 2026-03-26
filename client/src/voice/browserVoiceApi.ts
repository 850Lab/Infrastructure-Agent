import { apiRequest } from "@/lib/queryClient";

/** Mirrors server `BrowserCallRecoveryPayload` from POST /api/twilio/voice/token. */
export type BrowserCallRecoveryPayload = {
  seatId: string;
  activeCallSessionId: string | null;
  isLive: boolean;
  session: {
    id: string;
    status: string;
    endedAt: string | null;
    parentCallSid: string | null;
  } | null;
};

export async function postVoiceToken(): Promise<{
  token: string;
  identity: string;
  ttl?: number;
  activeCallSessionId?: string | null;
  browserCallRecovery?: BrowserCallRecoveryPayload;
}> {
  const res = await apiRequest("POST", "/api/twilio/voice/token");
  const data = await res.json();
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `Token request failed (${res.status})`);
  }
  if (!data.token) {
    throw new Error("No token in response");
  }
  return data;
}

/**
 * Seat / active browser call_session recovery. Uses POST /api/twilio/voice/token (same request as the SDK token).
 */
export async function fetchBrowserVoiceSeatRecovery(): Promise<BrowserCallRecoveryPayload> {
  const r = await postVoiceToken();
  if (r.browserCallRecovery) return r.browserCallRecovery;
  return {
    seatId: "",
    activeCallSessionId: null,
    isLive: false,
    session: null,
  };
}

/** Release seat + mark session aborted when browser connect fails or operator cancels pre-live. */
/** JSON from GET /api/twilio/browser-call-session-status/:id (optional fields for older rows). */
export type BrowserCallSessionStatusPayload = {
  status: string;
  duration: string | null;
  connectedAt: string | null;
  answeredAt: string | null;
  disconnectedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
  callSessionId: string;
  parentCallSid?: string | null;
  childCallSid?: string | null;
  /**
   * Session-keyed call_status SSE after processRecording, and GET browser-call-session-status
   * (derived from latest linked twilio_recordings row).
   */
  recordingArtifactsReady?: boolean;
  hasRecording?: boolean;
  hasTranscript?: boolean;
  hasAnalysis?: boolean;
  /** Latest linked twilio_recordings row (by createdAt desc); nulls when no row. */
  latestRecordingSid?: string | null;
  latestRecordingStatus?: string | null;
  /** Recording pipeline processedAt (ISO); not session lifecycle. */
  processedAt?: string | null;
  /** True when call intelligence includes a non-empty summary (no body in this payload). */
  summaryAvailable?: boolean;
  /** Terminal (non-aborted) session + analyzed recording + summary available (single readiness gate). */
  postCallReady?: boolean;
};

/** Optional artifact + recording snapshot fields on session-keyed `call_status` SSE (same meanings as GET). */
export type BrowserSessionKeyedCallStatusSseSnapshot = Pick<
  BrowserCallSessionStatusPayload,
  | "recordingArtifactsReady"
  | "hasRecording"
  | "hasTranscript"
  | "hasAnalysis"
  | "latestRecordingSid"
  | "latestRecordingStatus"
  | "processedAt"
  | "summaryAvailable"
  | "postCallReady"
>;

/** Session-first browser live status (auth: Bearer in fetch / token query for EventSource). */
export function browserCallSessionStatusPath(callSessionId: string): string {
  return `/api/twilio/browser-call-session-status/${encodeURIComponent(callSessionId)}`;
}

export function browserCallStatusStreamUrl(callSessionId: string, token: string): string {
  return `/api/twilio/browser-call-status-stream/${encodeURIComponent(callSessionId)}?token=${encodeURIComponent(token)}`;
}

export async function postAbortBrowserCall(callSessionId: string): Promise<{ ok: boolean; alreadyTerminal?: boolean }> {
  const res = await apiRequest("POST", "/api/twilio/voice/abort-browser-call", { callSessionId });
  const data = (await res.json()) as { ok?: boolean; alreadyTerminal?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `Abort failed (${res.status})`);
  }
  return { ok: !!data.ok, alreadyTerminal: data.alreadyTerminal };
}

/** Idempotent: sets call_sessions.connected_at once when browser Device.connect succeeds. */
export async function postMarkBrowserCallConnected(callSessionId: string): Promise<{ ok: boolean }> {
  const res = await apiRequest("POST", "/api/twilio/voice/mark-browser-call-connected", { callSessionId });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `Mark connected failed (${res.status})`);
  }
  return { ok: !!data.ok };
}

/** Idempotent: sets call_sessions.disconnected_at once when browser Call disconnects. */
export async function postMarkBrowserCallDisconnected(callSessionId: string): Promise<{ ok: boolean }> {
  const res = await apiRequest("POST", "/api/twilio/voice/mark-browser-call-disconnected", { callSessionId });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `Mark disconnected failed (${res.status})`);
  }
  return { ok: !!data.ok };
}

export async function postPrepareOutbound(body: Record<string, unknown>): Promise<{
  sessionId: string;
  identity: string;
  fromNumber: string;
  normalizedTo: string;
}> {
  const res = await apiRequest("POST", "/api/twilio/voice/prepare-outbound", body);
  const data = (await res.json()) as {
    error?: string;
    callSessionId?: string;
  };
  if (!res.ok) {
    if (res.status === 409 && data.callSessionId) {
      throw new Error(
        `You already have an active browser call. Disconnect or wait for it to end before starting another. (session ${data.callSessionId})`,
      );
    }
    throw new Error(typeof data.error === "string" ? data.error : `Prepare failed (${res.status})`);
  }
  return data as {
    sessionId: string;
    identity: string;
    fromNumber: string;
    normalizedTo: string;
  };
}
