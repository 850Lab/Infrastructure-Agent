/**
 * AI Call Bot sandbox — isolated test contacts & dials (no production pipeline).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  aiCallBotSandboxContacts,
  aiCallBotSandboxRuns,
  clients,
  twilioRecordings,
} from "@shared/schema";
import { log } from "../logger";
import { registerCoachingSession } from "../realtime-coaching";
import { createSession, transitionSession } from "./transfer-controller";
import { validateSandboxTestDial } from "./sandbox-dial-guard";
import {
  SANDBOX_SCENARIO_TYPES,
  isSandboxScenarioType,
  sandboxSessionCompanyId,
  sandboxSessionContactKey,
} from "./sandbox-types";
import { initiateCall, normalizePhone } from "../twilio-service";
import { verifyAiCallBotSessionRow } from "./session-verify";

const TAG = "ai-call-bot-sandbox";

function cid(req: Request): string | null {
  return (req as any).user?.clientId || null;
}

function getBaseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || (req.secure ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

const contactCreateSchema = z.object({
  fullName: z.string().min(1),
  phoneE164: z.string().min(10),
  companyName: z.string().min(2),
  titleOrRole: z.string().optional(),
  relationshipTag: z.string().min(1),
  testScenarioType: z.string().refine((s): s is typeof SANDBOX_SCENARIO_TYPES[number] => isSandboxScenarioType(s)),
  sandboxReadyCall: z.boolean().optional().default(true),
  outreachReason: z.string().min(3),
  notes: z.string().optional(),
  consentConfirmed: z.boolean().refine((v) => v === true, {
    message: "consent_confirmed must be true to create a dialable sandbox contact",
  }),
  active: z.boolean().optional().default(true),
  supervisedModeRequired: z.boolean().optional().default(true),
  preferredOpeningStyle: z.string().optional(),
  expectedBehavior: z.string().optional(),
  expectedOutcome: z.string().optional(),
  scenarioDifficulty: z.string().optional(),
  referralName: z.string().optional(),
  callbackPreference: z.string().optional(),
});

const contactUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  phoneE164: z.string().min(10).optional(),
  companyName: z.string().min(2).optional(),
  titleOrRole: z.string().optional(),
  relationshipTag: z.string().min(1).optional(),
  testScenarioType: z
    .string()
    .optional()
    .refine((s) => s === undefined || isSandboxScenarioType(s), "invalid test_scenario_type"),
  sandboxReadyCall: z.boolean().optional(),
  outreachReason: z.string().min(3).optional(),
  notes: z.string().optional(),
  consentConfirmed: z.boolean().optional(),
  active: z.boolean().optional(),
  supervisedModeRequired: z.boolean().optional(),
  preferredOpeningStyle: z.string().optional(),
  expectedBehavior: z.string().optional(),
  expectedOutcome: z.string().optional(),
  scenarioDifficulty: z.string().optional(),
  referralName: z.string().optional(),
  callbackPreference: z.string().optional(),
});

export function registerAiCallBotSandboxRoutes(app: Express, authMw: any) {
  app.post("/api/ai-call-bot/sandbox/contacts", authMw, async (req: Request, res: Response) => {
    try {
      const client = cid(req);
      if (!client) return res.status(400).json({ error: "No client context" });
      const body = contactCreateSchema.parse(req.body);
      const normalized = normalizePhone(body.phoneE164.trim());
      if (!normalized) return res.status(400).json({ error: "Invalid phone_e164" });
      if (body.supervisedModeRequired === false) {
        return res.status(400).json({ error: "supervised_mode_required must remain true for sandbox" });
      }
      const [row] = await db
        .insert(aiCallBotSandboxContacts)
        .values({
          clientId: client,
          fullName: body.fullName.trim(),
          phoneE164: normalized,
          companyName: body.companyName.trim(),
          titleOrRole: body.titleOrRole?.trim() || null,
          relationshipTag: body.relationshipTag.trim(),
          testScenarioType: body.testScenarioType,
          sandboxReadyCall: body.sandboxReadyCall ?? true,
          outreachReason: body.outreachReason.trim(),
          notes: body.notes?.trim() || null,
          consentConfirmed: true,
          active: body.active ?? true,
          supervisedModeRequired: true,
          preferredOpeningStyle: body.preferredOpeningStyle?.trim() || null,
          expectedBehavior: body.expectedBehavior?.trim() || null,
          expectedOutcome: body.expectedOutcome?.trim() || null,
          scenarioDifficulty: body.scenarioDifficulty?.trim() || null,
          referralName: body.referralName?.trim() || null,
          callbackPreference: body.callbackPreference?.trim() || null,
        })
        .returning();
      res.status(201).json({ contact: row });
    } catch (e: unknown) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      const msg = e instanceof Error ? e.message : String(e);
      log(`sandbox create contact: ${msg}`, TAG);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/ai-call-bot/sandbox/contacts", authMw, async (req: Request, res: Response) => {
    try {
      const client = cid(req);
      if (!client) return res.status(400).json({ error: "No client context" });
      const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";
      const rows = await db
        .select()
        .from(aiCallBotSandboxContacts)
        .where(
          includeArchived
            ? eq(aiCallBotSandboxContacts.clientId, client)
            : and(
                eq(aiCallBotSandboxContacts.clientId, client),
                eq(aiCallBotSandboxContacts.active, true),
                isNull(aiCallBotSandboxContacts.archivedAt)
              )
        )
        .orderBy(desc(aiCallBotSandboxContacts.updatedAt));
      res.json({ contacts: rows });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/ai-call-bot/sandbox/contacts/:id", authMw, async (req: Request, res: Response) => {
    try {
      const client = cid(req);
      if (!client) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [row] = await db
        .select()
        .from(aiCallBotSandboxContacts)
        .where(and(eq(aiCallBotSandboxContacts.id, id), eq(aiCallBotSandboxContacts.clientId, client)))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ contact: row });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/ai-call-bot/sandbox/contacts/:id", authMw, async (req: Request, res: Response) => {
    try {
      const client = cid(req);
      if (!client) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const body = contactUpdateSchema.parse(req.body);
      const [existing] = await db
        .select()
        .from(aiCallBotSandboxContacts)
        .where(and(eq(aiCallBotSandboxContacts.id, id), eq(aiCallBotSandboxContacts.clientId, client)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (body.supervisedModeRequired === false) {
        return res.status(400).json({ error: "supervised_mode_required cannot be disabled in sandbox" });
      }
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.fullName != null) updates.fullName = body.fullName.trim();
      if (body.phoneE164 != null) {
        const n = normalizePhone(body.phoneE164.trim());
        if (!n) return res.status(400).json({ error: "Invalid phone_e164" });
        updates.phoneE164 = n;
      }
      if (body.companyName != null) updates.companyName = body.companyName.trim();
      if (body.titleOrRole !== undefined) updates.titleOrRole = body.titleOrRole?.trim() || null;
      if (body.relationshipTag != null) updates.relationshipTag = body.relationshipTag.trim();
      if (body.testScenarioType != null) {
        if (!isSandboxScenarioType(body.testScenarioType)) return res.status(400).json({ error: "Invalid test_scenario_type" });
        updates.testScenarioType = body.testScenarioType;
      }
      if (body.sandboxReadyCall != null) updates.sandboxReadyCall = body.sandboxReadyCall;
      if (body.outreachReason != null) updates.outreachReason = body.outreachReason.trim();
      if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
      if (body.consentConfirmed != null) updates.consentConfirmed = body.consentConfirmed;
      if (body.active != null) updates.active = body.active;
      if (body.preferredOpeningStyle !== undefined) updates.preferredOpeningStyle = body.preferredOpeningStyle?.trim() || null;
      if (body.expectedBehavior !== undefined) updates.expectedBehavior = body.expectedBehavior?.trim() || null;
      if (body.expectedOutcome !== undefined) updates.expectedOutcome = body.expectedOutcome?.trim() || null;
      if (body.scenarioDifficulty !== undefined) updates.scenarioDifficulty = body.scenarioDifficulty?.trim() || null;
      if (body.referralName !== undefined) updates.referralName = body.referralName?.trim() || null;
      if (body.callbackPreference !== undefined) updates.callbackPreference = body.callbackPreference?.trim() || null;

      const [row] = await db
        .update(aiCallBotSandboxContacts)
        .set(updates as any)
        .where(and(eq(aiCallBotSandboxContacts.id, id), eq(aiCallBotSandboxContacts.clientId, client)))
        .returning();
      res.json({ contact: row });
    } catch (e: unknown) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/ai-call-bot/sandbox/contacts/:id/archive", authMw, async (req: Request, res: Response) => {
    try {
      const client = cid(req);
      if (!client) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const now = new Date();
      const [row] = await db
        .update(aiCallBotSandboxContacts)
        .set({ active: false, archivedAt: now, updatedAt: now })
        .where(and(eq(aiCallBotSandboxContacts.id, id), eq(aiCallBotSandboxContacts.clientId, client)))
        .returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true, contact: row });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/ai-call-bot/sandbox/calls", authMw, async (req: Request, res: Response) => {
    try {
      const client = cid(req);
      if (!client) return res.status(400).json({ error: "No client context" });
      log(`sandbox/calls: request clientId=${client}`, TAG);

      const { sandboxContactId } = z.object({ sandboxContactId: z.number().int().positive() }).parse(req.body);

      const guard = await validateSandboxTestDial({ clientId: client, sandboxContactId });
      if (!guard.allowed || !guard.contact || !guard.normalizedPhone) {
        log(`sandbox/calls: dial guard rejected reason=${guard.reason}`, TAG);
        return res.status(403).json({
          error: guard.message || "Sandbox dial not allowed",
          reason: guard.reason,
        });
      }
      const contact = guard.contact;
      log(`sandbox/calls: contact validated id=${contact.id} phone=${guard.normalizedPhone}`, TAG);

      const baseUrl = getBaseUrl(req);
      const statusCallbackUrl = `${baseUrl}/api/twilio/webhook/status`;
      const recordingCallbackUrl = `${baseUrl}/api/twilio/webhook/recording`;

      let coachingActive = false;
      const [clientRecord] = await db
        .select({ coachingEnabled: clients.coachingEnabled })
        .from(clients)
        .where(eq(clients.id, client))
        .limit(1);
      coachingActive = clientRecord?.coachingEnabled ?? true;
      log(`sandbox/calls: coachingActive=${coachingActive} baseUrl=${baseUrl}`, TAG);

      let mediaStreamUrl: string | undefined;
      if (coachingActive) {
        const wsProtocol = baseUrl.startsWith("https") ? "wss" : "ws";
        const host = baseUrl.replace(/^https?:\/\//, "");
        mediaStreamUrl = `${wsProtocol}://${host}/media-stream`;
      } else {
        log(`sandbox/calls: WARNING client coaching disabled — Twilio call will have no <Stream>; AI layer cannot join`, TAG);
      }

      const talkingPoints = [
        `[SANDBOX] ${contact.testScenarioType}`,
        contact.outreachReason,
        ...(contact.expectedBehavior ? [`Expected: ${contact.expectedBehavior}`] : []),
        ...(contact.notes ? [`Notes: ${contact.notes}`] : []),
      ];

      const result = await initiateCall(guard.normalizedPhone, statusCallbackUrl, recordingCallbackUrl, mediaStreamUrl);
      log(`sandbox/calls: Twilio initiateCall success=${result.success} sid=${result.sid ?? "n/a"} err=${result.error ?? "n/a"}`, TAG);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      const companyId = sandboxSessionCompanyId(client, contact.id);
      const contactKey = sandboxSessionContactKey(contact.id);

      let sessionId: number | undefined;
      let runId: number | undefined;
      let coachingRegistered = false;

      if (result.sid) {
        /** Register coaching map entry immediately so Media Stream "start" never races ahead of HTTP handler. */
        if (coachingActive) {
          registerCoachingSession(
            result.sid,
            `[SANDBOX] ${contact.companyName}`,
            contact.fullName,
            talkingPoints,
            { aiCallBotClientId: client }
          );
          coachingRegistered = true;
          log(`sandbox/calls: registerCoachingSession (pre-DB) callSid=${result.sid}`, TAG);
        }

        try {
          await db.insert(twilioRecordings).values({
            callSid: result.sid,
            recordingSid: `pending-${result.sid}`,
            clientId: client,
            toNumber: guard.normalizedPhone,
            companyName: `[SANDBOX] ${contact.companyName}`,
            contactName: contact.fullName,
            status: "call_initiated",
            isSandboxCall: true,
          });
          log(`sandbox/calls: twilioRecordings inserted callSid=${result.sid}`, TAG);
        } catch (e: unknown) {
          log(`sandbox recording insert: ${e instanceof Error ? e.message : e}`, TAG);
        }

        try {
          const sessionRow = await createSession({
            clientId: client,
            companyId,
            contactId: contactKey,
            flowId: null,
            callSid: result.sid,
            outreachReason: contact.outreachReason,
            isSandboxSession: true,
            sandboxContactId: contact.id,
          });
          await transitionSession(sessionRow.id, client, "dial_started");
          sessionId = sessionRow.id;
          log(`sandbox/calls: ai_call_bot_session created id=${sessionId} callSid=${result.sid}`, TAG);

          if (coachingActive) {
            registerCoachingSession(
              result.sid,
              `[SANDBOX] ${contact.companyName}`,
              contact.fullName,
              talkingPoints,
              { aiCallBotSessionId: sessionId, aiCallBotClientId: client }
            );
            log(`sandbox/calls: registerCoachingSession merged aiCallBotSessionId=${sessionId}`, TAG);
          }
        } catch (e: unknown) {
          log(`sandbox session create: ${e instanceof Error ? e.message : e}`, TAG);
        }

        const [run] = await db
          .insert(aiCallBotSandboxRuns)
          .values({
            clientId: client,
            sandboxContactId: contact.id,
            sessionId: sessionId ?? null,
            callSid: result.sid,
            intendedScenarioType: contact.testScenarioType,
          })
          .returning();
        runId = run?.id;
        log(`sandbox/calls: sandbox_run id=${runId ?? "n/a"}`, TAG);
      }

      res.json({
        ok: true,
        sid: result.sid,
        sandboxContactId: contact.id,
        aiCallBotSessionId: sessionId,
        sandboxRunId: runId,
        coachingEnabled: coachingActive,
        mediaStreamInTwiml: !!mediaStreamUrl,
        coachingSessionRegistered: coachingRegistered,
      });
    } catch (e: unknown) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      const msg = e instanceof Error ? e.message : String(e);
      log(`sandbox call: ${msg}`, TAG);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/ai-call-bot/sandbox/runs", authMw, async (req: Request, res: Response) => {
    try {
      const client = cid(req);
      if (!client) return res.status(400).json({ error: "No client context" });
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "30"), 10) || 30));
      const runs = await db
        .select()
        .from(aiCallBotSandboxRuns)
        .where(eq(aiCallBotSandboxRuns.clientId, client))
        .orderBy(desc(aiCallBotSandboxRuns.createdAt))
        .limit(limit);

      const enriched = await Promise.all(
        runs.map(async (run) => {
          const [c] = await db
            .select()
            .from(aiCallBotSandboxContacts)
            .where(eq(aiCallBotSandboxContacts.id, run.sandboxContactId))
            .limit(1);
          let sessionSummary: Record<string, unknown> | null = null;
          if (run.sessionId) {
            const { getSessionById } = await import("./transfer-controller");
            const s = await getSessionById(run.sessionId, client);
            if (s) {
              const verify = verifyAiCallBotSessionRow(s);
              sessionSummary = {
                currentState: s.currentState,
                callOutcome: s.callOutcome,
                transferStatus: s.transferStatus,
                fallbackCaptureUsed: s.fallbackCaptureUsed,
                sessionFallbackFsmCount: s.sessionFallbackFsmCount,
                fsmRejectedTransitionCount: s.fsmRejectedTransitionCount,
                supervisorAttentionRequired: s.supervisorAttentionRequired,
                terminalFieldGaps: verify.terminalFieldGaps,
              };
            }
          }
          return { run, contact: c ?? null, sessionSummary };
        })
      );

      res.json({ runs: enriched });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/ai-call-bot/sandbox/runs/:id", authMw, async (req: Request, res: Response) => {
    try {
      const client = cid(req);
      if (!client) return res.status(400).json({ error: "No client context" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const body = z
        .object({
          operatorNotes: z.string().max(8000).optional(),
          testPassed: z.boolean().optional(),
          issuesExposed: z.string().max(8000).optional(),
        })
        .parse(req.body);

      const [row] = await db
        .update(aiCallBotSandboxRuns)
        .set({
          ...body,
          updatedAt: new Date(),
        } as any)
        .where(and(eq(aiCallBotSandboxRuns.id, id), eq(aiCallBotSandboxRuns.clientId, client)))
        .returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ run: row });
    } catch (e: unknown) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/ai-call-bot/sandbox/import", authMw, async (req: Request, res: Response) => {
    try {
      const client = cid(req);
      if (!client) return res.status(400).json({ error: "No client context" });
      const body = z
        .object({
          contacts: z.array(contactCreateSchema).min(1).max(50),
        })
        .parse(req.body);

      const created: (typeof aiCallBotSandboxContacts.$inferSelect)[] = [];
      for (const c of body.contacts) {
        if (!c.consentConfirmed) {
          return res.status(400).json({ error: "Each imported contact must have consent_confirmed: true" });
        }
        const normalized = normalizePhone(c.phoneE164.trim());
        if (!normalized) {
          return res.status(400).json({ error: `Invalid phone for ${c.fullName}` });
        }
        const [row] = await db
          .insert(aiCallBotSandboxContacts)
          .values({
            clientId: client,
            fullName: c.fullName.trim(),
            phoneE164: normalized,
            companyName: c.companyName.trim(),
            titleOrRole: c.titleOrRole?.trim() || null,
            relationshipTag: c.relationshipTag.trim(),
            testScenarioType: c.testScenarioType,
            sandboxReadyCall: c.sandboxReadyCall ?? true,
            outreachReason: c.outreachReason.trim(),
            notes: c.notes?.trim() || null,
            consentConfirmed: true,
            active: c.active ?? true,
            supervisedModeRequired: true,
            preferredOpeningStyle: c.preferredOpeningStyle?.trim() || null,
            expectedBehavior: c.expectedBehavior?.trim() || null,
            expectedOutcome: c.expectedOutcome?.trim() || null,
            scenarioDifficulty: c.scenarioDifficulty?.trim() || null,
            referralName: c.referralName?.trim() || null,
            callbackPreference: c.callbackPreference?.trim() || null,
          })
          .returning();
        if (row) created.push(row);
      }
      res.status(201).json({ ok: true, count: created.length, contacts: created });
    } catch (e: unknown) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: e.flatten() });
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  log("AI Call Bot sandbox routes registered", TAG);
}
