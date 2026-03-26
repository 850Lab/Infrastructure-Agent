import type { Response } from "express";

/** Shared across Twilio HTTP routes and early-mounted TwiML webhooks (browser Voice). */
export type ActiveCallSessionMeta = {
  flowId: number | null;
  companyId: string | null;
  contactId: string | null;
  flowType: string | null;
  taskId: number | null;
  clientId: string | null;
  callSessionId?: string | null;
  workspaceKey?: string | null;
  voiceBrowser?: boolean;
  /** Inbound PSTN bridge (legacy) */
  direction?: string | null;
  callerNumber?: string | null;
};

export const activeCallMeta = new Map<string, ActiveCallSessionMeta>();

export const callStatusSSEClients = new Map<string, Set<Response>>();

/** Browser Voice: subscribers keyed by call_sessions.id (parallel to CallSid-keyed clients). */
export const callStatusSSEClientsByCallSessionId = new Map<string, Set<Response>>();

/** Session row snapshot for call_status SSE (ISO timestamps; aligns with browser-call-session-status). */
export type CallStatusBroadcastSessionTimeline = {
  connectedAt: string | null;
  answeredAt: string | null;
  disconnectedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
};

/** Latest linked recording metadata only (no transcript/analysis); aligns with browser-call-session-status. */
export type CallStatusRecordingSummarySnapshot = {
  latestRecordingSid: string | null;
  latestRecordingStatus: string | null;
  processedAt: string | null;
  summaryAvailable: boolean;
};

function closeAndDeleteSseClients(map: Map<string, Set<Response>>, key: string) {
  const clients = map.get(key);
  if (!clients) return;
  for (const res of Array.from(clients)) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  map.delete(key);
}

export function broadcastCallStatus(
  callSid: string,
  status: string,
  duration?: string,
  options?: {
    callSessionId?: string | null;
    /** Present after DB refresh for browser sessions; otherwise timeline keys are null. */
    sessionTimeline?: CallStatusBroadcastSessionTimeline | null;
    /** Session-linked recording finished transcript/analysis (processRecording); optional booleans only when true. */
    recordingArtifactsReady?: boolean;
    hasRecording?: boolean;
    hasTranscript?: boolean;
    hasAnalysis?: boolean;
    recordingSummarySnapshot?: CallStatusRecordingSummarySnapshot | null;
    /** Derived terminal + artifacts + summary (browser session); false when absent. */
    postCallReady?: boolean;
  },
) {
  const callSessionId = options?.callSessionId?.trim() || null;
  const tl = options?.sessionTimeline;
  const snap = options?.recordingSummarySnapshot;
  const data = {
    callSid,
    callSessionId,
    status,
    duration: duration || null,
    connectedAt: tl?.connectedAt ?? null,
    answeredAt: tl?.answeredAt ?? null,
    disconnectedAt: tl?.disconnectedAt ?? null,
    endedAt: tl?.endedAt ?? null,
    endedReason: tl?.endedReason ?? null,
    latestRecordingSid: snap?.latestRecordingSid ?? null,
    latestRecordingStatus: snap?.latestRecordingStatus ?? null,
    processedAt: snap?.processedAt ?? null,
    summaryAvailable: snap?.summaryAvailable ?? false,
    postCallReady: options?.postCallReady ?? false,
    ts: Date.now(),
    ...(options?.recordingArtifactsReady
      ? {
          recordingArtifactsReady: true,
          hasRecording: options.hasRecording !== false,
          hasTranscript: !!options.hasTranscript,
          hasAnalysis: !!options.hasAnalysis,
        }
      : {}),
  };
  const payload = `event: call_status\ndata: ${JSON.stringify(data)}\n\n`;

  const deliver = (key: string, map: Map<string, Set<Response>>) => {
    const clients = map.get(key);
    if (!clients || clients.size === 0) return;
    for (const res of Array.from(clients)) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  };

  deliver(callSid, callStatusSSEClients);
  if (callSessionId) {
    deliver(callSessionId, callStatusSSEClientsByCallSessionId);
  }

  if (["completed", "failed", "busy", "no-answer", "canceled"].includes(status)) {
    closeAndDeleteSseClients(callStatusSSEClients, callSid);
    if (callSessionId) {
      closeAndDeleteSseClients(callStatusSSEClientsByCallSessionId, callSessionId);
    }
  }
}
