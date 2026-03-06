import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { webhookPayloadSchema } from "@shared/schema";
import { fetchAirtableRecord, extractAudioAttachment, downloadAudio, updateAirtableRecord } from "./airtable";
import { transcribeAudio, analyzeContainment, analyzeContainmentDeterministic } from "./openai";
import { registerMakeRoutes } from "./make-routes";
import { registerActiveWorkRoutes } from "./active-work-routes";
import { registerForemanRoutes } from "./foreman-routes";
import { registerDMRoutes } from "./dm-routes";
import { registerOutscraperRoutes } from "./outscraper-routes";
import { registerLeadFeedRoutes } from "./lead-feed-routes";
import { registerDashboardRoutes } from "./dashboard-routes";
import { registerAdminRoutes } from "./admin-routes";
import { seedAllCampaigns } from "./seed-client";
import { registerTodayRoutes } from "./today-routes";
import { registerOpportunityRoutes } from "./opportunities";
import { registerSalesLearningRoutes } from "./sales-learning/sales-learning-routes";
import { registerEmailRoutes } from "./email-routes";
import { log } from "./index";

async function handleWebhook(req: Request, res: Response) {
  const startTime = Date.now();

  const parsed = webhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: parsed.error.flatten(),
    });
  }

  const { recordId } = parsed.data;
  log(`Webhook received for record: ${recordId}`, "webhook");

  const logEntry = await storage.createWebhookLog({
    airtableRecordId: recordId,
    status: "processing",
  });

  res.status(202).json({
    message: "Processing started",
    logId: logEntry.id,
    recordId,
  });

  try {
    const record = await fetchAirtableRecord(recordId);
    log(`Fetched record: ${JSON.stringify(Object.keys(record.fields))}`, "webhook");

    const attachment = extractAudioAttachment(record);
    if (!attachment) {
      throw new Error("No audio attachment found in record");
    }

    await storage.updateWebhookLog(logEntry.id, {
      audioFileName: attachment.filename,
      status: "downloading",
    });

    const audioBuffer = await downloadAudio(attachment.url);
    log(`Downloaded audio: ${attachment.filename} (${audioBuffer.length} bytes)`, "webhook");

    await storage.updateWebhookLog(logEntry.id, { status: "transcribing" });
    const transcription = await transcribeAudio(audioBuffer, attachment.filename);

    await storage.updateWebhookLog(logEntry.id, {
      status: "analyzing",
      transcription,
    });
    const analysis = await analyzeContainment(transcription);
    const deterministicResult = analyzeContainmentDeterministic(transcription);

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

    await updateAirtableRecord(recordId, writebackFields);

    const processingTimeMs = Date.now() - startTime;
    await storage.updateWebhookLog(logEntry.id, {
      status: "completed",
      transcription,
      analysis,
      processingTimeMs,
    });

    log(`Completed processing record ${recordId} in ${processingTimeMs}ms`, "webhook");
  } catch (error: any) {
    const processingTimeMs = Date.now() - startTime;
    log(`Error processing record ${recordId}: ${error.message}`, "webhook");

    await storage.updateWebhookLog(logEntry.id, {
      status: "error",
      errorMessage: error.message,
      processingTimeMs,
    });
  }
}

function handleHealth(_req: Request, res: Response) {
  res.status(200).json({
    ok: true,
    status: "ok",
    timestamp: new Date().toISOString(),
    airtable: !!(process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID),
    openai: !!(process.env.OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
    make: !!(process.env.MAKE_API_TOKEN),
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/airtable-webhook", handleWebhook);
  app.post("/airtable-webhook", handleWebhook);

  app.get("/api/health", handleHealth);
  app.get("/health", handleHealth);

  registerMakeRoutes(app);
  registerActiveWorkRoutes(app);
  registerForemanRoutes(app);
  registerDMRoutes(app);
  registerOutscraperRoutes(app);
  registerLeadFeedRoutes(app);
  await registerDashboardRoutes(app);
  await registerAdminRoutes(app);
  await seedAllCampaigns().catch((e: any) => log(`Seed error: ${e.message}`, "seed"));
  registerTodayRoutes(app);
  registerOpportunityRoutes(app);
  registerSalesLearningRoutes(app);
  registerEmailRoutes(app);

  app.get("/api/webhook-logs", async (_req, res) => {
    const logs = await storage.getWebhookLogs(100);
    res.json(logs);
  });

  app.get("/api/webhook-logs/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid log ID" });
    }
    const logEntry = await storage.getWebhookLog(id);
    if (!logEntry) {
      return res.status(404).json({ error: "Log not found" });
    }
    res.json(logEntry);
  });

  app.post("/api/test-webhook", async (req, res) => {
    const { recordId } = req.body;
    if (!recordId) {
      return res.status(400).json({ error: "recordId is required" });
    }

    try {
      const response = await fetch(`http://localhost:${process.env.PORT || 5000}/api/airtable-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId }),
      });
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
