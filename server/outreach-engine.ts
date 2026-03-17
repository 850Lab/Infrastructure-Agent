import OpenAI from "openai";
import { log } from "./logger";
import { getClientAirtableConfig, scopedFormula } from "./airtable-scoped";
import { storage } from "./storage";
import { getIndustryConfig } from "./config";

function logOutreach(msg: string) {
  log(msg, "outreach-engine");
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const TOUCH_SCHEDULE = [
  { day: 1, type: "call" as const, label: "Qualification Call" },
  { day: 3, type: "email" as const, label: "Follow-up Email" },
  { day: 5, type: "call" as const, label: "Follow-up Call" },
  { day: 7, type: "email" as const, label: "Check-in Email" },
  { day: 10, type: "call" as const, label: "Final Call" },
  { day: 14, type: "email" as const, label: "Final Email" },
];

const PIPELINE_STATUSES = ["ACTIVE", "COMPLETED", "RESPONDED", "NOT_INTERESTED"] as const;

interface CompanyForOutreach {
  id: string;
  companyName: string;
  dmName: string;
  dmTitle: string;
  dmEmail: string;
  dmPhone: string;
  website: string;
  dmStatus: string;
  infoCeilingReached: boolean;
}

async function airtableRequest(path: string, options: RequestInit = {}, config: { apiKey: string; baseId: string }): Promise<any> {
  const url = `https://api.airtable.com/v0/${config.baseId}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function generateOutreachEmails(
  company: CompanyForOutreach,
  touchNumber: 2 | 4 | 6
): Promise<{ subject: string; body: string }> {
  const cfg = getIndustryConfig();
  const touchLabel = touchNumber === 2 ? "follow-up after initial call" : touchNumber === 4 ? "follow-up" : "final outreach";
  const urgency = touchNumber === 6 ? "This is the FINAL email attempt. Create urgency without being pushy." : "";

  const prompt = `You are a B2B sales email writer for the ${cfg.name} industry (${cfg.market} market).
Write a ${touchLabel} email for ${company.companyName}.

CONTEXT:
${company.dmName ? `Decision maker: ${company.dmName}${company.dmTitle ? ` (${company.dmTitle})` : ""}` : "No known decision maker name."}
${company.infoCeilingReached ? "Note: This company has limited available information. Focus on value proposition and qualifying questions." : ""}
${urgency}

Touch ${touchNumber} of 6 in outreach sequence.
${touchNumber > 1 ? "Reference prior outreach attempts naturally without being aggressive." : ""}

TONE: Professional, concise, industry-specific for ${cfg.name}. No spam language.
CRITICAL: Never hallucinate facts about the company. Keep it under 130 words.

Generate a JSON object:
{
  "subject": "Email subject line. Short, specific, no spam words.",
  "body": "Email body text. Max 130 words. Professional but conversational."
}

Return ONLY valid JSON.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty OpenAI response");
    const parsed = JSON.parse(content);
    return { subject: String(parsed.subject || ""), body: String(parsed.body || "") };
  } catch (e: any) {
    logOutreach(`Email generation failed for ${company.companyName}: ${e.message}`);
    return {
      subject: `${company.companyName} — ${touchLabel}`,
      body: `[Auto-generated placeholder — email generation failed: ${e.message.slice(0, 100)}]`,
    };
  }
}

