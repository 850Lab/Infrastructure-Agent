import { type Express, type Request, type Response } from "express";
import { authMiddleware } from "./auth";
import { db } from "./db";
import { clientEmailSettings, emailReplies } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  sendOutreachEmail,
  sendTestEmail,
  recordTrackingEvent,
  getEmailSendsForPipeline,
  getTrackingEvents,
  getTrackingPixel,
  getEmailSettings,
  getSendQuotaStatus,
  getDeferredSends,
} from "./email-service";
import { runReplyCheck, getRepliesForPipeline } from "./reply-checker";
import { detectProviderFromHost, clampDailyLimit } from "./email-providers";

export function registerEmailRoutes(app: Express) {
  // === PUBLIC TRACKING ROUTES (no auth) ===

  // Open tracking pixel — GET /api/t/o/:trackingId
  app.get("/api/t/o/:trackingId", async (req: Request, res: Response) => {
    const { trackingId } = req.params;
    try {
      await recordTrackingEvent({
        trackingId,
        eventType: "open",
        ipAddress: req.ip || req.headers["x-forwarded-for"]?.toString(),
        userAgent: req.headers["user-agent"],
      });
    } catch (e) {
      // Silently fail — never block pixel delivery
    }
    const pixel = getTrackingPixel();
    res.set({
      "Content-Type": pixel.contentType,
      "Content-Length": pixel.buffer.length.toString(),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(pixel.buffer);
  });

  // Click tracking redirect — GET /api/t/c/:trackingId/:encodedUrl
  app.get("/api/t/c/:trackingId/:encodedUrl", async (req: Request, res: Response) => {
    const { trackingId, encodedUrl } = req.params;
    let targetUrl: string;
    try {
      targetUrl = Buffer.from(encodedUrl, "base64url").toString("utf-8");
    } catch {
      res.status(400).send("Invalid link");
      return;
    }

    try {
      await recordTrackingEvent({
        trackingId,
        eventType: "click",
        linkUrl: targetUrl,
        ipAddress: req.ip || req.headers["x-forwarded-for"]?.toString(),
        userAgent: req.headers["user-agent"],
      });
    } catch (e) {
      // Silently fail — always redirect
    }
    res.redirect(302, targetUrl);
  });

  // === AUTHENTICATED ROUTES ===

  // Get email settings for the current client
  app.get("/api/email/settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }
      const settings = await getEmailSettings(clientId);
      if (!settings) {
        res.json(null);
        return;
      }
      // Strip password from response
      const { smtpPass, ...safe } = settings;
      res.json({ ...safe, smtpPass: "••••••••" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save email settings
  app.post("/api/email/settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }

      const {
        smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure,
        imapHost, imapPort, imapSecure, replyCheckEnabled,
        fromName, fromEmail, signature, dailyLimit, sendIntervalMs, enabled,
      } = req.body;

      if (!smtpHost || !smtpUser || !fromName || !fromEmail) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      // Auto-detect provider from SMTP host
      const provider = detectProviderFromHost(smtpHost);
      const { limit: clampedLimit, clamped } = clampDailyLimit(dailyLimit || 50, provider.type);

      const [existing] = await db
        .select()
        .from(clientEmailSettings)
        .where(eq(clientEmailSettings.clientId, clientId));

      if (existing) {
        const updateData: any = {
          smtpHost,
          smtpPort: smtpPort || 587,
          smtpUser,
          smtpSecure: smtpSecure || false,
          imapHost: imapHost || null,
          imapPort: imapPort || 993,
          imapSecure: imapSecure !== false,
          replyCheckEnabled: replyCheckEnabled || false,
          providerType: provider.type,
          providerMaxLimit: provider.maxDailyLimit,
          fromName,
          fromEmail,
          signature: signature || null,
          dailyLimit: clampedLimit,
          sendIntervalMs: sendIntervalMs || provider.recommendedIntervalMs,
          enabled: enabled !== false,
          updatedAt: new Date(),
        };
        if (smtpPass && smtpPass !== "••••••••") {
          updateData.smtpPass = smtpPass;
        }

        const [updated] = await db
          .update(clientEmailSettings)
          .set(updateData)
          .where(eq(clientEmailSettings.id, existing.id))
          .returning();
        const { smtpPass: _p, ...safe } = updated;
        const response: any = { ...safe, smtpPass: "••••••••" };
        if (clamped) {
          response._warning = `Daily limit was reduced from ${dailyLimit} to ${clampedLimit} (${provider.label} max: ${provider.maxDailyLimit}/day)`;
        }
        res.json(response);
      } else {
        if (!smtpPass) {
          res.status(400).json({ error: "SMTP password is required for initial setup" });
          return;
        }
        const [created] = await db
          .insert(clientEmailSettings)
          .values({
            clientId,
            smtpHost,
            smtpPort: smtpPort || 587,
            smtpUser,
            smtpPass,
            smtpSecure: smtpSecure || false,
            imapHost: imapHost || null,
            imapPort: imapPort || 993,
            imapSecure: imapSecure !== false,
            replyCheckEnabled: replyCheckEnabled || false,
            providerType: provider.type,
            providerMaxLimit: provider.maxDailyLimit,
            fromName,
            fromEmail,
            signature: signature || null,
            dailyLimit: clampedLimit,
            sendIntervalMs: sendIntervalMs || provider.recommendedIntervalMs,
            enabled: enabled !== false,
          })
          .returning();
        const { smtpPass: _p, ...safe } = created;
        res.json({ ...safe, smtpPass: "••••••••" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send test email
  app.post("/api/email/test", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }
      const { recipientEmail } = req.body;
      if (!recipientEmail) {
        res.status(400).json({ error: "Recipient email is required" });
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(recipientEmail)) {
        res.status(400).json({ error: "Invalid email address format" });
        return;
      }
      const result = await sendTestEmail(clientId, recipientEmail);
      if (result.success) {
        res.json({ success: true, message: "Test email sent successfully" });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send an outreach email for a specific touch
  app.post("/api/email/send", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }

      const { outreachPipelineId, touchNumber, recipientEmail, recipientName, companyId, companyName } = req.body;
      if (!outreachPipelineId || !touchNumber || !recipientEmail || !companyId) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(recipientEmail)) {
        res.status(400).json({ error: "Invalid email address format" });
        return;
      }

      const result = await sendOutreachEmail({
        clientId,
        outreachPipelineId,
        touchNumber,
        recipientEmail,
        recipientName,
        companyId,
        companyName,
      });

      if (result.success) {
        res.json({ success: true, emailSendId: result.emailSendId });
      } else if (result.deferred) {
        res.status(429).json({ success: false, deferred: true, error: result.error, deferReason: result.deferReason });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get send records for an outreach pipeline item
  app.get("/api/email/sends/:outreachPipelineId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }
      const pipelineId = parseInt(req.params.outreachPipelineId);
      if (isNaN(pipelineId)) {
        res.status(400).json({ error: "Invalid pipeline ID" });
        return;
      }
      const sends = await getEmailSendsForPipeline(pipelineId, clientId);
      res.json(sends);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get tracking events for a specific email send
  app.get("/api/email/tracking/:emailSendId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const emailSendId = parseInt(req.params.emailSendId);
      if (isNaN(emailSendId)) {
        res.status(400).json({ error: "Invalid email send ID" });
        return;
      }
      const events = await getTrackingEvents(emailSendId);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trigger manual reply check for current client
  app.post("/api/email/check-replies", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }

      const [settings] = await db
        .select()
        .from(clientEmailSettings)
        .where(eq(clientEmailSettings.clientId, clientId));

      if (!settings) {
        res.status(400).json({ error: "Email settings not configured" });
        return;
      }

      const result = await runReplyCheck();
      res.json({
        success: true,
        repliesFound: result.totalReplies,
        clientsChecked: result.clientsChecked,
        errors: result.errors,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get replies for a specific pipeline entry
  app.get("/api/email/replies/:outreachPipelineId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }
      const pipelineId = parseInt(req.params.outreachPipelineId);
      if (isNaN(pipelineId)) {
        res.status(400).json({ error: "Invalid pipeline ID" });
        return;
      }
      const replies = await getRepliesForPipeline(pipelineId, clientId);
      res.json(replies);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all replies for current client
  app.get("/api/email/replies", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }
      const replies = await db
        .select()
        .from(emailReplies)
        .where(eq(emailReplies.clientId, clientId))
        .orderBy(desc(emailReplies.receivedAt));
      res.json(replies);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get sending quota status for current client
  app.get("/api/email/quota", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }
      const quota = await getSendQuotaStatus(clientId);
      if (!quota) {
        res.json(null);
        return;
      }
      res.json(quota);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get deferred sends for current client
  app.get("/api/email/deferred", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        res.status(400).json({ error: "No client context" });
        return;
      }
      const deferred = await getDeferredSends(clientId);
      res.json(deferred);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
