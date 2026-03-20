import { WebSocketServer, WebSocket } from "ws";
import type { Server as HTTPServer } from "http";
import { log as appLog } from "./index";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

function log(msg: string) {
  appLog(msg, "realtime-coach");
}

const CONTAINMENT_PHRASES = [
  "send it", "send info", "send me info", "pass it", "pass along",
  "email it", "shoot it over", "forward it", "send me something",
  "send that over", "just send", "drop me an email", "send a brochure",
  "send me your info", "send over some info", "mail me something",
  "leave your info", "drop off some info", "give me your card",
  "send your information", "put something in the mail",
];

const AUTHORITY_REDIRECT_PHRASES = [
  "who handles that", "who oversees", "who is responsible",
  "who do i speak with", "right desk", "handled by someone else",
  "best person", "point person", "who should i talk to",
  "who makes that decision", "who's in charge", "who would i speak with",
  "who manages", "who runs", "who's the decision maker",
  "who typically handles", "right person", "who do i need to talk to",
];

const NO_AUTHORITY_PATTERNS = [
  /(?:that'?s?\s+)?not\s+my\s+(?:department|area|responsibility|job)/i,
  /i\s+don'?t\s+(?:handle|deal\s+with|manage|do)\s+that/i,
  /(?:you(?:'d|'ll)?\s+)?(?:need|have)\s+to\s+(?:talk|speak|reach\s+out)\s+(?:to|with)/i,
  /i(?:'m|\s+am)\s+(?:not|just)\s+(?:the\s+)?(?:right|correct|person|one)\s+(?:for|to)/i,
  /i\s+(?:can'?t|cannot)\s+(?:make|authorize|approve|sign\s+off)/i,
  /(?:that'?s?|it'?s?)\s+(?:above|beyond|outside)\s+my\s+(?:pay\s*grade|authority|scope)/i,
  /(?:someone|somebody)\s+else\s+(?:handles?|takes?\s+care\s+of|deals?\s+with)/i,
];

const ROLE_CAPTURE_PATTERNS = [
  /(?:talk|speak|reach\s+out)\s+(?:to|with)\s+(?:our|the|a)\s+(.+?)(?:\.|,|$|\s+(?:about|regarding|for|he|she|they))/i,
  /(?:transfer|connect|put)\s+you\s+(?:to|with|through\s+to)\s+(?:our|the|a)\s+(.+?)(?:\.|,|$)/i,
  /(?:ask\s+for|look\s+for)\s+(.+?)(?:\.|,|$|\s+(?:about|regarding|for|he|she|they))/i,
];

const FOLLOWUP_PATTERNS = [
  /call\s+(?:me\s+)?back\s+(?:on\s+)?(\w+day|tomorrow|next\s+week|monday|tuesday|wednesday|thursday|friday)/i,
  /try\s+(?:us\s+)?(?:again\s+)?(?:on\s+)?(\w+day|tomorrow|next\s+week|monday|tuesday|wednesday|thursday|friday)/i,
  /(?:i'm|i\s+am|he's|she's|they're)\s+(?:available|free|here)\s+(?:on\s+)?(\w+day|tomorrow|next\s+week|monday|tuesday|wednesday|thursday|friday)/i,
  /(?:better|best)\s+(?:time|day)\s+(?:would\s+be|is)\s+(\w+day|tomorrow|next\s+week|monday|tuesday|wednesday|thursday|friday)/i,
];

interface CoachingAlert {
  type: "containment" | "authority" | "followup" | "no_authority";
  severity: "red" | "amber" | "blue";
  message: string;
  suggestion: string;
  matchedPhrase: string;
  timestamp: number;
}

interface ActiveSession {
  callSid: string;
  streamSid: string | null;
  companyName: string;
  contactName: string;
  talkingPoints: string[];
  transcript: string[];
  alerts: CoachingAlert[];
  openaiWsInbound: WebSocket | null;
  openaiWsOutbound: WebSocket | null;
  sseClients: Set<any>;
  startedAt: number;
  lastTranscriptPush: number;
  /** AI Call Bot: once set, stop forwarding media to OpenAI — human has taken over. */
  humanTakeoverAt: number | null;
}

const activeSessions = new Map<string, ActiveSession>();

function detectAlerts(text: string, fullTranscript: string[]): CoachingAlert[] {
  const alerts: CoachingAlert[] = [];
  const lower = text.toLowerCase();
  const now = Date.now();

  for (const phrase of CONTAINMENT_PHRASES) {
    if (lower.includes(phrase)) {
      alerts.push({
        type: "containment",
        severity: "red",
        message: `Gatekeeper deflection: "${phrase}"`,
        suggestion: `REDIRECT NOW: "I understand — before I do, who typically handles [service area] decisions? I want to make sure the right person sees this."`,
        matchedPhrase: phrase,
        timestamp: now,
      });
      break;
    }
  }

  for (const pattern of NO_AUTHORITY_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      let capturedRole = "";
      for (const rp of ROLE_CAPTURE_PATTERNS) {
        const roleMatch = text.match(rp);
        if (roleMatch) {
          capturedRole = roleMatch[1].trim();
          break;
        }
      }
      alerts.push({
        type: "no_authority",
        severity: "amber",
        message: capturedRole
          ? `Wrong person — they mentioned: "${capturedRole}"`
          : `Wrong person detected — ask who handles this`,
        suggestion: capturedRole
          ? `CAPTURE: "${capturedRole}" — ask for their direct line or extension. Say: "Could you transfer me, or what's the best number to reach them?"`
          : `Ask: "Who would be the right person to discuss this with? I want to make sure I'm speaking with the decision maker."`,
        matchedPhrase: match[0],
        timestamp: now,
      });
      break;
    }
  }

  for (const phrase of AUTHORITY_REDIRECT_PHRASES) {
    if (lower.includes(phrase)) {
      let capturedRole = "";
      for (const rp of ROLE_CAPTURE_PATTERNS) {
        const roleMatch = text.match(rp);
        if (roleMatch) {
          capturedRole = roleMatch[1].trim();
          break;
        }
      }
      alerts.push({
        type: "authority",
        severity: "amber",
        message: capturedRole
          ? `Authority redirect — ask for "${capturedRole}"`
          : `Authority redirect detected — capture the name/role`,
        suggestion: capturedRole
          ? `Get their direct line: "What's the best number to reach the ${capturedRole}?"`
          : `Ask: "Who would that be? And what's the best number to reach them directly?"`,
        matchedPhrase: phrase,
        timestamp: now,
      });
      break;
    }
  }

  for (const pattern of FOLLOWUP_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const timeRef = match[1];
      alerts.push({
        type: "followup",
        severity: "blue",
        message: `Follow-up mentioned: "${timeRef}"`,
        suggestion: `Lock it in: "Perfect, I'll call you ${timeRef}. Is morning or afternoon better?" Then confirm the number.`,
        matchedPhrase: match[0],
        timestamp: now,
      });
      break;
    }
  }

  return alerts;
}

function pushToSSEClients(session: ActiveSession, event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of session.sseClients) {
    try {
      client.write(payload);
    } catch {
      session.sseClients.delete(client);
    }
  }
}