function generateCallScript(company: CompanyForOutreach, touchNumber: 1 | 3 | 5): string {
  const dmRef = company.dmName ? `Ask for ${company.dmName}` : "Ask for the person who handles equipment/facilities decisions";
  const titleRef = company.dmTitle ? ` (${company.dmTitle})` : "";

  if (touchNumber === 1) {
    return `CALL SCRIPT — Touch 1 (Day 1)\n${dmRef}${titleRef}\n\nOpener: "Hi, this is [NAME] with [COMPANY]. We work with contractors like yours on [VALUE PROP]. Wanted to see if this is something worth a quick conversation about — do you have 2 minutes?"\n\nIf unavailable: Leave brief voicemail with value prop and callback number.`;
  }
  if (touchNumber === 3) {
    return `CALL SCRIPT — Touch 3 (Day 5)\n${dmRef}${titleRef}\n\nOpener: "Hi, this is [NAME] again with [COMPANY]. I sent an email a couple days ago about [VALUE PROP] — just wanted to make sure it landed on your radar. Worth a quick chat?"\n\nIf unavailable: Leave voicemail referencing the email.`;
  }
  return `CALL SCRIPT — Touch 5 FINAL CALL (Day 10)\n${dmRef}${titleRef}\n\nOpener: "Hi, this is [NAME] with [COMPANY]. I've reached out a couple times about [VALUE PROP]. This is my last call — if there's any interest, I'd love 5 minutes. If not, no hard feelings."\n\nIf unavailable: Leave final voicemail with callback number.`;
}

export async function populateOutreachPipeline(clientId: string): Promise<{ added: number; skipped: number }> {
  const atConfig = await getClientAirtableConfig(clientId);
  if (!atConfig.apiKey || !atConfig.baseId) {
    throw new Error("Airtable credentials not configured");
  }

  const eligibleRecords: any[] = [];
  const formula = `OR({DM_Status}="DM_READY",{DM_Status}="READY_FOR_OUTREACH")`;

  async function fetchPages(filter: string) {
    let offset: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: "100", filterByFormula: filter });
      if (offset) params.set("offset", offset);
      const data = await airtableRequest(`Companies?${params}`, {}, atConfig);
      eligibleRecords.push(...(data.records || []));
      offset = data.offset;
    } while (offset);
  }

  try {
    await fetchPages(formula);
  } catch (e: any) {
    logOutreach(`Fetch error: ${e.message}`);
    return { added: 0, skipped: 0 };
  }

  logOutreach(`Found ${eligibleRecords.length} eligible companies (DM_READY or READY_FOR_OUTREACH)`);

  let added = 0;
  let skipped = 0;

  for (const rec of eligibleRecords) {
    const f = rec.fields;
    const companyId = rec.id;
    const companyName = String(f.company_name || f.Company_Name || "").trim();

    const existing = await storage.getOutreachPipelineByCompany(companyId, clientId);
    if (existing) {
      skipped++;
      continue;
    }

    const dmName = String(f.Primary_DM_Name || f.primary_dm_name || "").trim();
    const dmTitle = String(f.Primary_DM_Title || f.primary_dm_title || "").trim();
    const dmEmail = String(f.Primary_DM_Email || f.primary_dm_email || "").trim();
    const dmPhone = String(f.Primary_DM_Phone || f.primary_dm_phone || "").trim();
    const website = String(f.Website || f.website || "").trim();
    const dmStatus = String(f.DM_Status || "").trim();
    const infoCeiling = Boolean(f.Info_Ceiling_Reached);

    const company: CompanyForOutreach = {
      id: companyId,
      companyName,
      dmName,
      dmTitle,
      dmEmail,
      dmPhone,
      website,
      dmStatus,
      infoCeilingReached: infoCeiling,
    };

    const now = new Date();

    const touch1Call = generateCallScript(company, 1);
    const touch3Call = generateCallScript(company, 3);
    const touch5Call = generateCallScript(company, 5);

    let touch2Email = "";
    let touch4Email = "";
    let touch6Email = "";

    try {
      const t2 = await generateOutreachEmails(company, 2);
      touch2Email = `Subject: ${t2.subject}\n\n${t2.body}`;
    } catch {
      touch2Email = "[Email generation pending]";
    }

    try {
      const t4 = await generateOutreachEmails(company, 4);
      touch4Email = `Subject: ${t4.subject}\n\n${t4.body}`;
    } catch {
      touch4Email = "[Email generation pending]";
    }

    try {
      const t6 = await generateOutreachEmails(company, 6);
      touch6Email = `Subject: ${t6.subject}\n\n${t6.body}`;
    } catch {
      touch6Email = "[Email generation pending]";
    }

    const firstTouchContent = "Subject: Quick question\n\nHey — are your crews working in the heat right now?";

    await storage.createOutreachPipeline({
      clientId,
      companyId,
      companyName,
      contactName: dmName || null,
      contactEmail: dmEmail || null,
      touch0Email: firstTouchContent,
      firstTouchSent: false,
      touch1Email: touch1Call,
      touch2Call: touch2Email,
      touch3Email: touch3Call,
      touch4Call: touch4Email,
      touch5Email: touch5Call,
      touch6Call: touch6Email,
      pipelineStatus: "ACTIVE",
      nextTouchDate: now,
      touchesCompleted: 0,
    });

    added++;
    logOutreach(`Added ${companyName} to outreach pipeline (contact: ${dmName || "unknown"})`);
  }

  logOutreach(`Outreach pipeline populated: ${added} added, ${skipped} already in pipeline`);
  return { added, skipped };
}

