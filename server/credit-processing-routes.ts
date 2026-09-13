import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware } from "./auth";
import { db } from "./db";
import { sensitiveNoStore } from "./security-middleware";
import { creditAuditEvents, creditCases } from "@shared/schema";

const syntheticCaseSchema = z.object({
  label: z.string().trim().min(1).max(80),
  mode: z.literal("synthetic"),
});

function featureEnabled(): boolean {
  return process.env.CREDIT_PROCESSING_ENABLED === "true";
}

function getClientId(req: Request): string | null {
  return (req as any).user?.clientId || null;
}

function requireCreditFeature(_req: Request, res: Response, next: () => void): void {
  if (!featureEnabled()) {
    res.status(503).json({
      error: "Credit processing is locked until its database migration and security review are complete.",
    });
    return;
  }
  next();
}

export function registerCreditProcessingRoutes(app: Express): void {
  app.get("/api/credit/status", authMiddleware, sensitiveNoStore, (_req: Request, res: Response) => {
    res.json({
      foundationReady: true,
      enabled: featureEnabled(),
      mode: "synthetic_only",
      realUploadsEnabled: false,
      storageConnected: false,
      aiDocumentProcessingEnabled: false,
    });
  });

  app.get(
    "/api/credit/cases",
    authMiddleware,
    sensitiveNoStore,
    requireCreditFeature,
    async (req: Request, res: Response) => {
      const clientId = getClientId(req);
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const cases = await db
        .select()
        .from(creditCases)
        .where(and(eq(creditCases.clientId, clientId), eq(creditCases.mode, "synthetic")))
        .orderBy(desc(creditCases.createdAt))
        .limit(100);

      res.json({ cases });
    },
  );

  app.post(
    "/api/credit/cases",
    authMiddleware,
    sensitiveNoStore,
    requireCreditFeature,
    async (req: Request, res: Response) => {
      const clientId = getClientId(req);
      const actorEmail = (req as any).user?.email || "unknown";
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const parsed = syntheticCaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Only labeled synthetic test cases are allowed." });
      }

      const [created] = await db
        .insert(creditCases)
        .values({ clientId, label: parsed.data.label, mode: "synthetic", createdByEmail: actorEmail })
        .returning();

      await db.insert(creditAuditEvents).values({
        clientId,
        caseId: created.id,
        actorEmail,
        action: "synthetic_case_created",
      });

      res.status(201).json({ case: created });
    },
  );

  // Intentionally locked. This endpoint must not accept bytes until encrypted
  // object storage, retention, scanning, and access controls are configured.
  app.post(
    "/api/credit/documents/upload",
    authMiddleware,
    sensitiveNoStore,
    (_req: Request, res: Response) => {
      res.status(503).json({
        error: "Real document uploads are not enabled.",
        required: ["private_object_storage", "malware_scan", "retention_policy", "security_review"],
      });
    },
  );
}
