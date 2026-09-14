import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware } from "./auth";
import { db } from "./db";
import { sensitiveNoStore } from "./security-middleware";
import { creditAuditEvents, creditCases, creditDocuments } from "@shared/schema";
import {
  areCreditUploadsEnabled,
  createCreditUploadUrl,
  isCreditStorageConfigured,
  makeCreditStorageKey,
  verifyCreditUpload,
} from "./credit-object-storage";

const documentTypes = ["transunion", "experian", "equifax", "government_id", "proof_of_address"] as const;
const allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png"] as const;
const CREDIT_REPORT_MAX_BYTES = 75 * 1024 * 1024;
const IDENTITY_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

function maximumBytesFor(documentType: (typeof documentTypes)[number]): number {
  return documentType === "government_id" || documentType === "proof_of_address"
    ? IDENTITY_DOCUMENT_MAX_BYTES
    : CREDIT_REPORT_MAX_BYTES;
}

const uploadIntentSchema = z.object({
  caseId: z.string().uuid(),
  documentType: z.enum(documentTypes),
  contentType: z.enum(allowedMimeTypes),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/),
}).superRefine((value, context) => {
  if (value.sizeBytes > maximumBytesFor(value.documentType)) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      type: "number",
      maximum: maximumBytesFor(value.documentType),
      inclusive: true,
      message: value.documentType === "government_id" || value.documentType === "proof_of_address"
        ? "ID and proof-of-address files must be 20 MB or smaller"
        : "Credit report files must be 75 MB or smaller",
      path: ["sizeBytes"],
    });
  }
});

const completeUploadSchema = z.object({
  documentId: z.string().uuid(),
});

const syntheticCaseSchema = z.object({
  label: z.string().trim().min(1).max(80),
  mode: z.literal("synthetic"),
});

function featureEnabled(): boolean {
  return process.env.CREDIT_PROCESSING_ENABLED === "true";
}

function uploadFoundationReady(): boolean {
  return featureEnabled() && isCreditStorageConfigured() && areCreditUploadsEnabled();
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
      storageConnected: isCreditStorageConfigured(),
      storageUploadsEnabled: areCreditUploadsEnabled(),
      uploadFoundationReady: uploadFoundationReady(),
      uploadLinkLifetimeSeconds: 300,
      maximumCreditReportBytes: CREDIT_REPORT_MAX_BYTES,
      maximumIdentityDocumentBytes: IDENTITY_DOCUMENT_MAX_BYTES,
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
    "/api/credit/documents/upload-intent",
    authMiddleware,
    sensitiveNoStore,
    requireCreditFeature,
    async (req: Request, res: Response) => {
      if (!isCreditStorageConfigured() || !areCreditUploadsEnabled()) {
        return res.status(503).json({ error: "Secure object storage uploads are locked." });
      }

      const clientId = getClientId(req);
      const actorEmail = (req as any).user?.email || "unknown";
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const parsed = uploadIntentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid upload request. Credit reports may be up to 75 MB; ID and address proof may be up to 20 MB.",
        });
      }

      const [creditCase] = await db
        .select({ id: creditCases.id })
        .from(creditCases)
        .where(and(
          eq(creditCases.id, parsed.data.caseId),
          eq(creditCases.clientId, clientId),
          eq(creditCases.mode, "synthetic"),
        ))
        .limit(1);
      if (!creditCase) return res.status(404).json({ error: "Synthetic test case not found" });

      const storageKey = makeCreditStorageKey({
        clientId,
        caseId: parsed.data.caseId,
        documentType: parsed.data.documentType,
      });
      const retentionUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const [document] = await db
        .insert(creditDocuments)
        .values({
          clientId,
          caseId: parsed.data.caseId,
          documentType: parsed.data.documentType,
          storageKey,
          mimeType: parsed.data.contentType,
          sizeBytes: parsed.data.sizeBytes,
          sha256: parsed.data.sha256,
          status: "awaiting_upload",
          retentionUntil,
        })
        .onConflictDoUpdate({
          target: [creditDocuments.caseId, creditDocuments.documentType],
          set: {
            storageKey,
            mimeType: parsed.data.contentType,
            sizeBytes: parsed.data.sizeBytes,
            sha256: parsed.data.sha256,
            status: "awaiting_upload",
            retentionUntil,
            deletedAt: null,
          },
        })
        .returning({ id: creditDocuments.id });

      const signed = await createCreditUploadUrl({
        storageKey,
        contentType: parsed.data.contentType,
        sizeBytes: parsed.data.sizeBytes,
        sha256: parsed.data.sha256,
      });
      await db.insert(creditAuditEvents).values({
        clientId,
        caseId: parsed.data.caseId,
        documentId: document.id,
        actorEmail,
        action: "synthetic_upload_link_created",
      });

      res.status(201).json({
        documentId: document.id,
        uploadUrl: signed.uploadUrl,
        expiresInSeconds: signed.expiresInSeconds,
        requiredHeaders: signed.requiredHeaders,
      });
    },
  );

  app.post(
    "/api/credit/documents/complete",
    authMiddleware,
    sensitiveNoStore,
    requireCreditFeature,
    async (req: Request, res: Response) => {
      if (!isCreditStorageConfigured() || !areCreditUploadsEnabled()) {
        return res.status(503).json({ error: "Secure object storage uploads are locked." });
      }

      const clientId = getClientId(req);
      const actorEmail = (req as any).user?.email || "unknown";
      if (!clientId) return res.status(400).json({ error: "Client context required" });
      const parsed = completeUploadSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid document confirmation" });

      const [document] = await db
        .select()
        .from(creditDocuments)
        .where(and(eq(creditDocuments.id, parsed.data.documentId), eq(creditDocuments.clientId, clientId)))
        .limit(1);
      if (!document?.storageKey || !document.mimeType || !document.sizeBytes || !document.sha256) {
        return res.status(404).json({ error: "Pending document not found" });
      }

      await verifyCreditUpload({
        storageKey: document.storageKey,
        expectedContentType: document.mimeType,
        expectedSizeBytes: document.sizeBytes,
        expectedSha256: document.sha256,
      });
      await db
        .update(creditDocuments)
        .set({ status: "uploaded_unscanned" })
        .where(and(eq(creditDocuments.id, document.id), eq(creditDocuments.clientId, clientId)));
      await db.insert(creditAuditEvents).values({
        clientId,
        caseId: document.caseId,
        documentId: document.id,
        actorEmail,
        action: "synthetic_upload_verified_unscanned",
      });

      res.json({ documentId: document.id, status: "uploaded_unscanned", processingAllowed: false });
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

  // Legacy direct-upload endpoint stays permanently locked. File bytes must go
  // directly from the browser to private object storage through a signed URL.
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