export async function advanceOutreachPipeline(clientId: string): Promise<{
  advanced: number;
  completed: number;
  due: number;
}> {
  const dueItems = await storage.getOutreachPipelinesDue(clientId);
  logOutreach(`${dueItems.length} outreach items due for advancement`);

  let advanced = 0;
  let completed = 0;

  for (const item of dueItems) {
    if (!item.firstTouchSent && item.touch0Email) {
      continue;
    }

    const nextTouch = item.touchesCompleted + 1;

    if (nextTouch > 6) {
      await storage.updateOutreachPipeline(item.id, {
        pipelineStatus: "COMPLETED",
        touchesCompleted: 6,
      });
      completed++;
      logOutreach(`${item.companyName}: sequence COMPLETED (all 6 touches done)`);
      continue;
    }

    const updates: Record<string, any> = {
      touchesCompleted: nextTouch,
    };

    if (nextTouch >= 6) {
      updates.pipelineStatus = "COMPLETED";
      updates.nextTouchDate = new Date();
      completed++;
      logOutreach(`${item.companyName}: Touch ${nextTouch} (${TOUCH_SCHEDULE[nextTouch - 1].label}) — sequence COMPLETED`);
    } else {
      const nextSchedule = TOUCH_SCHEDULE[nextTouch];
      updates.nextTouchDate = addDays(item.createdAt, nextSchedule.day);
      advanced++;
      logOutreach(`${item.companyName}: Touch ${nextTouch} (${TOUCH_SCHEDULE[nextTouch - 1].label}) — next: Touch ${nextTouch + 1} on day ${nextSchedule.day}`);
    }

    await storage.updateOutreachPipeline(item.id, updates);
  }

  logOutreach(`Advancement complete: ${advanced} advanced, ${completed} completed`);
  return { advanced, completed, due: dueItems.length };
}

export async function updateOutreachStatus(
  id: number,
  status: string,
  clientId: string
): Promise<{ success: boolean; message: string }> {
  if (!PIPELINE_STATUSES.includes(status as any)) {
    return { success: false, message: `Invalid status. Must be one of: ${PIPELINE_STATUSES.join(", ")}` };
  }

  const items = await storage.getOutreachPipelines(clientId);
  const item = items.find((i) => i.id === id);
  if (!item) {
    return { success: false, message: "Pipeline item not found" };
  }

  await storage.updateOutreachPipeline(id, { pipelineStatus: status });
  logOutreach(`Pipeline #${id} (${item.companyName}) status updated to ${status}`);
  return { success: true, message: `Status updated to ${status}` };
}

export async function runOutreachEngine(clientId?: string): Promise<{
  populate: { added: number; skipped: number };
  advance: { advanced: number; completed: number; due: number };
}> {
  if (!clientId) {
    const allClients = await storage.getAllClients();
    if (allClients.length > 0) clientId = allClients[0].id;
  }
  if (!clientId) throw new Error("Client context required");

  const populateResult = await populateOutreachPipeline(clientId);
  const advanceResult = await advanceOutreachPipeline(clientId);

  return { populate: populateResult, advance: advanceResult };
}
