import * as nodemailer from "nodemailer";
import { db } from "./db";
import { clientEmailSettings, emailSends, emailTrackingEvents } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

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

// Get SMTP settings for a client, with daily limit reset
export async function getEmailSettings(clientId: string) {
  const [settings] = await db
    .select()
    .from(clientEmailSettings)
    .where(eq(clientEmailSettings.clientId, clientId));
  if (!settings) return null;

  const today = new Date().toISOString().slice(0, 10);
  if (settings.lastResetDate !== today) {
    await db
      .update(clientEmailSettings)
      .set({ sentToday: 0, lastResetDate: today, updatedAt: new Date() })
      .where(eq(clientEmailSettings.id, settings.id));
    settings.sentToday = 0;
    settings.lastResetDate = today;
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

// Send an outreach email for a specific touch
export async function sendOutreachEmail(params: {
  clientId: string;
  outreachPipelineId: number;
  touchNumber: number;
  recipientEmail: string;
  recipientName?: string;
  companyId: string;
  companyName?: string;
}): Promise<{ success: boolean; emailSendId?: number; error?: string }> {
  const settings = await getEmailSettings(params.clientId);
  if (!settings) return { success: false, error: "Email settings not configured" };
  if (!settings.enabled) return { success: false, error: "Email sending is disabled" };
  if (settings.sentToday >= settings.dailyLimit) {
    return { success: false, error: `Daily send limit reached (${settings.dailyLimit})` };
  }

  // Fetch the outreach pipeline item
  const { outreachPipeline } = await import("@shared/schema");
  const [pipeline] = await db
    .select()
    .from(outreachPipeline)
    .where(eq(outreachPipeline.id, params.outreachPipelineId));
  if (!pipeline) return { success: false, error: "Outreach pipeline item not found" };

  // Get the touch content based on touch number
  const touchField: Record<number, string | null> = {
    1: pipeline.touch1Email,
    3: pipeline.touch3Email,
    5: pipeline.touch5Email,
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
    })
    .returning();

  try {
    const transporter = createTransporter(settings);
    const sendResult = await transporter.sendMail({
      from: `"${settings.fromName}" <${settings.fromEmail}>`,
      to: params.recipientName
        ? `"${params.recipientName}" <${params.recipientEmail}>`
        : params.recipientEmail,
      subject,
      html: trackedHtml,
      headers: {
        "X-Outreach-Tracking-Id": trackingId,
      },
    });

    // Update status to sent and store the SMTP Message-ID for reply threading
    const smtpMessageId = sendResult.messageId || null;
    await db
      .update(emailSends)
      .set({ status: "sent", messageId: smtpMessageId })
      .where(eq(emailSends.id, sendRecord.id));

    // Increment daily counter
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
      <p style="color:#334155;line-height:1.5;">This is a test email to verify your SMTP settings are working correctly.</p>
      <p style="color:#334155;line-height:1.5;">If you can see this message, your email integration is properly configured.</p>
      <p style="color:#334155;line-height:1.5;"><a href="https://example.com/test-link" style="color:#10B981;">Click this test link</a> to verify click tracking.</p>
    </div>
  `;
  const html = processEmailForTracking(rawHtml, trackingId, settings.signature);

  try {
    const transporter = createTransporter(settings);
    await transporter.sendMail({
      from: `"${settings.fromName}" <${settings.fromEmail}>`,
      to: recipientEmail,
      subject: "Test Email — Texas Automation Systems",
      html,
    });
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