function createOpenAIConnection(session: ActiveSession, speaker: "agent" | "lead"): WebSocket {
  const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
  const ws = new WebSocket(url, {
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  ws.on("open", () => {
    log(`OpenAI Realtime connected for ${speaker} track (call ${session.callSid})`);
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["text"],
        input_audio_format: "g711_ulaw",
        input_audio_transcription: {
          model: "whisper-1",
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.4,
          prefix_padding_ms: 500,
          silence_duration_ms: 800,
        },
      },
    }));
  });

  ws.on("message", (data) => {
    try {
      const event = JSON.parse(data.toString());

      if (event.type === "conversation.item.input_audio_transcription.completed") {
        const text = event.transcript?.trim();
        if (text && text.length > 0) {
          const label = speaker === "agent" ? "You" : (session.contactName || "Them");
          const labeledText = `${label}: ${text}`;
          session.transcript.push(labeledText);
          pushToSSEClients(session, "transcript", {
            callSid: session.callSid,
            text: labeledText,
            speaker,
            timestamp: Date.now(),
            index: session.transcript.length - 1,
          });

          const alerts = detectAlerts(text, session.transcript);
          for (const alert of alerts) {
            session.alerts.push(alert);
            pushToSSEClients(session, "coaching_alert", {
              callSid: session.callSid,
              ...alert,
            });
            log(`ALERT [${alert.severity}] ${session.companyName}: ${alert.message}`);
          }
        }
      }

      if (event.type === "error") {
        log(`OpenAI error (${speaker}) for ${session.callSid}: ${JSON.stringify(event.error)}`);
      }
    } catch (e: any) {
      log(`OpenAI message parse error (${speaker}): ${e.message}`);
    }
  });

  ws.on("close", (code) => {
    log(`OpenAI Realtime disconnected (${speaker}) for ${session.callSid} (code: ${code})`);
    if (speaker === "inbound") session.openaiWsInbound = null;
    else session.openaiWsOutbound = null;
  });

  ws.on("error", (err) => {
    log(`OpenAI Realtime error (${speaker}) for ${session.callSid}: ${err.message}`);
  });

  return ws;
}

function connectToOpenAI(session: ActiveSession) {
  session.openaiWsInbound = createOpenAIConnection(session, "lead");
  session.openaiWsOutbound = createOpenAIConnection(session, "agent");
}

