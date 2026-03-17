import { ImapFlow } from "imapflow";
import { db } from "./db";
import { clientEmailSettings, emailSends, emailReplies, outreachPipeline, companyFlows, actionQueue } from "@shared/schema";
import { eq, and, isNotNull, isNull, inArray, desc, gte, sql } from "drizzle-orm";
import { log } from "./index";
import { sendSms } from "./twilio-service";

const TAG = "reply-checker";
const REPLY_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
let replyCheckTimer: ReturnType<typeof setInterval> | null = null;

const NEGATIVE_PHRASES = [
  "no thanks", "not interested", "stop", "unsubscribe", "remove me",
  "wrong person", "not at this time", "do not contact", "don't contact",
  "dont contact", "please remove", "take me off", "opt out", "no thank you",
  "not looking", "no longer interested",
];

const HOT_PHRASES = [
  "yes", "interested", "tell me more", "what is this", "maybe", "possibly",
  "send info", "send information", "give me a call", "call me", "we are",
  "we do", "looking into that", "want to know more", "can you send more",
  "let's talk", "lets talk", "let us talk", "send details", "more info",
  "sounds good", "sounds interesting", "reach out", "set up a call",
  "schedule a call", "when can we talk",
];

type ReplyClassification = "HOT" | "NOT_INTERESTED" | "NEUTRAL";

function classifyReply(subject: string, snippet: string): { classification: ReplyClassification; reason: string } {
  const raw = `${subject} ${snippet}`.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();

  for (const phrase of NEGATIVE_PHRASES) {
    if (raw.includes(phrase)) {
      return { classification: "NOT_INTERESTED", reason: `negative phrase: "${phrase}"` };
    }
  }

  for (const phrase of HOT_PHRASES) {
    if (raw.includes(phrase)) {
      return { classification: "HOT", reason: `positive phrase: "${phrase}"` };
    }
  }

  return { classification: "NEUTRAL", reason: "no matching phrases" };
}

async function handleHotReply(params: {
  clientId: string;
  companyId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string;
  replySnippet: string;
  emailReplyId: number;
  pipelineId: number;
}): Promise<void> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db.select({ id: actionQueue.id }).from(actionQueue).where(
    and(
      eq(actionQueue.clientId, params.clientId),
      eq(actionQueue.companyId, params.companyId),
      eq(actionQueue.taskType, "hot_reply_followup"),
      gte(actionQueue.createdAt, oneDayAgo),
    )
  );

  if (existing.length === 0) {
    await db.insert(actionQueue).values({
      clientId: params.clientId,
      companyId: params.companyId,
      companyName: params.companyName,
      contactName: params.contactName,
      contactEmail: params.contactEmail,
      flowType: "email",
      taskType: "hot_reply_followup",
      dueAt: new Date(),
      priority: 99,
      status: "pending",
      recommendationText:
        `HOT REPLY — ${params.companyName} showed interest.\n` +
        `Reply: "${params.replySnippet.substring(0, 150)}"\n\n` +
        `Follow-up steps:\n` +
        `• Call after shift\n` +
        `• Ask what type of site they are running\n` +
        `• Ask crew size\n` +
        `• Ask whether they need short-term or monthly setup`,
      lastOutcome: "replied",
      attemptNumber: 1,
    });
    log(`HOT action_queue task created for ${params.companyName}`, TAG);
  } else {
    log(`HOT action_queue task already exists for ${params.companyName} — skipped`, TAG);
  }

  const [flow] = await db.select().from(companyFlows).where(
    and(
      eq(companyFlows.clientId, params.clientId),
      eq(companyFlows.companyId, params.companyId),
      isNull(companyFlows.warmStage),
    )
  ).limit(1);

  if (flow) {
    await db.update(companyFlows).set({
      warmStage: "initial_interest",
      warmStageUpdatedAt: new Date(),
      lastOutcome: "replied",
      updatedAt: new Date(),
    }).where(eq(companyFlows.id, flow.id));
    log(`Set warmStage=initial_interest on flow #${flow.id} for ${params.companyName}`, TAG);
  }

  const smsTo = process.env.INTERNAL_HOT_LEAD_SMS_TO;
  if (smsTo) {
    const smsBody = `HOT LEAD: ${params.companyName}\n${params.replySnippet.substring(0, 120)}`;
    sendSms(smsTo, smsBody).then(smsResult => {
      if (smsResult.success) {
        log(`HOT SMS alert sent to ${smsTo} for ${params.companyName} (SID: ${smsResult.sid})`, TAG);
      } else {
        log(`HOT SMS alert failed for ${params.companyName}: ${smsResult.error}`, TAG);
      }
    }).catch(err => {
      log(`HOT SMS alert error for ${params.companyName}: ${err.message}`, TAG);
    });
  }
}

