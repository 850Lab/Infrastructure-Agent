import { db } from "./db";
import { companyFlows, flowAttempts, actionQueue } from "@shared/schema";
import { eq, and, lte, asc, desc, sql, isNull } from "drizzle-orm";
import { syncOutcomeToAirtable, syncCallToAirtable } from "./airtable-writeback";
import { log } from "./logger";

export const FLOW_TYPES = {
  GATEKEEPER: "gatekeeper",
  DM_CALL: "dm_call",
  EMAIL: "email",
  LINKEDIN: "linkedin",
  NURTURE: "nurture",
} as const;

export const FLOW_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  RECYCLED: "recycled",
} as const;

export const TASK_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  SKIPPED: "skipped",
} as const;

export const GK_OUTCOMES = [
  "no_answer",
  "general_voicemail",
  "receptionist_answered",
  "gave_dm_name",
  "gave_title_only",
  "gave_direct_extension",
  "gave_email",
  "transferred",
  "refused",
  "asked_to_send_info",
  "message_taken",
] as const;

export const DM_OUTCOMES = [
  "no_answer",
  "voicemail_left",
  "live_answer",
  "asked_to_call_later",
  "wrong_person",
  "referred_elsewhere",
  "not_relevant",
  "interested",
  "meeting_requested",
  "followup_scheduled",
] as const;

export const EMAIL_OUTCOMES = [
  "sent",
  "opened",
  "clicked",
  "replied",
  "bounced",
  "not_relevant",
  "interested",
  "followup_needed",
] as const;

export const LINKEDIN_OUTCOMES = [
  "profile_not_found",
  "profile_found",
  "viewed",
  "connection_requested",
  "connected",
  "message_sent",
  "responded",
  "no_response",
  "followup_sent",
] as const;

export const NURTURE_OUTCOMES = [
  "check_in_sent",
  "no_response",
  "responded",
  "reactivated",
  "closed_lost",
] as const;

const FLOW_TYPE_LABELS: Record<string, string> = {
  gatekeeper: "Gatekeeper Discovery",
  dm_call: "DM Direct Call",
  email: "Email Outreach",
  linkedin: "LinkedIn",
  nurture: "Long-Term Nurture",
};

const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No Answer",
  general_voicemail: "General Voicemail",
  receptionist_answered: "Receptionist Answered",
  gave_dm_name: "Gave DM Name",
  gave_title_only: "Gave Title Only",
  gave_direct_extension: "Gave Direct Extension",
  gave_email: "Gave Email",
  transferred: "Transferred",
  refused: "Refused",
  asked_to_send_info: "Asked to Send Info",
  message_taken: "Message Taken",
  voicemail_left: "Voicemail Left",
  live_answer: "Live Answer",
  asked_to_call_later: "Asked to Call Later",
  wrong_person: "Wrong Person",
  referred_elsewhere: "Referred Elsewhere",
  not_relevant: "Not Relevant",
  interested: "Interested",
  meeting_requested: "Meeting Requested",
  followup_scheduled: "Follow-up Scheduled",
  sent: "Sent",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  bounced: "Bounced",
  followup_needed: "Follow-up Needed",
  profile_not_found: "Profile Not Found",
  profile_found: "Profile Found",
  viewed: "Viewed",
  connection_requested: "Connection Requested",
  connected: "Connected",
  message_sent: "Message Sent",
  responded: "Responded",
  no_response: "No Response",
  followup_sent: "Follow-up Sent",
  check_in_sent: "Check-in Sent",
  reactivated: "Reactivated",
  closed_lost: "Closed Lost",
};

export function getOutcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] || outcome;
}