export function setupRealtimeCoaching(httpServer: HTTPServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/media-stream" });

  wss.on("connection", (ws, req) => {
    log(`Twilio Media Stream connected from ${req.socket.remoteAddress}`);
    let currentSession: ActiveSession | null = null;

    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.event) {
          case "connected":
            log("Twilio Media Stream: connected event received");
            break;

          case "start": {
            const callSid = msg.start?.callSid;
            const streamSid = msg.start?.streamSid;
            log(`Media Stream started: callSid=${callSid}, streamSid=${streamSid}`);

            const existing = activeSessions.get(callSid);
            if (existing) {
              existing.streamSid = streamSid;
              currentSession = existing;
            } else {
              currentSession = {
                callSid,
                streamSid,
                companyName: "",
                contactName: "",
                talkingPoints: [],
                transcript: [],
                alerts: [],
                openaiWsInbound: null,
                openaiWsOutbound: null,
                sseClients: new Set(),
                startedAt: Date.now(),
                lastTranscriptPush: 0,
                humanTakeoverAt: null,
              };
              activeSessions.set(callSid, currentSession);
            }

            connectToOpenAI(currentSession);
            break;
          }

          case "media": {
            const audioPayload = msg.media?.payload;
            const track = msg.media?.track;
            if (audioPayload && currentSession && !currentSession.humanTakeoverAt) {
              const targetWs = track === "outbound"
                ? currentSession.openaiWsOutbound
                : currentSession.openaiWsInbound;
              if (targetWs?.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: audioPayload,
                }));
              }
            }
            break;
          }

          case "stop": {
            log(`Media Stream stopped for call ${currentSession?.callSid}`);
            if (currentSession) {
              endSession(currentSession.callSid);
            }
            break;
          }
        }
      } catch (e: any) {
        log(`Media stream message error: ${e.message}`);
      }
    });

    ws.on("close", () => {
      log(`Twilio Media Stream WebSocket closed`);
      if (currentSession) {
        endSession(currentSession.callSid);
      }
    });

    ws.on("error", (err) => {
      log(`Twilio Media Stream error: ${err.message}`);
    });
  });

  log("Real-time coaching WebSocket server attached to /media-stream");
}

function endSession(callSid: string) {
  const session = activeSessions.get(callSid);
  if (!session) return;

  if (session.openaiWsInbound?.readyState === WebSocket.OPEN) {
    session.openaiWsInbound.close();
  }
  if (session.openaiWsOutbound?.readyState === WebSocket.OPEN) {
    session.openaiWsOutbound.close();
  }

  const fullTranscript = session.transcript.join("\n");
  const duration = Math.round((Date.now() - session.startedAt) / 1000);

  pushToSSEClients(session, "call_ended", {
    callSid,
    transcriptLength: fullTranscript.length,
    alertCount: session.alerts.length,
    duration,
  });

  for (const client of session.sseClients) {
    try { client.end(); } catch {}
  }

  log(`Session ended for ${callSid}: ${session.transcript.length} transcript chunks, ${session.alerts.length} alerts, ${duration}s`);

  if (fullTranscript.length > 20) {
    processPostCallTranscript(callSid, fullTranscript, session.companyName, session.alerts).catch(err => {
      log(`Post-call processing error: ${err.message}`);
    });
  }

  activeSessions.delete(callSid);
}