async function handleNotInterestedReply(params: {
  clientId: string;
  companyId: string;
  companyName: string;
  pipelineId: number;
  reason: string;
}): Promise<void> {
  await db.update(outreachPipeline).set({
    pipelineStatus: "NOT_INTERESTED",
    respondedAt: new Date(),
    respondedVia: "reply_negative",
    updatedAt: new Date(),
  }).where(eq(outreachPipeline.id, params.pipelineId));

  const flows = await db.select().from(companyFlows).where(
    and(
      eq(companyFlows.clientId, params.clientId),
      eq(companyFlows.companyId, params.companyId),
      eq(companyFlows.status, "active"),
    )
  );

  for (const flow of flows) {
    await db.update(companyFlows).set({
      lastOutcome: "not_relevant",
      notes: `Auto-suppressed: reply classified NOT_INTERESTED (${params.reason})`,
      updatedAt: new Date(),
    }).where(eq(companyFlows.id, flow.id));
  }

  log(`NOT_INTERESTED suppression applied for ${params.companyName} (pipeline #${params.pipelineId}): ${params.reason}`, TAG);
}

// IMAP provider presets: derive IMAP host from SMTP host
function deriveImapHost(smtpHost: string): string | null {
  const map: Record<string, string> = {
    "smtp.gmail.com": "imap.gmail.com",
    "smtp.office365.com": "outlook.office365.com",
    "smtp.mail.yahoo.com": "imap.mail.yahoo.com",
    "smtp.zoho.com": "imap.zoho.com",
  };
  return map[smtpHost] || null;
}

