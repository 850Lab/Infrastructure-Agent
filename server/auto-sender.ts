import { db } from "./db";
import { clientEmailSettings, emailSends, outreachPipeline } from "@shared/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { sendOutreachEmail } from "./email-service";
import { storage } from "./storage";
import { normalizePipelineStatusForClient } from "./outreach-pipeline-helper";

const AUTO_SEND_INTERVAL = 15 * 60 * 1000;
const AUTO_SEND_STARTUP_DELAY = 90 * 1000;

const TOUCH_SCHEDULE = [
  { day: 1, type: "call" as const },
  { day: 2, type: "email" as const },
  { day: 3, type: "call" as const },
  { day: 5, type: "email" as const },
  { day: 8, type: "call" as const },
  { day: 14, type: "email" as const },
];

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [auto-sender] ${msg}`);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function getAutoSendClients(): Promise<Array<{
  clientId: string;
  fromName: string;
  fromEmail: string;
}>> {
  const settings = await db
    .select({
      clientId: clientEmailSettings.clientId,
      fromName: clientEmailSettings.fromName,
      fromEmail: clientEmailSettings.fromEmail,
    })
    .from(clientEmailSettings)
    .where(
      and(
        eq(clientEmailSettings.enabled, true),
        eq(clientEmailSettings.autoSendEnabled, true)
      )
    );
  return settings;
}

async function hasSentForTouch(
  pipelineId: number,
  touchNumber: number
): Promise<boolean> {
  const existing = await db
    .select({ id: emailSends.id, status: emailSends.status })
    .from(emailSends)
    .where(
      and(
        eq(emailSends.outreachPipelineId, pipelineId),
        eq(emailSends.touchNumber, touchNumber)
      )
    )
    .limit(1);

  if (existing.length === 0) return false;
  const status = existing[0].status;
  return status === "sent" || status === "sending";
}

async function processClientAutoSends(clientId: string): Promise<{
  sent: number;
  skipped: number;
  failed: number;
  deferred: number;
}> {
  const normalized = await normalizePipelineStatusForClient(clientId);
  if (normalized > 0) log(`  Normalized ${normalized} legacy pipelineStatus rows to ACTIVE`);

  const dueItems = await storage.getOutreachPipelinesDue(clientId, 20);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let deferred = 0;

  for (const item of dueItems) {
    if (item.pipelineStatus !== "ACTIVE") {
      skipped++;
      continue;
    }

    if (!item.firstTouchSent && item.touch0Email) {
      if (!item.contactEmail) {
        log(`  ${item.companyName}: First-touch skipped — no contact email`);
        skipped++;
        continue;
      }

      const alreadySentTouch0 = await hasSentForTouch(item.id, 0);
      if (alreadySentTouch0) {
        await storage.updateOutreachPipeline(item.id, {
          firstTouchSent: true,
          nextTouchDate: addDays(item.createdAt, TOUCH_SCHEDULE[0].day),
        });
      } else {
        log(`  ${item.companyName}: Sending first-touch email to ${item.contactEmail}...`);
        try {
          const result = await sendOutreachEmail({
            clientId,
            outreachPipelineId: item.id,
            touchNumber: 0,
            recipientEmail: item.contactEmail,
            recipientName: item.contactName || undefined,
            companyId: item.companyId,
            companyName: item.companyName,
            sentVia: "auto",
          });

          if (result.success) {
            sent++;
            log(`  ${item.companyName}: First-touch sent successfully (id: ${result.emailSendId})`);
            await storage.updateOutreachPipeline(item.id, {
              firstTouchSent: true,
              nextTouchDate: addDays(item.createdAt, TOUCH_SCHEDULE[0].day),
            });
          } else if (result.deferred) {
            deferred++;
            log(`  ${item.companyName}: First-touch deferred — ${result.deferReason || "daily limit"}`);
            break;
          } else {
            failed++;
            log(`  ${item.companyName}: First-touch failed — ${result.error}`);
          }
        } catch (err: any) {
          failed++;
          log(`  ${item.companyName}: First-touch error — ${err.message}`);
        }
      }
      continue;
    }

    const nextTouch = item.touchesCompleted + 1;
    if (nextTouch > 6) {
      skipped++;
      continue;
    }

    const schedule = TOUCH_SCHEDULE[nextTouch - 1];
    if (!schedule || schedule.type !== "email") {
      skipped++;
      continue;
    }

    if (!item.contactEmail) {
      log(`  ${item.companyName}: Touch ${nextTouch} skipped — no contact email on pipeline`);
      skipped++;
      continue;
    }

    const alreadySent = await hasSentForTouch(item.id, nextTouch);
    if (alreadySent) {
      log(`  ${item.companyName}: Touch ${nextTouch} skipped — already sent`);
      skipped++;
      continue;
    }

    log(`  ${item.companyName}: Sending Touch ${nextTouch} to ${item.contactEmail}...`);

    try {
      const result = await sendOutreachEmail({
        clientId,
        outreachPipelineId: item.id,
        touchNumber: nextTouch,
        recipientEmail: item.contactEmail,
        recipientName: item.contactName || undefined,
        companyId: item.companyId,
        companyName: item.companyName,
        sentVia: "auto",
      });

      if (result.success) {
        sent++;
        log(`  ${item.companyName}: Touch ${nextTouch} sent successfully (id: ${result.emailSendId})`);

        const updates: Record<string, any> = {
          touchesCompleted: nextTouch,
        };

        if (nextTouch >= 6) {
          updates.pipelineStatus = "COMPLETED";
          updates.nextTouchDate = new Date();
        } else {
          const nextSchedule = TOUCH_SCHEDULE[nextTouch];
          if (nextSchedule) {
            updates.nextTouchDate = addDays(item.createdAt, nextSchedule.day);
          }
        }

        await storage.updateOutreachPipeline(item.id, updates);
      } else if (result.deferred) {
        deferred++;
        log(`  ${item.companyName}: Touch ${nextTouch} deferred — ${result.deferReason || "daily limit"}`);
        break;
      } else {
        failed++;
        log(`  ${item.companyName}: Touch ${nextTouch} failed — ${result.error}`);
      }
    } catch (err: any) {
      failed++;
      log(`  ${item.companyName}: Touch ${nextTouch} error — ${err.message}`);
    }
  }

  return { sent, skipped, failed, deferred };
}

async function runAutoSender(): Promise<void> {
  log("Auto-sender cycle starting...");

  try {
    const clients = await getAutoSendClients();
    if (clients.length === 0) {
      log("No clients with auto-send enabled");
      return;
    }

    log(`Processing ${clients.length} client(s) with auto-send enabled`);

    for (const client of clients) {
      log(`Client ${client.clientId}:`);
      const result = await processClientAutoSends(client.clientId);
      log(`  Results: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed, ${result.deferred} deferred`);
    }
  } catch (err: any) {
    log(`Auto-sender error: ${err.message}`);
  }

  log("Auto-sender cycle complete");
}

export function startAutoSender(): void {
  log(`Auto-sender starting (interval: ${AUTO_SEND_INTERVAL / 60000} minutes)`);

  setTimeout(() => {
    runAutoSender();
    setInterval(runAutoSender, AUTO_SEND_INTERVAL);
  }, AUTO_SEND_STARTUP_DELAY);
}