async function processPostCallTranscript(
  callSid: string,
  transcript: string,
  companyName: string,
  alerts: CoachingAlert[]
) {
  try {
    const { transcribeAudio, analyzeContainmentDeterministic, analyzeContainment, extractFollowupDate } = await import("./openai");
    const { detectNoAuthority, detectNoAuthorityFromAnalysis } = await import("./authority-detection");
    const { eventBus } = await import("./events");
    const { db } = await import("./db");
    const { twilioRecordings } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    log(`Post-call analysis starting for ${callSid} (${transcript.length} chars from live transcript)...`);

    const deterministicResult = analyzeContainmentDeterministic(transcript);
    const analysis = await analyzeContainment(transcript);
    const transcriptAuthority = detectNoAuthority(transcript);
    const analysisAuthority = detectNoAuthorityFromAnalysis(analysis);
    const authorityDetected = transcriptAuthority.detected || analysisAuthority.detected;
    const authorityResult = transcriptAuthority.detected ? transcriptAuthority : analysisAuthority;
    const followupExtraction = extractFollowupDate(transcript);

    const existing = await db.select()
      .from(twilioRecordings)
      .where(eq(twilioRecordings.callSid, callSid))
      .limit(1);

    if (existing.length > 0) {
      await db.update(twilioRecordings)
        .set({
          transcription: transcript,
          analysis,
          analysisJson: JSON.stringify(deterministicResult),
          problemDetected: deterministicResult.problem_detected || null,
          proposedPatchType: deterministicResult.proposed_patch_type || null,
          analysisConfidence: deterministicResult.confidence || null,
          noAuthority: authorityDetected,
          authorityReason: authorityResult.reason || null,
          suggestedRole: authorityResult.suggestedRole || null,
          followupDate: followupExtraction.detected ? followupExtraction.isoDate : null,
          followupSource: followupExtraction.rawPhrase || null,
          status: "analyzed_live",
          processedAt: new Date(),
        })
        .where(eq(twilioRecordings.callSid, callSid));
    }

    const clientId = existing[0]?.clientId || undefined;
    eventBus.publish("CALL_ANALYSIS_COMPLETE", {
      callId: callSid,
      source: "realtime_coaching",
      transcription: transcript.slice(0, 2000),
      analysis,
      problemDetected: deterministicResult.problem_detected || null,
      proposedPatchType: deterministicResult.proposed_patch_type || null,
      confidence: deterministicResult.confidence || null,
      noAuthority: authorityDetected,
      authorityReason: authorityResult.reason || null,
      suggestedRole: authorityResult.suggestedRole || null,
      extractedFollowupDate: followupExtraction.detected ? followupExtraction.isoDate : null,
      liveAlertCount: alerts.length,
      ts: Date.now(),
    }, clientId);

    log(`Post-call analysis complete for ${callSid}: authority=${authorityDetected ? "NO" : "ok"}, problem=${deterministicResult.problem_detected || "none"}, alerts during call: ${alerts.length}`);
  } catch (err: any) {
    log(`Post-call processing failed for ${callSid}: ${err.message}`);
  }
}

export function registerCoachingSession(callSid: string, companyName: string, contactName: string, talkingPoints: string[]) {
  let session = activeSessions.get(callSid);
  if (!session) {
    session = {
      callSid,
      streamSid: null,
      companyName,
      contactName,
      talkingPoints,
      transcript: [],
      alerts: [],
      openaiWsInbound: null,
      openaiWsOutbound: null,
      sseClients: new Set(),
      startedAt: Date.now(),
      lastTranscriptPush: 0,
      humanTakeoverAt: null,
    };
    activeSessions.set(callSid, session);
  } else {
    session.companyName = companyName;
    session.contactName = contactName;
    session.talkingPoints = talkingPoints;
  }
  log(`Coaching session registered: ${callSid} — ${companyName} (${talkingPoints.length} talking points)`);
  return session;
}

export function subscribeToCoaching(callSid: string, res: any): boolean {
  const session = activeSessions.get(callSid);
  if (!session) return false;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`event: session_info\ndata: ${JSON.stringify({
    callSid,
    companyName: session.companyName,
    contactName: session.contactName,
    talkingPoints: session.talkingPoints,
    startedAt: session.startedAt,
  })}\n\n`);

  for (const chunk of session.transcript) {
    res.write(`event: transcript\ndata: ${JSON.stringify({ callSid, text: chunk, timestamp: Date.now() })}\n\n`);
  }
  for (const alert of session.alerts) {
    res.write(`event: coaching_alert\ndata: ${JSON.stringify({ callSid, ...alert })}\n\n`);
  }

  session.sseClients.add(res);

  res.on("close", () => {
    session.sseClients.delete(res);
  });

  return true;
}

export function getActiveSession(callSid: string): ActiveSession | undefined {
  return activeSessions.get(callSid);
}

export function getActiveSessions(): { callSid: string; companyName: string; startedAt: number; transcriptLength: number; alertCount: number }[] {
  return Array.from(activeSessions.values()).map(s => ({
    callSid: s.callSid,
    companyName: s.companyName,
    startedAt: s.startedAt,
    transcriptLength: s.transcript.length,
    alertCount: s.alerts.length,
  }));
}

/**
 * AI Call Bot supervised mode: human intercept — stop AI from receiving/sending audio on this call.
 */
export function setHumanTakeoverActive(callSid: string): boolean {
  const session = activeSessions.get(callSid);
  if (!session) return false;
  const at = Date.now();
  session.humanTakeoverAt = at;
  if (session.openaiWsInbound?.readyState === WebSocket.OPEN) {
    try { session.openaiWsInbound.close(); } catch {}
  }
  if (session.openaiWsOutbound?.readyState === WebSocket.OPEN) {
    try { session.openaiWsOutbound.close(); } catch {}
  }
  session.openaiWsInbound = null;
  session.openaiWsOutbound = null;
  pushToSSEClients(session, "human_takeover", { callSid, agentInterceptedAt: at });
  log(`Human takeover active for ${callSid} at ${at}`);
  return true;
}