// Check replies for a single client
async function checkRepliesForClient(settings: {
  id: number;
  clientId: string;
  smtpHost: string;
  smtpUser: string;
  smtpPass: string;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  fromEmail: string;
  lastReplyCheck: Date | null;
}): Promise<{ repliesFound: number; errors: string[] }> {
  const errors: string[] = [];
  let repliesFound = 0;

  // Determine IMAP connection details
  const imapHost = settings.imapHost || deriveImapHost(settings.smtpHost);
  if (!imapHost) {
    return { repliesFound: 0, errors: [`Cannot derive IMAP host from SMTP host ${settings.smtpHost}. Please configure IMAP settings.`] };
  }
  const imapPort = settings.imapPort || 993;
  const imapSecure = settings.imapSecure !== false;

  // Get all sent emails with message IDs for this client that haven't had replies detected yet
  const sentEmails = await db
    .select()
    .from(emailSends)
    .where(
      and(
        eq(emailSends.clientId, settings.clientId),
        eq(emailSends.status, "sent"),
        isNotNull(emailSends.messageId),
        isNull(emailSends.replyDetectedAt)
      )
    )
    .orderBy(desc(emailSends.sentAt));

  if (sentEmails.length === 0) {
    return { repliesFound: 0, errors: [] };
  }

  // Build a lookup: messageId -> emailSend record
  const messageIdMap = new Map<string, typeof sentEmails[0]>();
  // Also build a lookup: contactEmail -> emailSend records (fallback matching)
  const contactEmailMap = new Map<string, typeof sentEmails[0][]>();

  for (const send of sentEmails) {
    if (send.messageId) {
      // Strip angle brackets for matching
      const cleanId = send.messageId.replace(/^<|>$/g, "");
      messageIdMap.set(cleanId, send);
      messageIdMap.set(send.messageId, send);
    }
    const existing = contactEmailMap.get(send.contactEmail.toLowerCase()) || [];
    existing.push(send);
    contactEmailMap.set(send.contactEmail.toLowerCase(), existing);
  }

  let client: ImapFlow | null = null;

  try {
    client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: imapSecure,
      auth: {
        user: settings.smtpUser,
        pass: settings.smtpPass,
      },
      logger: false,
    });

    await client.connect();

    // Open INBOX
    const mailbox = await client.mailboxOpen("INBOX");
    if (!mailbox) {
      errors.push("Could not open INBOX");
      return { repliesFound, errors };
    }

    // Search for recent emails (last 3 days to catch any we might have missed)
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 3);

    const searchResults = await client.search({
      since: sinceDate,
    });

    if (!searchResults || searchResults.length === 0) {
      await client.logout();
      return { repliesFound: 0, errors: [] };
    }

    // Fetch headers for all matching messages (in batches)
    const batchSize = 50;
    for (let i = 0; i < searchResults.length; i += batchSize) {
      const batch = searchResults.slice(i, i + batchSize);
      const seqRange = batch.join(",");

      try {
        for await (const msg of client.fetch(seqRange, {
          envelope: true,
          headers: ["in-reply-to", "references", "from", "subject", "date", "message-id"],
        })) {
          if (!msg.envelope) continue;

          const inReplyTo = msg.headers?.get("in-reply-to")?.toString().trim() || "";
          const references = msg.headers?.get("references")?.toString().trim() || "";
          const fromAddr = msg.envelope.from?.[0]?.address?.toLowerCase() || "";
          const msgSubject = msg.envelope.subject || "";
          const msgDate = msg.envelope.date || new Date();
          const msgMessageId = msg.envelope.messageId || "";

          // Strategy 1: Match via In-Reply-To header against our stored Message-IDs
          let matchedSend: typeof sentEmails[0] | undefined;

          if (inReplyTo) {
            const cleanReplyTo = inReplyTo.replace(/^<|>$/g, "");
            matchedSend = messageIdMap.get(cleanReplyTo) || messageIdMap.get(inReplyTo);
          }

          // Strategy 2: Check References header (contains thread chain)
          if (!matchedSend && references) {
            const refIds = references.split(/\s+/);
            for (const refId of refIds) {
              const cleanRef = refId.replace(/^<|>$/g, "");
              matchedSend = messageIdMap.get(cleanRef) || messageIdMap.get(refId);
              if (matchedSend) break;
            }
          }

          // Strategy 3: Fallback — match by sender email if it's from a known contact
          if (!matchedSend && fromAddr) {
            const candidateSends = contactEmailMap.get(fromAddr);
            if (candidateSends && candidateSends.length > 0) {
              // Only match if the email came AFTER we sent ours
              const recentSend = candidateSends.find(
                (s) => new Date(msgDate) > new Date(s.sentAt)
              );
              if (recentSend) {
                matchedSend = recentSend;
              }
            }
          }

          if (!matchedSend) continue;

          // Skip if we already have a reply for this email send from this message
          const existingReply = await db
            .select()
            .from(emailReplies)
            .where(
              and(
                eq(emailReplies.emailSendId, matchedSend.id),
                eq(emailReplies.imapMessageId, msgMessageId)
              )
            );
          if (existingReply.length > 0) continue;

          // Skip replies from our own email address (sent folder echo)
          if (fromAddr === settings.fromEmail.toLowerCase()) continue;

          // Record the reply
          await db.insert(emailReplies).values({
            clientId: settings.clientId,
            emailSendId: matchedSend.id,
            outreachPipelineId: matchedSend.outreachPipelineId,
            fromEmail: fromAddr,
            subject: msgSubject,
            snippet: msgSubject ? `Re: ${msgSubject}`.substring(0, 200) : null,
            imapMessageId: msgMessageId,
            inReplyTo: inReplyTo || null,
            receivedAt: new Date(msgDate),
          });

          // Mark the email send as replied
          await db
            .update(emailSends)
            .set({ replyDetectedAt: new Date() })
            .where(eq(emailSends.id, matchedSend.id));

          // Classify reply content
          const replyText = msgSubject || "";
          const replySnippet = replyText ? `Re: ${replyText}`.substring(0, 200) : "";
          const { classification, reason } = classifyReply(msgSubject, replySnippet);
          log(`Reply from ${fromAddr} for ${matchedSend.companyName || matchedSend.companyId} classified as ${classification} (${reason})`, TAG);

          // Auto-pause the outreach sequence
          const [pipeline] = await db
            .select()
            .from(outreachPipeline)
            .where(eq(outreachPipeline.id, matchedSend.outreachPipelineId));

          if (pipeline && pipeline.pipelineStatus === "ACTIVE") {
            if (classification === "NOT_INTERESTED") {
              await handleNotInterestedReply({
                clientId: settings.clientId,
                companyId: matchedSend.companyId,
                companyName: matchedSend.companyName || matchedSend.companyId,
                pipelineId: pipeline.id,
                reason,
              });
            } else {
              await db
                .update(outreachPipeline)
                .set({
                  pipelineStatus: "RESPONDED",
                  respondedAt: new Date(),
                  respondedVia: "reply_detected",
                  updatedAt: new Date(),
                })
                .where(eq(outreachPipeline.id, pipeline.id));
            }

            log(
              `Reply detected from ${fromAddr} for ${matchedSend.companyName || matchedSend.companyId} (touch ${matchedSend.touchNumber}) — ${classification === "NOT_INTERESTED" ? "suppressed" : "sequence paused"}`,
              TAG
            );
          }

          if (classification === "HOT" && pipeline) {
            try {
              await handleHotReply({
                clientId: settings.clientId,
                companyId: matchedSend.companyId,
                companyName: matchedSend.companyName || matchedSend.companyId,
                contactName: matchedSend.contactName || null,
                contactEmail: fromAddr,
                replySnippet,
                emailReplyId: 0,
                pipelineId: pipeline.id,
              });
            } catch (hotErr: any) {
              log(`HOT handler error for ${matchedSend.companyName}: ${hotErr.message}`, TAG);
            }
          }

          repliesFound++;

          // Remove matched send from future matching
          if (matchedSend.messageId) {
            const cleanId = matchedSend.messageId.replace(/^<|>$/g, "");
            messageIdMap.delete(cleanId);
            messageIdMap.delete(matchedSend.messageId);
          }
        }
      } catch (fetchErr: any) {
        errors.push(`Batch fetch error: ${fetchErr.message}`);
      }
    }

    await client.logout();
  } catch (err: any) {
    errors.push(`IMAP connection error: ${err.message}`);
    if (client) {
      try { await client.logout(); } catch {}
    }
  }

  // Update last reply check timestamp
  await db
    .update(clientEmailSettings)
    .set({ lastReplyCheck: new Date(), updatedAt: new Date() })
    .where(eq(clientEmailSettings.id, settings.id));

  return { repliesFound, errors };
}

