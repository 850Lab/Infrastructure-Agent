import * as nodemailer from "nodemailer";
import { Resend } from "resend";
import { db } from "./db";
import { clientEmailSettings, emailSends, emailTrackingEvents } from "@shared/schema";
import { eq, and, sql, isNull, desc } from "drizzle-orm";
import { detectProviderFromHost, getProviderProfile } from "./email-providers";

// Tracking pixel: 1x1 transparent GIF
const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function getBaseUrl(): string {
  const host = process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG
    ? `https://${process.env.REPLIT_DEV_DOMAIN || `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`}`
    : "http://localhost:5000";
  return host;
}

// Convert plain text email body to HTML with paragraphs
function textToHtml(text: string): string {
  return text
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 12px 0;line-height:1.5;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// Parse subject and body from stored touch content (format: "Subject: ...\n\n...")
function parseEmailContent(touchContent: string): { subject: string; body: string } {
  const lines = touchContent.trim().split("\n");
  let subject = "";
  let bodyStart = 0;
  if (lines[0]?.toLowerCase().startsWith("subject:")) {
    subject = lines[0].replace(/^subject:\s*/i, "").trim();
    bodyStart = lines[1]?.trim() === "" ? 2 : 1;
  } else {
    subject = lines[0] || "Follow-up";
    bodyStart = 1;
  }
  const body = lines.slice(bodyStart).join("\n").trim();
  return { subject, body };
}

// Inject tracking pixel and wrap links for click tracking
export function processEmailForTracking(
  htmlBody: string,
  trackingId: string,
  signature?: string | null
): string {
  const baseUrl = getBaseUrl();

  // Wrap all href links for click tracking
  let processed = htmlBody.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_match, url) => {
      const encoded = Buffer.from(url).toString("base64url");
      return `href="${baseUrl}/api/t/c/${trackingId}/${encoded}"`;
    }
  );

  // Append signature if provided
  if (signature) {
    processed += `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #E2E8F0;font-size:13px;color:#64748B;">${textToHtml(signature)}</div>`;
  }

  // Append tracking pixel at the very end
  processed += `<img src="${baseUrl}/api/t/o/${trackingId}" width="1" height="1" style="display:none;" alt="" />`;

  return processed;
}

// Get SMTP settings for a client, with daily limit reset and provider auto-detection
export async function getEmailSettings(clientId: string) {
  const [settings] = await db
    .select()
    .from(clientEmailSettings)
    .where(eq(clientEmailSettings.clientId, clientId));
  if (!settings) return null;

  const today = new Date().toISOString().slice(0, 10);
  const updates: Record<string, any> = {};

  // Reset daily counter if new day
  if (settings.lastResetDate !== today) {
    updates.sentToday = 0;
    updates.lastResetDate = today;
    settings.sentToday = 0;
    settings.lastResetDate = today;
  }

  // Auto-detect provider if still set to default "custom" and host is known
  const detected = detectProviderFromHost(settings.smtpHost);
  if (settings.providerType === "custom" && detected.type !== "custom") {
    updates.providerType = detected.type;
    updates.providerMaxLimit = detected.maxDailyLimit;
    settings.providerType = detected.type;
    settings.providerMaxLimit = detected.maxDailyLimit;
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date();
    await db
      .update(clientEmailSettings)
      .set(updates)
      .where(eq(clientEmailSettings.id, settings.id));
  }

  return settings;
}

