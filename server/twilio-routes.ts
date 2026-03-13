import type { Express, Request, Response } from "express";
import { sendSms, initiateCall, getCallStatus, isTwilioConnected, listRecentCalls, listRecentMessages, downloadRecording, getRecordingsForCall } from "./twilio-service";
import { transcribeAudio, analyzeContainmentDeterministic, analyzeContainment, extractFollowupDate, analyzeLeadQuality } from "./openai";
import { detectNoAuthority, detectNoAuthorityFromAnalysis } from "./authority-detection";
import { eventBus } from "./events";
import { db } from "./db";
import { twilioRecordings, clients, companyFlows, actionQueue, inboundMessages, outreachPipeline } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { registerCoachingSession, subscribeToCoaching, getActiveSessions } from "./realtime-coaching";
import { validateToken } from "./auth";

const log = (msg: string) => {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [twilio-routes] ${msg}`);
};

function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}`;
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

    log(`Running lead quality analysis for ${recordingSid}...`);
    const leadQuality = await analyzeLeadQuality(transcription);

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
        followupDate: extractedFollowupDate,
        followupSource: followupExtraction.rawPhrase || null,
        leadQualityScore: leadQuality.score,
        leadQualityLabel: leadQuality.label,
        leadQualitySignals: JSON.stringify(leadQuality.signals),
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
      problemDetected: deterministicResult.problem_detected || null,
      proposedPatchType: deterministicResult.proposed_patch_type || null,
      confidence: deterministicResult.confidence || null,
      noAuthority: authorityDetected,
      authorityReason: authorityResult.reason || null,
      suggestedRole: authorityResult.suggestedRole || null,
      extractedFollowupDate,
      followupSource: followupExtraction.rawPhrase || null,
      leadQualityScore: leadQuality.score,
      leadQualityLabel: leadQuality.label,
      leadQualitySignals: leadQuality.signals,
      ts: Date.now(),
    }, clientId || undefined);

    try {
      const recData = await db.select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.recordingSid, recordingSid))
        .limit(1);
      const companyName = recData[0]?.companyName;

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
            if (extractedFollowupDate) {
              writebackFields.Next_Followup = extractedFollowupDate;
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
      if (rec?.companyName && rec?.clientId) {
        const aiNotes: string[] = [];
        const flowUpdates: Record<string, any> = { updatedAt: new Date() };

        if (extractedFollowupDate) {
          const fuDate = new Date(extractedFollowupDate);
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

        if (aiNotes.length > 0) {
          flowUpdates.notes = aiNotes.join(" | ");
        }

        const [activeFlow] = await db.select()
          .from(companyFlows)
          .where(and(
            eq(companyFlows.clientId, rec.clientId),
            eq(companyFlows.companyName, rec.companyName),
            eq(companyFlows.status, "active"),
          ))
          .orderBy(desc(companyFlows.updatedAt))
          .limit(1);

        if (activeFlow) {
          flowUpdates.verifiedQualityScore = leadQuality.score;
          flowUpdates.verifiedQualityLabel = leadQuality.label;
          flowUpdates.qualitySignals = JSON.stringify({
            buyingSignals: leadQuality.buyingSignals,
            objections: leadQuality.objections,
            signals: leadQuality.signals,
            nextStepReason: leadQuality.nextStepReason,
          });
          flowUpdates.transcriptSummary = leadQuality.summary;
          if (leadQuality.nextStepReason) {
            flowUpdates.nextAction = leadQuality.nextStepReason;
          }

          if (leadQuality.score <= 3) {
            const WARM_OUTCOMES = ["interested", "meeting_requested", "followup_scheduled", "replied", "live_answer"];
            if (activeFlow.lastOutcome && WARM_OUTCOMES.includes(activeFlow.lastOutcome)) {
              flowUpdates.lastOutcome = "not_qualified_by_transcript";
              flowUpdates.priority = Math.min(activeFlow.priority, 20);
              aiNotes.push(`Transcript override: outcome "${activeFlow.lastOutcome}" downgraded — lead scored ${leadQuality.score}/10 (${leadQuality.label})`);
              log(`TRANSCRIPT OVERRIDE: ${rec.companyName} was "${activeFlow.lastOutcome}" but transcript analysis scored ${leadQuality.score}/10 — downgrading`, "quality-check");
            }
          } else if (leadQuality.score <= 5 && activeFlow.lastOutcome === "live_answer") {
            aiNotes.push(`Transcript caution: live answer scored only ${leadQuality.score}/10 (${leadQuality.label}) — may not be a real opportunity`);
          }

          await db.update(companyFlows).set(flowUpdates).where(eq(companyFlows.id, activeFlow.id));

          if (extractedFollowupDate && flowUpdates.nextAction) {
            await db.update(actionQueue).set({
              taskType: flowUpdates.nextAction,
              dueAt: new Date(extractedFollowupDate),
            }).where(and(
              eq(actionQueue.flowId, activeFlow.id),
              eq(actionQueue.status, "pending"),
            ));
          }

          log(`Post-analysis flow update for ${rec.companyName}: quality=${leadQuality.score}/10 (${leadQuality.label}), ${aiNotes.join("; ")}`);
        }
      }
    } catch (flowErr: any) {
      log(`Post-analysis flow update failed (non-blocking): ${flowErr.message}`);
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

const activeCallMeta = new Map<string, {
  flowId: number | null;
  companyId: string | null;
  contactId: string | null;
  flowType: string | null;
  taskId: number | null;
  clientId: string | null;
}>();

const callStatusSSEClients = new Map<string, Set<Response>>();

function broadcastCallStatus(callSid: string, status: string, duration?: string) {
  const clients = callStatusSSEClients.get(callSid);
  if (!clients || clients.size === 0) return;
  const payload = `event: call_status\ndata: ${JSON.stringify({ callSid, status, duration: duration || null, ts: Date.now() })}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
  if (["completed", "failed", "busy", "no-answer", "canceled"].includes(status)) {
    for (const res of clients) {
      try { res.end(); } catch {}
    }
    callStatusSSEClients.delete(callSid);
  }
}

export function registerTwilioRoutes(app: Express, authMiddleware: any) {
  app.get("/api/twilio/status", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const connected = await isTwilioConnected();
      res.json({ connected, recordingEnabled: true });
    } catch (err: any) {
      res.json({ connected: false, error: err.message });
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
      const { to, companyName, contactName, talkingPoints, flowId, companyId, contactId, flowType, taskId } = req.body;
      if (!to) {
        return res.status(400).json({ error: "Phone number 'to' is required" });
      }

      const baseUrl = getBaseUrl(req);
      const statusCallbackUrl = `${baseUrl}/api/twilio/webhook/status`;
      const recordingCallbackUrl = `${baseUrl}/api/twilio/webhook/recording`;
      const clientId = (req as any).user?.clientId || null;

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

      const result = await initiateCall(to, statusCallbackUrl, recordingCallbackUrl, mediaStreamUrl);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      if (result.sid) {
        try {
          await db.insert(twilioRecordings).values({
            callSid: result.sid,
            recordingSid: `pending-${result.sid}`,
            clientId,
            toNumber: to,
            companyName: companyName || null,
            contactName: contactName || null,
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

        if (coachingActive) {
          registerCoachingSession(
            result.sid,
            companyName || "",
            contactName || "",
            Array.isArray(talkingPoints) ? talkingPoints : []
          );
        }
      }

      log(`Call initiated by user to ${to} (recording: yes, coaching: ${coachingActive ? "yes" : "off"}, SID: ${result.sid}, flow: ${flowId || "none"}, company: ${companyId || "none"})`);
      res.json({ ok: true, sid: result.sid, recordingEnabled: true, coachingEnabled: coachingActive });
    } catch (err: any) {
      log(`Call route error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/call-session/:sid", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { sid } = req.params;
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

  app.post("/api/twilio/webhook/status", async (req: Request, res: Response) => {
    try {
      const { CallSid, CallStatus, CallDuration } = req.body;
      if (!CallSid || !CallStatus) {
        return res.status(200).send("<Response></Response>");
      }

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

      broadcastCallStatus(CallSid, mapped, CallDuration);

      if (["completed", "failed", "busy", "no-answer", "canceled"].includes(mapped)) {
        activeCallMeta.delete(CallSid);
      }

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

    const { sid } = req.params;

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

  app.get("/api/twilio/recording-by-company/:companyName", authMiddleware, async (req: Request, res: Response) => {
    try {
      const companyName = req.params.companyName;
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

  app.post("/api/twilio/webhook/recording", async (req: Request, res: Response) => {
    try {
      const {
        RecordingSid,
        RecordingUrl,
        RecordingStatus,
        RecordingDuration,
        CallSid,
        AccountSid,
      } = req.body;

      log(`Recording webhook: SID=${RecordingSid}, Status=${RecordingStatus}, Duration=${RecordingDuration}s, Call=${CallSid}`);

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

      const existing = await db.select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.callSid, CallSid))
        .limit(1);

      let clientId: string | undefined;

      if (existing.length > 0) {
        clientId = existing[0].clientId || undefined;
        await db.update(twilioRecordings)
          .set({
            recordingSid: RecordingSid,
            duration,
            status: "recording_ready",
          })
          .where(eq(twilioRecordings.callSid, CallSid));
      } else {
        await db.insert(twilioRecordings).values({
          callSid: CallSid,
          recordingSid: RecordingSid,
          duration,
          status: "recording_ready",
        });
      }

      res.status(200).send("<Response></Response>");

      activeCallMeta.delete(CallSid);

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
      const id = parseInt(req.params.id, 10);
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

  app.get("/api/twilio/recording-by-callsid/:callSid", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { callSid } = req.params;
      if (!callSid) return res.json(null);
      const clientId = (req as any).user?.clientId;

      const [recording] = await db.select()
        .from(twilioRecordings)
        .where(eq(twilioRecordings.callSid, callSid))
        .orderBy(desc(twilioRecordings.createdAt))
        .limit(1);

      if (!recording) return res.json(null);
      if (clientId && recording.clientId && recording.clientId !== clientId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      let updatedFlowAction: string | null = null;
      let updatedFlowNotes: string | null = null;
      let updatedFlowDueAt: string | null = null;

      if (recording.processedAt && recording.companyName && recording.clientId) {
        const [flow] = await db.select()
          .from(companyFlows)
          .where(and(
            eq(companyFlows.clientId, recording.clientId),
            eq(companyFlows.companyName, recording.companyName),
          ))
          .orderBy(desc(companyFlows.updatedAt))
          .limit(1);
        if (flow) {
          updatedFlowAction = flow.nextAction;
          updatedFlowNotes = flow.notes;
          updatedFlowDueAt = flow.callbackAt ? flow.callbackAt.toISOString() : null;
        }
      }

      res.json({
        id: recording.id,
        callSid: recording.callSid,
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
        updatedFlowAction,
        updatedFlowNotes,
        updatedFlowDueAt,
      });
    } catch (err: any) {
      log(`Recording by callSid error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/call/:sid", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { sid } = req.params;
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

      const agentPhone = process.env.AGENT_PHONE || "+14093387109";

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
      const agentPhone = process.env.AGENT_PHONE || "+14093387109";
      res.type("text/xml").send(`<Response><Dial>${agentPhone}</Dial></Response>`);
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
      const id = parseInt(req.params.id);
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
    const { callSid } = req.params;
    const subscribed = subscribeToCoaching(callSid, res);
    if (!subscribed) {
      res.status(404).json({ error: "No active coaching session for this call" });
    }
  });

  app.get("/api/twilio/coaching-sessions", authMiddleware, (_req: Request, res: Response) => {
    res.json(getActiveSessions());
  });

  log("Twilio routes registered (with recording intelligence pipeline + live coaching)");
}