// Run reply check for all clients with reply checking enabled
export async function runReplyCheck(): Promise<{
  clientsChecked: number;
  totalReplies: number;
  errors: string[];
}> {
  const allSettings = await db
    .select()
    .from(clientEmailSettings)
    .where(
      and(
        eq(clientEmailSettings.enabled, true),
        eq(clientEmailSettings.replyCheckEnabled, true)
      )
    );

  let totalReplies = 0;
  const allErrors: string[] = [];

  for (const settings of allSettings) {
    try {
      const result = await checkRepliesForClient(settings);
      totalReplies += result.repliesFound;
      if (result.errors.length > 0) {
        allErrors.push(...result.errors.map((e) => `[${settings.clientId}] ${e}`));
      }
      if (result.repliesFound > 0) {
        log(`Found ${result.repliesFound} replies for client ${settings.clientId}`, TAG);
      }
    } catch (err: any) {
      allErrors.push(`[${settings.clientId}] Uncaught error: ${err.message}`);
      log(`Reply check failed for client ${settings.clientId}: ${err.message}`, TAG);
    }
  }

  return {
    clientsChecked: allSettings.length,
    totalReplies,
    errors: allErrors,
  };
}

// Get replies for a specific outreach pipeline item
export async function getRepliesForPipeline(outreachPipelineId: number, clientId: string) {
  return db
    .select()
    .from(emailReplies)
    .where(
      and(
        eq(emailReplies.outreachPipelineId, outreachPipelineId),
        eq(emailReplies.clientId, clientId)
      )
    )
    .orderBy(desc(emailReplies.receivedAt));
}

// Start the periodic reply check timer
export function startReplyChecker() {
  if (replyCheckTimer) return;
  log(`Reply checker starting (interval: ${REPLY_CHECK_INTERVAL / 60000} minutes)`, TAG);
  
  // Initial check after 60 seconds
  setTimeout(async () => {
    try {
      const result = await runReplyCheck();
      if (result.clientsChecked > 0) {
        log(
          `Reply check complete: ${result.clientsChecked} clients, ${result.totalReplies} replies found${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""}`,
          TAG
        );
      }
    } catch (err: any) {
      log(`Reply check error: ${err.message}`, TAG);
    }
  }, 60000);

  // Periodic checks
  replyCheckTimer = setInterval(async () => {
    try {
      const result = await runReplyCheck();
      if (result.clientsChecked > 0 && (result.totalReplies > 0 || result.errors.length > 0)) {
        log(
          `Reply check: ${result.totalReplies} replies, ${result.errors.length} errors`,
          TAG
        );
      }
    } catch (err: any) {
      log(`Reply check error: ${err.message}`, TAG);
    }
  }, REPLY_CHECK_INTERVAL);
}

// Stop the periodic reply check timer
export function stopReplyChecker() {
  if (replyCheckTimer) {
    clearInterval(replyCheckTimer);
    replyCheckTimer = null;
    log("Reply checker stopped", TAG);
  }
}