// Create a nodemailer transporter from client settings
function createTransporter(settings: {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure: boolean;
}) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: {
      user: settings.smtpUser,
      pass: settings.smtpPass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

// Per-client send timestamps for throttle pacing (in-memory)
const lastSendTimestamps = new Map<string, number>();

// Enforce throttle delay between sends for a client
async function enforceThrottle(clientId: string, intervalMs: number): Promise<void> {
  const lastSend = lastSendTimestamps.get(clientId);
  if (lastSend) {
    const elapsed = Date.now() - lastSend;
    if (elapsed < intervalMs) {
      const waitMs = intervalMs - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  lastSendTimestamps.set(clientId, Date.now());
}

// Send an outreach email for a specific touch
export async function sendOutreachEmail(params: {
  clientId: string;
  outreachPipelineId: number;
  touchNumber: number;
  recipientEmail: string;
  recipientName?: string;
  companyId: string;
  companyName?: string;
  sentVia?: string;
}): Promise<{ success: boolean; emailSendId?: number; error?: string; deferred?: boolean; deferReason?: string }> {
  const settings = await getEmailSettings(params.clientId);
  if (!settings) return { success: false, error: "Email settings not configured" };
  if (!settings.enabled) return { success: false, error: "Email sending is disabled" };

  const via = params.sentVia || "manual";

  // Duplicate-send guard: check if already sent/sending for this pipeline+touch
  const [existingSend] = await db
    .select({ id: emailSends.id, status: emailSends.status })
    .from(emailSends)
    .where(
      and(
        eq(emailSends.outreachPipelineId, params.outreachPipelineId),
        eq(emailSends.touchNumber, params.touchNumber)
      )
    )
    .limit(1);
  if (existingSend && (existingSend.status === "sent" || existingSend.status === "sending")) {
    return { success: false, error: `Touch ${params.touchNumber} already sent (id: ${existingSend.id})` };
  }

  // Provider-aware daily limit enforcement
  const effectiveLimit = Math.min(settings.dailyLimit, settings.providerMaxLimit);
  if (settings.sentToday >= effectiveLimit) {
    const profile = getProviderProfile(settings.providerType);
    const reason = `Daily limit reached: ${settings.sentToday}/${effectiveLimit} (${profile.label} max: ${settings.providerMaxLimit}/day)`;

    const [deferredRecord] = await db
      .insert(emailSends)
      .values({
        clientId: params.clientId,
        outreachPipelineId: params.outreachPipelineId,
        companyId: params.companyId,
        companyName: params.companyName || null,
        contactEmail: params.recipientEmail,
        contactName: params.recipientName || null,
        touchNumber: params.touchNumber,
        subject: "(deferred)",
        bodyHtml: "",
        trackingId: crypto.randomUUID(),
        status: "deferred",
        sentVia: via,
        deferredAt: new Date(),
        deferReason: reason,
      })
      .returning();

    return { success: false, emailSendId: deferredRecord.id, error: reason, deferred: true, deferReason: reason };
  }

  // Fetch the outreach pipeline item
  const { outreachPipeline } = await import("@shared/schema");
  const [pipeline] = await db
    .select()
    .from(outreachPipeline)
    .where(eq(outreachPipeline.id, params.outreachPipelineId));
  if (!pipeline) return { success: false, error: "Outreach pipeline item not found" };

  const touchField: Record<number, string | null> = {
    0: pipeline.touch0Email,
    2: pipeline.touch2Call,
    4: pipeline.touch4Call,
    6: pipeline.touch6Call,
  };
  const touchContent = touchField[params.touchNumber];
  if (!touchContent) {
    return { success: false, error: `No email content for touch ${params.touchNumber}` };
  }

  const { subject, body } = parseEmailContent(touchContent);
  const htmlBody = textToHtml(body);

  // Generate tracking ID for this send
  const trackingId = crypto.randomUUID();

  // Process HTML with tracking pixel + link wrapping
  const trackedHtml = processEmailForTracking(htmlBody, trackingId, settings.signature);

  // Create the email send record first (status: sending)
  const [sendRecord] = await db
    .insert(emailSends)
    .values({
      clientId: params.clientId,
      outreachPipelineId: params.outreachPipelineId,
      companyId: params.companyId,
      companyName: params.companyName || null,
      contactEmail: params.recipientEmail,
      contactName: params.recipientName || null,
      touchNumber: params.touchNumber,
      subject,
      bodyHtml: trackedHtml,
      trackingId,
      status: "sending",
      sentVia: via,
    })
    .returning();

  try {
    await enforceThrottle(params.clientId, settings.sendIntervalMs);

    let messageId: string | null = null;

    if (settings.providerType === "resend") {
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) throw new Error("RESEND_API_KEY environment variable is not set");
      const resend = new Resend(resendApiKey);
      const toAddr = params.recipientName
        ? `${params.recipientName} <${params.recipientEmail}>`
        : params.recipientEmail;
      const { data, error } = await resend.emails.send({
        from: `${settings.fromName} <${settings.fromEmail}>`,
        to: [toAddr],
        subject,
        html: trackedHtml,
        headers: { "X-Outreach-Tracking-Id": trackingId },
      });
      if (error) throw new Error(error.message);
      messageId = data?.id ? `<${data.id}@resend.dev>` : null;
    } else {
      const transporter = createTransporter(settings);
      const sendResult = await transporter.sendMail({
        from: `"${settings.fromName}" <${settings.fromEmail}>`,
        to: params.recipientName
          ? `"${params.recipientName}" <${params.recipientEmail}>`
          : params.recipientEmail,
        subject,
        html: trackedHtml,
        headers: { "X-Outreach-Tracking-Id": trackingId },
      });
      messageId = sendResult.messageId || null;
    }

    await db
      .update(emailSends)
      .set({ status: "sent", messageId, sentAt: new Date() })
      .where(eq(emailSends.id, sendRecord.id));

    await db
      .update(clientEmailSettings)
      .set({
        sentToday: sql`${clientEmailSettings.sentToday} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(clientEmailSettings.id, settings.id));

    return { success: true, emailSendId: sendRecord.id };
  } catch (err: any) {
    await db
      .update(emailSends)
      .set({ status: "failed", errorMessage: err.message })
      .where(eq(emailSends.id, sendRecord.id));
    return { success: false, emailSendId: sendRecord.id, error: err.message };
  }
}

// Send a test email to verify SMTP settings
export async function sendTestEmail(
  clientId: string,
  recipientEmail: string
): Promise<{ success: boolean; error?: string }> {
  const settings = await getEmailSettings(clientId);
  if (!settings) return { success: false, error: "Email settings not configured" };

  const trackingId = crypto.randomUUID();
  const rawHtml = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#0F172A;">Test Email from Texas Automation Systems</h2>
      <p style="color:#334155;line-height:1.5;">This is a test email to verify your email settings are working correctly.</p>
      <p style="color:#334155;line-height:1.5;">If you can see this message, your email integration is properly configured.</p>
      <p style="color:#334155;line-height:1.5;"><a href="https://example.com/test-link" style="color:#10B981;">Click this test link</a> to verify click tracking.</p>
    </div>
  `;
  const html = processEmailForTracking(rawHtml, trackingId, settings.signature);

  try {
    if (settings.providerType === "resend") {
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) throw new Error("RESEND_API_KEY environment variable is not set");
      const resend = new Resend(resendApiKey);
      const { error } = await resend.emails.send({
        from: `${settings.fromName} <${settings.fromEmail}>`,
        to: [recipientEmail],
        subject: "Test Email — Texas Automation Systems",
        html,
      });
      if (error) throw new Error(error.message);
    } else {
      const transporter = createTransporter(settings);
      await transporter.sendMail({
        from: `"${settings.fromName}" <${settings.fromEmail}>`,
        to: recipientEmail,
        subject: "Test Email — Texas Automation Systems",
        html,
      });
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Record a tracking event (open or click)
export async function recordTrackingEvent(params: {
  trackingId: string;
  eventType: "open" | "click";
  linkUrl?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<boolean> {
  // Find the email send by tracking ID
  const [send] = await db
    .select()
    .from(emailSends)
    .where(eq(emailSends.trackingId, params.trackingId));
  if (!send) return false;

  // Insert the tracking event
  await db.insert(emailTrackingEvents).values({
    emailSendId: send.id,
    trackingId: params.trackingId,
    eventType: params.eventType,
    linkUrl: params.linkUrl || null,
    ipAddress: params.ipAddress || null,
    userAgent: params.userAgent || null,
  });

  // Update aggregate counters on email_sends
  if (params.eventType === "open") {
    const updates: any = {
      openCount: sql`${emailSends.openCount} + 1`,
    };
    if (!send.firstOpenedAt) {
      updates.firstOpenedAt = new Date();
    }
    await db.update(emailSends).set(updates).where(eq(emailSends.id, send.id));
  } else if (params.eventType === "click") {
    const updates: any = {
      clickCount: sql`${emailSends.clickCount} + 1`,
    };
    if (!send.firstClickedAt) {
      updates.firstClickedAt = new Date();
    }
    await db.update(emailSends).set(updates).where(eq(emailSends.id, send.id));
  }

  return true;
}

// Get send records with tracking data for an outreach pipeline item (scoped to client)
export async function getEmailSendsForPipeline(outreachPipelineId: number, clientId: string) {
  return db
    .select()
    .from(emailSends)
    .where(and(eq(emailSends.outreachPipelineId, outreachPipelineId), eq(emailSends.clientId, clientId)))
    .orderBy(emailSends.sentAt);
}

// Get detailed tracking events for an email send
export async function getTrackingEvents(emailSendId: number) {
  return db
    .select()
    .from(emailTrackingEvents)
    .where(eq(emailTrackingEvents.emailSendId, emailSendId))
    .orderBy(emailTrackingEvents.createdAt);
}

// Return the tracking pixel buffer and content type
export function getTrackingPixel() {
  return {
    buffer: TRACKING_PIXEL,
    contentType: "image/gif",
  };
}

// Get sending quota status for a client
export async function getSendQuotaStatus(clientId: string) {
  const settings = await getEmailSettings(clientId);
  if (!settings) return null;

  const profile = getProviderProfile(settings.providerType);
  const effectiveLimit = Math.min(settings.dailyLimit, settings.providerMaxLimit);

  return {
    providerType: settings.providerType,
    providerLabel: profile.label,
    providerMaxLimit: settings.providerMaxLimit,
    userDailyLimit: settings.dailyLimit,
    effectiveLimit,
    sentToday: settings.sentToday,
    remaining: Math.max(0, effectiveLimit - settings.sentToday),
    sendIntervalMs: settings.sendIntervalMs,
    isAtLimit: settings.sentToday >= effectiveLimit,
    notes: profile.notes,
  };
}

// Get deferred sends for a client (emails that couldn't send due to limits)
export async function getDeferredSends(clientId: string) {
  return db
    .select()
    .from(emailSends)
    .where(
      and(
        eq(emailSends.clientId, clientId),
        eq(emailSends.status, "deferred")
      )
    )
    .orderBy(desc(emailSends.sentAt));
}

export async function sendProposalEmail(params: {
  clientId: string;
  recipientEmail: string;
  recipientName: string;
  companyName: string;
  proposalTitle: string;
  proposalHtml: string;
}): Promise<{ success: boolean; error?: string }> {
  const settings = await getEmailSettings(params.clientId);
  if (!settings) return { success: false, error: "Email settings not configured for this client. Go to Email Settings to set up SMTP." };

  const fromName = settings.fromName || "Proposals";
  const fromEmail = settings.fromEmail || settings.smtpUser;
  const subjectLine = `${params.proposalTitle} — ${params.companyName}`;

  try {
    if (settings.providerType === "resend") {
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) throw new Error("RESEND_API_KEY environment variable is not set");
      const resend = new Resend(resendApiKey);
      const { error } = await resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: [params.recipientEmail],
        subject: subjectLine,
        html: params.proposalHtml,
      });
      if (error) throw new Error(error.message);
    } else {
      if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
        return { success: false, error: "SMTP credentials not configured. Go to Email Settings to set up SMTP." };
      }
      const transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpSecure,
        auth: { user: settings.smtpUser, pass: settings.smtpPass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: params.recipientEmail,
        subject: subjectLine,
        html: params.proposalHtml,
      });
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: `Email delivery failed: ${err.message || "Unknown SMTP error"}` };
  }
}