function computeNextAction(flowType: string, outcome: string, attemptCount: number, maxAttempts: number): {
  nextAction: string;
  nextDueAt: Date;
  flowStatus: string;
  priority: number;
  spawnFlows?: Array<{ flowType: string; reason: string }>;
  systemAction: string;
  whyChosen: string;
} {
  const now = new Date();
  const addDays = (d: number) => { const t = new Date(now); t.setDate(t.getDate() + d); return t; };
  const addHours = (h: number) => { const t = new Date(now); t.setHours(t.getHours() + h); return t; };

  if (flowType === FLOW_TYPES.GATEKEEPER) {
    switch (outcome) {
      case "gave_dm_name":
      case "gave_direct_extension":
      case "gave_email":
        return {
          nextAction: "Start DM contact flow with captured info",
          nextDueAt: addHours(1),
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 90,
          spawnFlows: [{ flowType: FLOW_TYPES.DM_CALL, reason: `Gatekeeper ${getOutcomeLabel(outcome)}` }],
          systemAction: "Completed Gatekeeper flow, created DM Direct Call flow",
          whyChosen: "Gatekeeper provided a direct contact — switching to DM outreach",
        };
      case "transferred":
        return {
          nextAction: "Log DM call outcome from transfer",
          nextDueAt: now,
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 95,
          spawnFlows: [{ flowType: FLOW_TYPES.DM_CALL, reason: "Transferred by gatekeeper" }],
          systemAction: "Completed Gatekeeper flow, created DM Call flow",
          whyChosen: "Gatekeeper transferred to decision maker directly",
        };
      case "gave_title_only":
        return {
          nextAction: `Call gatekeeper again — ask for name (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.PAUSED : FLOW_STATUS.ACTIVE,
          priority: 60,
          systemAction: attemptCount >= maxAttempts ? "Paused Gatekeeper flow at max attempts" : "Scheduled retry with refined approach",
          whyChosen: "Got title but not name — need to call back for full contact info",
        };
      case "refused":
        return {
          nextAction: attemptCount >= 3 ? "Try alternate approach or move to nurture" : `Try again with different angle (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(attemptCount >= 3 ? 14 : 5),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.RECYCLED : FLOW_STATUS.ACTIVE,
          priority: 30,
          systemAction: attemptCount >= maxAttempts ? "Recycled Gatekeeper flow — max attempts reached" : "Scheduled retry with longer delay",
          whyChosen: attemptCount >= 3 ? "Multiple refusals — backing off to avoid burning the contact" : "Gatekeeper refused — waiting before trying a different angle",
        };
      case "asked_to_send_info":
        return {
          nextAction: "Send email with company info, then follow up in 3 days",
          nextDueAt: now,
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 75,
          spawnFlows: [{ flowType: FLOW_TYPES.EMAIL, reason: "Gatekeeper asked to send info" }],
          systemAction: "Continued Gatekeeper flow, activated Email flow",
          whyChosen: "Gatekeeper asked for info — email opens the door for follow-up call",
        };
      case "message_taken":
        return {
          nextAction: `Follow up — message was taken (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(3),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 55,
          systemAction: "Scheduled follow-up call in 3 days",
          whyChosen: "Message was taken — following up to check if it was delivered",
        };
      case "receptionist_answered":
        return {
          nextAction: `Call again and ask for decision maker by department (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 65,
          systemAction: "Scheduled next-day callback with department approach",
          whyChosen: "Receptionist answered — trying again with specific department request",
        };
      default:
        return {
          nextAction: `Retry gatekeeper call (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.RECYCLED : FLOW_STATUS.ACTIVE,
          priority: 50,
          systemAction: attemptCount >= maxAttempts ? "Recycled flow after max attempts" : "Scheduled retry in 2 days",
          whyChosen: "No response after multiple touches — retrying with standard spacing",
        };
    }
  }

  if (flowType === FLOW_TYPES.DM_CALL) {
    switch (outcome) {
      case "interested":
      case "meeting_requested":
        return {
          nextAction: outcome === "meeting_requested" ? "Prepare and send proposal/presentation" : "Schedule follow-up call to advance",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 100,
          systemAction: outcome === "meeting_requested" ? "Set highest priority — meeting preparation" : "Set highest priority — advance interested DM",
          whyChosen: outcome === "meeting_requested" ? "Decision maker requested a meeting — strike while hot" : "Decision maker showed interest — advance quickly",
        };
      case "followup_scheduled":
        return {
          nextAction: "Call back at scheduled time",
          nextDueAt: addDays(2),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 85,
          systemAction: "Scheduled callback as agreed",
          whyChosen: "Decision maker requested follow-up — honoring their timing",
        };
      case "live_answer":
        return {
          nextAction: "Follow up on conversation — send relevant info",
          nextDueAt: addDays(2),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 80,
          spawnFlows: [{ flowType: FLOW_TYPES.EMAIL, reason: "Had live conversation" }],
          systemAction: "Activated Email flow to reinforce conversation",
          whyChosen: "Had live conversation — sending supporting info builds credibility",
        };
      case "voicemail_left":
        return {
          nextAction: `Retry DM direct call (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.PAUSED : FLOW_STATUS.ACTIVE,
          priority: 60,
          systemAction: attemptCount >= maxAttempts ? "Paused DM flow at max voicemails" : "Scheduled retry in 2 days",
          whyChosen: "Voicemail left — giving time before next attempt",
        };
      case "asked_to_call_later":
        return {
          nextAction: "Call back as requested",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 80,
          systemAction: "Scheduled callback as requested by DM",
          whyChosen: "DM acknowledged and asked to call back — they're open but busy",
        };
      case "wrong_person":
      case "referred_elsewhere":
        return {
          nextAction: "Research correct DM and restart contact flow",
          nextDueAt: addHours(2),
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 70,
          spawnFlows: [{ flowType: FLOW_TYPES.GATEKEEPER, reason: `DM ${getOutcomeLabel(outcome)} — need correct contact` }],
          systemAction: "Completed DM flow, restarted Gatekeeper discovery",
          whyChosen: `${getOutcomeLabel(outcome)} — need to find the right decision maker`,
        };
      case "not_relevant":
        return {
          nextAction: "Move to nurture or close",
          nextDueAt: addDays(90),
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 10,
          spawnFlows: [{ flowType: FLOW_TYPES.NURTURE, reason: "DM said not relevant" }],
          systemAction: "Completed DM flow, moved to long-term nurture",
          whyChosen: "DM confirmed not relevant right now — nurture keeps the door open",
        };
      default:
        return {
          nextAction: `Retry DM call (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.RECYCLED : FLOW_STATUS.ACTIVE,
          priority: 50,
          systemAction: attemptCount >= maxAttempts ? "Recycled DM flow — max attempts" : "Scheduled retry",
          whyChosen: "No response after multiple touches — standard retry spacing",
        };
    }
  }

  if (flowType === FLOW_TYPES.EMAIL) {
    switch (outcome) {
      case "replied":
      case "interested":
        return {
          nextAction: "Read reply and respond — high priority",
          nextDueAt: now,
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 95,
          systemAction: "Elevated to highest email priority",
          whyChosen: outcome === "replied" ? "Email reply received — respond quickly to maintain momentum" : "Contact expressed interest via email",
        };
      case "opened":
      case "clicked":
        return {
          nextAction: `Send next email step (step ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 70,
          systemAction: "Scheduled next email step",
          whyChosen: `Email was ${outcome} — engagement signal, advancing sequence`,
        };
      case "bounced":
        return {
          nextAction: "Find alternate email address",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.PAUSED,
          priority: 40,
          systemAction: "Paused Email flow — invalid address",
          whyChosen: "Email bounced — need a valid address before continuing",
        };
      case "not_relevant":
        return {
          nextAction: "Stop email sequence",
          nextDueAt: addDays(90),
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 10,
          systemAction: "Completed Email flow",
          whyChosen: "Contact indicated not relevant — stopping sequence",
        };
      default:
        return {
          nextAction: `Send email step ${attemptCount + 1}`,
          nextDueAt: addDays(3),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.COMPLETED : FLOW_STATUS.ACTIVE,
          priority: 45,
          systemAction: attemptCount >= maxAttempts ? "Completed email sequence" : "Scheduled next email",
          whyChosen: "Standard email cadence — spacing for deliverability",
        };
    }
  }

  if (flowType === FLOW_TYPES.LINKEDIN) {
    switch (outcome) {
      case "responded":
        return {
          nextAction: "Reply to LinkedIn message",
          nextDueAt: now,
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 85,
          systemAction: "Elevated priority — LinkedIn response received",
          whyChosen: "Contact responded on LinkedIn — engage immediately",
        };
      case "connected":
        return {
          nextAction: "Send introductory LinkedIn message",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 65,
          systemAction: "Scheduled introductory message",
          whyChosen: "Connection accepted — send intro message while visible",
        };
      case "connection_requested":
        return {
          nextAction: "Wait for connection acceptance",
          nextDueAt: addDays(5),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 30,
          systemAction: "Waiting for connection acceptance",
          whyChosen: "Request sent — LinkedIn requires patience for acceptance",
        };
      case "message_sent":
      case "followup_sent":
        return {
          nextAction: "Check for LinkedIn response",
          nextDueAt: addDays(5),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.COMPLETED : FLOW_STATUS.ACTIVE,
          priority: 35,
          systemAction: attemptCount >= maxAttempts ? "Completed LinkedIn flow" : "Scheduled response check",
          whyChosen: "Message sent — giving time for response before follow-up",
        };
      case "profile_found":
      case "viewed":
        return {
          nextAction: "Send LinkedIn connection request",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 50,
          systemAction: "Scheduled connection request",
          whyChosen: "Profile identified — next step is to connect",
        };
      default:
        return {
          nextAction: "Find LinkedIn profile",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 40,
          systemAction: "Scheduled profile search",
          whyChosen: "Need to locate contact on LinkedIn first",
        };
    }
  }

  if (flowType === FLOW_TYPES.NURTURE) {
    switch (outcome) {
      case "responded":
      case "reactivated":
        return {
          nextAction: "Reactivate into active outreach",
          nextDueAt: now,
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 80,
          spawnFlows: [{ flowType: FLOW_TYPES.GATEKEEPER, reason: "Reactivated from nurture" }],
          systemAction: "Reactivated — started fresh Gatekeeper flow",
          whyChosen: "Nurture contact re-engaged — capitalize on renewed interest",
        };
      case "closed_lost":
        return {
          nextAction: "No further action",
          nextDueAt: addDays(365),
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 5,
          systemAction: "Closed — no further outreach",
          whyChosen: "Marked as lost — removing from active pipeline",
        };
      default:
        return {
          nextAction: "Send quarterly check-in",
          nextDueAt: addDays(90),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 15,
          systemAction: "Scheduled quarterly check-in",
          whyChosen: "Maintaining relationship with periodic touchpoints",
        };
    }
  }

  return {
    nextAction: "Review and determine next step",
    nextDueAt: addDays(1),
    flowStatus: FLOW_STATUS.ACTIVE,
    priority: 50,
    systemAction: "Queued for manual review",
    whyChosen: "Unknown flow type — needs operator decision",
  };
}

export async function logFlowAttempt(params: {
  clientId: string;
  flowId: number;
  companyId: string;
  companyName: string;
  contactId?: string;
  contactName?: string;
  channel: string;
  outcome: string;
  notes?: string;
  callbackAt?: Date;
  capturedInfo?: string;
}) {
  const flow = await db.select().from(companyFlows).where(eq(companyFlows.id, params.flowId)).limit(1);
  if (!flow.length) throw new Error(`Flow ${params.flowId} not found`);

  const currentFlow = flow[0];
  const newAttemptCount = currentFlow.attemptCount + 1;

  const [attempt] = await db.insert(flowAttempts).values({
    clientId: params.clientId,
    flowId: params.flowId,
    companyId: params.companyId,
    companyName: params.companyName,
    contactId: params.contactId || null,
    contactName: params.contactName || null,
    channel: params.channel,
    attemptNumber: newAttemptCount,
    outcome: params.outcome,
    notes: params.notes || null,
    callbackAt: params.callbackAt || null,
    capturedInfo: params.capturedInfo || null,
  }).returning();

  const computed = computeNextAction(
    currentFlow.flowType,
    params.outcome,
    newAttemptCount,
    currentFlow.maxAttempts,
  );

  const callbackDate = params.callbackAt || computed.nextDueAt;

  const finalStatus = computed.flowStatus;

  await db.update(companyFlows).set({
    attemptCount: newAttemptCount,
    lastOutcome: params.outcome,
    lastAttemptAt: new Date(),
    nextAction: computed.nextAction,
    nextDueAt: callbackDate,
    status: finalStatus,
    priority: computed.priority,
    updatedAt: new Date(),
  }).where(eq(companyFlows.id, params.flowId));

  await db.update(actionQueue).set({
    status: TASK_STATUS.COMPLETED,
    completedAt: new Date(),
  }).where(
    and(
      eq(actionQueue.flowId, params.flowId),
      eq(actionQueue.status, TASK_STATUS.PENDING),
    )
  );

  if (finalStatus === FLOW_STATUS.ACTIVE || finalStatus === FLOW_STATUS.PAUSED) {
    await db.insert(actionQueue).values({
      clientId: params.clientId,
      companyId: params.companyId,
      companyName: params.companyName,
      contactId: params.contactId || null,
      contactName: params.contactName || null,
      flowId: params.flowId,
      flowType: currentFlow.flowType,
      taskType: currentFlow.flowType === FLOW_TYPES.GATEKEEPER ? "gatekeeper_call" :
                currentFlow.flowType === FLOW_TYPES.DM_CALL ? "dm_call" :
                currentFlow.flowType === FLOW_TYPES.EMAIL ? "send_email" :
                currentFlow.flowType === FLOW_TYPES.LINKEDIN ? "linkedin_action" : "nurture_check",
      dueAt: callbackDate,
      priority: computed.priority,
      status: TASK_STATUS.PENDING,
      recommendationText: computed.nextAction,
      lastOutcome: params.outcome,
      attemptNumber: newAttemptCount + 1,
    });
  }

  const isTerminal = finalStatus === FLOW_STATUS.RECYCLED || finalStatus === FLOW_STATUS.COMPLETED || finalStatus === FLOW_STATUS.PAUSED;
  const atMaxAttempts = newAttemptCount >= currentFlow.maxAttempts;
  const alreadySpawning = computed.spawnFlows && computed.spawnFlows.length > 0;
  const isNurtureFlow = currentFlow.flowType === FLOW_TYPES.NURTURE;

  if (isTerminal && atMaxAttempts && !alreadySpawning && !isNurtureFlow) {
    log(`Flow #${params.flowId} (${currentFlow.flowType}) reached max attempts (${newAttemptCount}/${currentFlow.maxAttempts}) — auto-spawning nurture for ${params.companyName}`, "flow-engine");
    if (!computed.spawnFlows) (computed as any).spawnFlows = [];
    computed.spawnFlows!.push({ flowType: FLOW_TYPES.NURTURE, reason: `${currentFlow.flowType} exhausted max attempts` });
  }

  const spawnedFlows: number[] = [];
  if (computed.spawnFlows) {
    for (const sf of computed.spawnFlows) {
      const spawned = await createFlow({
        clientId: params.clientId,
        companyId: params.companyId,
        companyName: params.companyName,
        contactId: params.contactId,
        contactName: params.contactName,
        flowType: sf.flowType,
        notes: sf.reason,
      });
      spawnedFlows.push(spawned.id);
    }
  }

  const isCallType = currentFlow.flowType === FLOW_TYPES.GATEKEEPER || currentFlow.flowType === FLOW_TYPES.DM_CALL;
  syncOutcomeToAirtable({
    companyId: params.companyId,
    companyName: params.companyName,
    flowType: currentFlow.flowType,
    channel: params.channel,
    outcome: params.outcome,
    contactName: params.contactName,
    contactId: params.contactId,
    capturedInfo: params.capturedInfo,
    nextAction: computed.nextAction,
    nextDueAt: callbackDate,
    flowStatus: computed.flowStatus,
    isCallType,
  }).catch(e => log(`Airtable write-back failed (non-blocking): ${e.message}`, "flow-engine"));

  if (isCallType) {
    syncCallToAirtable({
      companyName: params.companyName,
      phone: "",
      callDate: new Date(),
    }).catch(e => log(`Calls table sync failed (non-blocking): ${e.message}`, "flow-engine"));
  }

  const stateChanges: string[] = [];
  if (finalStatus !== currentFlow.status) {
    const flowLabel = FLOW_TYPE_LABELS[currentFlow.flowType] || currentFlow.flowType;
    stateChanges.push(`${flowLabel} flow ${finalStatus === "completed" ? "completed" : finalStatus === "recycled" ? "recycled" : finalStatus === "paused" ? "paused" : "updated"}`);
  }
  if (computed.spawnFlows) {
    for (const sf of computed.spawnFlows) {
      stateChanges.push(`New ${FLOW_TYPE_LABELS[sf.flowType] || sf.flowType} flow created`);
    }
  }
  stateChanges.push("New task created in action queue");
  if (params.capturedInfo) stateChanges.push("Contact info captured");
  stateChanges.push("Airtable company status updated");

  return {
    attempt,
    nextAction: computed.nextAction,
    nextDueAt: callbackDate,
    flowStatus: computed.flowStatus,
    spawnedFlows,
    explanation: {
      outcomeLabel: getOutcomeLabel(params.outcome),
      systemAction: computed.systemAction,
      whyChosen: computed.whyChosen,
      stateChanges,
      flowType: currentFlow.flowType,
      flowLabel: FLOW_TYPE_LABELS[currentFlow.flowType] || currentFlow.flowType,
    },
  };
}

export async function checkDuplicateFlow(params: {
  clientId: string;
  companyId: string;
  flowType: string;
  contactId?: string;
}): Promise<{ isDuplicate: boolean; existingFlowId?: number; existingStatus?: string }> {
  const conditions = [
    eq(companyFlows.clientId, params.clientId),
    eq(companyFlows.companyId, params.companyId),
    eq(companyFlows.flowType, params.flowType),
    sql`${companyFlows.status} IN ('active', 'paused')`,
  ];

  if (params.flowType === FLOW_TYPES.DM_CALL && params.contactId) {
    conditions.push(eq(companyFlows.contactId, params.contactId));
  }

  const existing = await db.select({ id: companyFlows.id, status: companyFlows.status })
    .from(companyFlows)
    .where(and(...conditions))
    .limit(1);

  if (existing.length > 0) {
    return { isDuplicate: true, existingFlowId: existing[0].id, existingStatus: existing[0].status };
  }
  return { isDuplicate: false };
}

export async function createFlow(params: {
  clientId: string;
  companyId: string;
  companyName: string;
  contactId?: string;
  contactName?: string;
  flowType: string;
  notes?: string;
  priority?: number;
  skipDuplicateCheck?: boolean;
}) {
  if (!params.skipDuplicateCheck) {
    const dupCheck = await checkDuplicateFlow({
      clientId: params.clientId,
      companyId: params.companyId,
      flowType: params.flowType,
      contactId: params.contactId,
    });
    if (dupCheck.isDuplicate) {
      log(`Duplicate flow blocked: ${params.flowType} for ${params.companyName} (existing flow #${dupCheck.existingFlowId}, status: ${dupCheck.existingStatus})`, "flow-engine");
      const existingFlow = await db.select().from(companyFlows).where(eq(companyFlows.id, dupCheck.existingFlowId!)).limit(1);
      if (existingFlow.length > 0) return existingFlow[0];
      throw new Error(`Duplicate active ${params.flowType} flow already exists for this company`);
    }
  }

  const maxAttempts = params.flowType === FLOW_TYPES.EMAIL ? 5 :
                      params.flowType === FLOW_TYPES.LINKEDIN ? 6 :
                      params.flowType === FLOW_TYPES.NURTURE ? 4 : 6;

  const taskType = params.flowType === FLOW_TYPES.GATEKEEPER ? "gatekeeper_call" :
                   params.flowType === FLOW_TYPES.DM_CALL ? "dm_call" :
                   params.flowType === FLOW_TYPES.EMAIL ? "send_email" :
                   params.flowType === FLOW_TYPES.LINKEDIN ? "linkedin_action" : "nurture_check";

  const firstAction = params.flowType === FLOW_TYPES.GATEKEEPER ? "Call company and identify decision maker" :
                      params.flowType === FLOW_TYPES.DM_CALL ? "Call decision maker directly" :
                      params.flowType === FLOW_TYPES.EMAIL ? "Send introductory email" :
                      params.flowType === FLOW_TYPES.LINKEDIN ? "Find LinkedIn profile" :
                      "Schedule quarterly check-in";

  const dueAt = new Date();
  const basePriority = params.priority || (params.flowType === FLOW_TYPES.GATEKEEPER ? 70 :
                        params.flowType === FLOW_TYPES.DM_CALL ? 80 :
                        params.flowType === FLOW_TYPES.EMAIL ? 50 :
                        params.flowType === FLOW_TYPES.LINKEDIN ? 40 : 20);

  const [flow] = await db.insert(companyFlows).values({
    clientId: params.clientId,
    companyId: params.companyId,
    companyName: params.companyName,
    contactId: params.contactId || null,
    contactName: params.contactName || null,
    flowType: params.flowType,
    status: FLOW_STATUS.ACTIVE,
    stage: 1,
    attemptCount: 0,
    maxAttempts,
    nextAction: firstAction,
    nextDueAt: dueAt,
    priority: basePriority,
    notes: params.notes || null,
  }).returning();

  await db.insert(actionQueue).values({
    clientId: params.clientId,
    companyId: params.companyId,
    companyName: params.companyName,
    contactId: params.contactId || null,
    contactName: params.contactName || null,
    flowId: flow.id,
    flowType: params.flowType,
    taskType,
    dueAt,
    priority: basePriority,
    status: TASK_STATUS.PENDING,
    recommendationText: firstAction,
    attemptNumber: 1,
  });

  return flow;
}

export async function getTodayActions(clientId: string) {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return db.select()
    .from(actionQueue)
    .where(
      and(
        eq(actionQueue.clientId, clientId),
        eq(actionQueue.status, TASK_STATUS.PENDING),
        lte(actionQueue.dueAt, endOfDay),
      )
    )
    .orderBy(
      sql`CASE WHEN ${actionQueue.dueAt} < NOW() THEN 0 ELSE 1 END`,
      desc(actionQueue.priority),
      asc(actionQueue.dueAt),
    );
}

export async function getAllPendingActions(clientId: string) {
  return db.select()
    .from(actionQueue)
    .where(
      and(
        eq(actionQueue.clientId, clientId),
        eq(actionQueue.status, TASK_STATUS.PENDING),
      )
    )
    .orderBy(
      sql`CASE WHEN ${actionQueue.dueAt} < NOW() THEN 0 ELSE 1 END`,
      desc(actionQueue.priority),
      asc(actionQueue.dueAt),
    );
}

export async function getCompanyFlows(clientId: string, companyId: string) {
  return db.select()
    .from(companyFlows)
    .where(
      and(
        eq(companyFlows.clientId, clientId),
        eq(companyFlows.companyId, companyId),
      )
    )
    .orderBy(desc(companyFlows.updatedAt));
}

export async function getFlowAttemptHistory(flowId: number) {
  return db.select()
    .from(flowAttempts)
    .where(eq(flowAttempts.flowId, flowId))
    .orderBy(desc(flowAttempts.createdAt));
}

export async function getActionQueueStats(clientId: string) {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const todayActions = await db.select({ count: sql<number>`count(*)::int` })
    .from(actionQueue)
    .where(and(
      eq(actionQueue.clientId, clientId),
      eq(actionQueue.status, TASK_STATUS.PENDING),
      lte(actionQueue.dueAt, endOfDay),
    ));

  const callsDue = await db.select({ count: sql<number>`count(*)::int` })
    .from(actionQueue)
    .where(and(
      eq(actionQueue.clientId, clientId),
      eq(actionQueue.status, TASK_STATUS.PENDING),
      lte(actionQueue.dueAt, endOfDay),
      sql`${actionQueue.taskType} IN ('gatekeeper_call', 'dm_call')`,
    ));

  const emailsDue = await db.select({ count: sql<number>`count(*)::int` })
    .from(actionQueue)
    .where(and(
      eq(actionQueue.clientId, clientId),
      eq(actionQueue.status, TASK_STATUS.PENDING),
      lte(actionQueue.dueAt, endOfDay),
      eq(actionQueue.taskType, "send_email"),
    ));

  const linkedinDue = await db.select({ count: sql<number>`count(*)::int` })
    .from(actionQueue)
    .where(and(
      eq(actionQueue.clientId, clientId),
      eq(actionQueue.status, TASK_STATUS.PENDING),
      lte(actionQueue.dueAt, endOfDay),
      eq(actionQueue.taskType, "linkedin_action"),
    ));

  const activeFlows = await db.select({ count: sql<number>`count(*)::int` })
    .from(companyFlows)
    .where(and(
      eq(companyFlows.clientId, clientId),
      eq(companyFlows.status, FLOW_STATUS.ACTIVE),
    ));

  const overdue = await db.select({ count: sql<number>`count(*)::int` })
    .from(actionQueue)
    .where(and(
      eq(actionQueue.clientId, clientId),
      eq(actionQueue.status, TASK_STATUS.PENDING),
      sql`${actionQueue.dueAt} < NOW()`,
    ));

  const completedThisWeek = await db.select({ count: sql<number>`count(*)::int` })
    .from(flowAttempts)
    .where(and(
      eq(flowAttempts.clientId, clientId),
      sql`${flowAttempts.createdAt} >= ${startOfWeek}`,
    ));

  const flowsByType = await db.select({
    flowType: actionQueue.flowType,
    count: sql<number>`count(*)::int`,
  })
    .from(actionQueue)
    .where(and(
      eq(actionQueue.clientId, clientId),
      eq(actionQueue.status, TASK_STATUS.PENDING),
      lte(actionQueue.dueAt, endOfDay),
    ))
    .groupBy(actionQueue.flowType);

  return {
    todayTotal: todayActions[0]?.count || 0,
    callsDue: callsDue[0]?.count || 0,
    emailsDue: emailsDue[0]?.count || 0,
    linkedinDue: linkedinDue[0]?.count || 0,
    activeFlows: activeFlows[0]?.count || 0,
    overdue: overdue[0]?.count || 0,
    completedThisWeek: completedThisWeek[0]?.count || 0,
    flowsByType: flowsByType.reduce((acc, r) => { acc[r.flowType] = r.count; return acc; }, {} as Record<string, number>),
  };
}

export async function seedFlowsFromTodayList(clientId: string, companies: Array<{
  id: string;
  company_name: string;
  phone?: string;
  city?: string;
  category?: string;
  bucket?: string;
  offer_dm_name?: string;
  offer_dm_phone?: string;
  offer_dm_email?: string;
  primary_dm_name?: string;
}>) {
  let created = 0;
  for (const co of companies) {
    const existing = await db.select({ id: companyFlows.id })
      .from(companyFlows)
      .where(and(
        eq(companyFlows.clientId, clientId),
        eq(companyFlows.companyId, co.id),
        eq(companyFlows.status, FLOW_STATUS.ACTIVE),
      ))
      .limit(1);

    if (existing.length > 0) continue;

    const hasDM = !!(co.offer_dm_name || co.primary_dm_name);
    const flowType = hasDM ? FLOW_TYPES.DM_CALL : FLOW_TYPES.GATEKEEPER;
    const contactName = co.offer_dm_name || co.primary_dm_name || undefined;

    await createFlow({
      clientId,
      companyId: co.id,
      companyName: co.company_name,
      contactName,
      flowType,
      priority: co.bucket === "Hot Follow-up" ? 90 : co.bucket === "Working" ? 70 : 50,
    });

    created++;
  }
  return { created };
}
