import { db } from "./db";
import { companyFlows, flowAttempts, actionQueue } from "@shared/schema";
import { eq, and, lte, asc, desc, sql, isNull } from "drizzle-orm";

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
        };
      case "transferred":
        return {
          nextAction: "Log DM call outcome from transfer",
          nextDueAt: now,
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 95,
          spawnFlows: [{ flowType: FLOW_TYPES.DM_CALL, reason: "Transferred by gatekeeper" }],
        };
      case "gave_title_only":
        return {
          nextAction: `Call gatekeeper again — ask for name (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.PAUSED : FLOW_STATUS.ACTIVE,
          priority: 60,
        };
      case "refused":
        return {
          nextAction: attemptCount >= 3 ? "Try alternate approach or move to nurture" : `Try again with different angle (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(attemptCount >= 3 ? 14 : 5),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.RECYCLED : FLOW_STATUS.ACTIVE,
          priority: 30,
        };
      case "asked_to_send_info":
        return {
          nextAction: "Send email with company info, then follow up in 3 days",
          nextDueAt: now,
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 75,
          spawnFlows: [{ flowType: FLOW_TYPES.EMAIL, reason: "Gatekeeper asked to send info" }],
        };
      case "message_taken":
        return {
          nextAction: `Follow up — message was taken (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(3),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 55,
        };
      case "receptionist_answered":
        return {
          nextAction: `Call again and ask for decision maker by department (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 65,
        };
      default:
        return {
          nextAction: `Retry gatekeeper call (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.RECYCLED : FLOW_STATUS.ACTIVE,
          priority: 50,
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
        };
      case "followup_scheduled":
        return {
          nextAction: "Call back at scheduled time",
          nextDueAt: addDays(2),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 85,
        };
      case "live_answer":
        return {
          nextAction: "Follow up on conversation — send relevant info",
          nextDueAt: addDays(2),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 80,
          spawnFlows: [{ flowType: FLOW_TYPES.EMAIL, reason: "Had live conversation" }],
        };
      case "voicemail_left":
        return {
          nextAction: `Retry DM direct call (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.PAUSED : FLOW_STATUS.ACTIVE,
          priority: 60,
        };
      case "asked_to_call_later":
        return {
          nextAction: "Call back as requested",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 80,
        };
      case "wrong_person":
      case "referred_elsewhere":
        return {
          nextAction: "Research correct DM and restart contact flow",
          nextDueAt: addHours(2),
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 70,
          spawnFlows: [{ flowType: FLOW_TYPES.GATEKEEPER, reason: `DM ${getOutcomeLabel(outcome)} — need correct contact` }],
        };
      case "not_relevant":
        return {
          nextAction: "Move to nurture or close",
          nextDueAt: addDays(90),
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 10,
          spawnFlows: [{ flowType: FLOW_TYPES.NURTURE, reason: "DM said not relevant" }],
        };
      default:
        return {
          nextAction: `Retry DM call (attempt ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.RECYCLED : FLOW_STATUS.ACTIVE,
          priority: 50,
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
        };
      case "opened":
      case "clicked":
        return {
          nextAction: `Send next email step (step ${attemptCount + 1})`,
          nextDueAt: addDays(2),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 70,
        };
      case "bounced":
        return {
          nextAction: "Find alternate email address",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.PAUSED,
          priority: 40,
        };
      case "not_relevant":
        return {
          nextAction: "Stop email sequence",
          nextDueAt: addDays(90),
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 10,
        };
      default:
        return {
          nextAction: `Send email step ${attemptCount + 1}`,
          nextDueAt: addDays(3),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.COMPLETED : FLOW_STATUS.ACTIVE,
          priority: 45,
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
        };
      case "connected":
        return {
          nextAction: "Send introductory LinkedIn message",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 65,
        };
      case "connection_requested":
        return {
          nextAction: "Wait for connection acceptance",
          nextDueAt: addDays(5),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 30,
        };
      case "message_sent":
      case "followup_sent":
        return {
          nextAction: "Check for LinkedIn response",
          nextDueAt: addDays(5),
          flowStatus: attemptCount >= maxAttempts ? FLOW_STATUS.COMPLETED : FLOW_STATUS.ACTIVE,
          priority: 35,
        };
      case "profile_found":
      case "viewed":
        return {
          nextAction: "Send LinkedIn connection request",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 50,
        };
      default:
        return {
          nextAction: "Find LinkedIn profile",
          nextDueAt: addDays(1),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 40,
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
        };
      case "closed_lost":
        return {
          nextAction: "No further action",
          nextDueAt: addDays(365),
          flowStatus: FLOW_STATUS.COMPLETED,
          priority: 5,
        };
      default:
        return {
          nextAction: "Send quarterly check-in",
          nextDueAt: addDays(90),
          flowStatus: FLOW_STATUS.ACTIVE,
          priority: 15,
        };
    }
  }

  return {
    nextAction: "Review and determine next step",
    nextDueAt: addDays(1),
    flowStatus: FLOW_STATUS.ACTIVE,
    priority: 50,
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

  await db.update(companyFlows).set({
    attemptCount: newAttemptCount,
    lastOutcome: params.outcome,
    lastAttemptAt: new Date(),
    nextAction: computed.nextAction,
    nextDueAt: callbackDate,
    status: computed.flowStatus,
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

  if (computed.flowStatus === FLOW_STATUS.ACTIVE || computed.flowStatus === FLOW_STATUS.PAUSED) {
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

  return { attempt, nextAction: computed.nextAction, nextDueAt: callbackDate, flowStatus: computed.flowStatus, spawnedFlows };
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
}) {
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
    .orderBy(desc(actionQueue.priority), asc(actionQueue.dueAt));
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
    .orderBy(desc(actionQueue.priority), asc(actionQueue.dueAt));
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
