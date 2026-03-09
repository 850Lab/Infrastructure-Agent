import OpenAI from "openai";
import { getIndustryConfig } from "./config";
import { log } from "./logger";
import type { IndustryConfig } from "../config/types";
import { scopedFormula } from "./airtable-scoped";
import { buildScriptEvolutionContext, type ScriptEvolutionContext } from "./sales-learning/script-evolution";
import { saveScriptVersion } from "./sales-learning/script-versioning";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const PLAYBOOK_VERSION = "v1";
const STALE_DAYS = 7;

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface CallAnalysisContext {
  transcription: string;
  analysis: string;
  problemDetected: string | null;
  proposedPatchType: string | null;
  confidence: string | null;
  outcome: string;
}

interface PlaybookCompany {
  id: string;
  companyName: string;
  bucket: string;
  primaryDMName: string;
  primaryDMTitle: string;
  primaryDMEmail: string;
  primaryDMPhone: string;
  offerDMName: string;
  offerDMTitle: string;
  offerDMEmail: string;
  offerDMPhone: string;
  offerDMReason: string;
  gatekeeperName: string;
  rankReason: string;
  rankEvidence: string;
  opportunityType: string;
  opportunitySignal: string;
  opportunityScore: number;
  engagementScore: number;
  timesCalled: number;
  lastOutcome: string;
  followupDue: string | null;
  notes: string;
  playbookVersion: string;
  playbookLastGenerated: string | null;
  rankVersion: string;
  configName: string;
  lastCallAnalysis: CallAnalysisContext | null;
  evolutionContext: ScriptEvolutionContext | null;
}

interface PlaybookOutput {
  call_opener: string;
  gatekeeper_ask: string;
  voicemail: string;
  email_subject: string;
  email_body: string;
  followup_text: string;
}

export interface PlaybookResult {
  generated: number;
  skipped: number;
  errors: number;
  details: Array<{
    companyName: string;
    status: "generated" | "skipped" | "error";
    callOpener?: string;
    gatekeeperAsk?: string;
  }>;
}

function logPB(message: string) {
  log(message, "playbooks");
}

async function airtableRequest(path: string, options: RequestInit = {}): Promise<any> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) throw new Error("Airtable credentials not configured");
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
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

async function fetchCallAnalysisForCompanies(companyNames: string[], clientId?: string): Promise<Map<string, CallAnalysisContext>> {
  const map = new Map<string, CallAnalysisContext>();
  if (companyNames.length === 0) return map;

  try {
    const table = encodeURIComponent("Calls");
    const baseFormula = `AND({Transcription}!='',{Analysis}!='',{Company}!='')`;
    const fields = ["Company", "Transcription", "Analysis", "Outcome", "Call_Time"];
    const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

    const fetchPages = async (useScope: boolean) => {
      const formula = encodeURIComponent(useScope && clientId ? scopedFormula(clientId, baseFormula) : baseFormula);
      let offset: string | undefined;
      const allCalls: Array<{ company: string; callTime: string; ctx: CallAnalysisContext }> = [];
      do {
        let url = `${table}?pageSize=100&filterByFormula=${formula}&sort[0][field]=Call_Time&sort[0][direction]=desc&${fieldParams}`;
        if (offset) url += `&offset=${offset}`;
        const data = await airtableRequest(url);
        for (const rec of data.records || []) {
          const f = rec.fields;
          const company = String(f.Company || "").trim().toLowerCase();
          if (!company) continue;
          allCalls.push({
            company,
            callTime: String(f.Call_Time || ""),
            ctx: {
              transcription: String(f.Transcription || ""),
              analysis: String(f.Analysis || ""),
              problemDetected: f.Problem_Detected || null,
              proposedPatchType: f.Proposed_Patch_Type || null,
              confidence: f.Analysis_Confidence || null,
              outcome: String(f.Outcome || ""),
            },
          });
        }
        offset = data.offset;
      } while (offset);
      return allCalls;
    };

    let allCalls;
    try {
      allCalls = await fetchPages(!!clientId);
    } catch (innerErr: any) {
      if (clientId && (innerErr.message.includes("INVALID_FILTER") || innerErr.message.includes("UNKNOWN_FIELD") || innerErr.message.includes("Unknown field"))) {
        const { markClientIdMissing } = await import("./airtable-scoped");
        markClientIdMissing();
        allCalls = await fetchPages(false);
      } else {
        throw innerErr;
      }
    }

    for (const call of allCalls) {
      if (!map.has(call.company)) {
        map.set(call.company, call.ctx);
      }
    }
  } catch (e: any) {
    logPB(`Failed to fetch call analysis context: ${e.message}`);
  }

  return map;
}

async function fetchTodayListCompanies(clientId?: string): Promise<PlaybookCompany[]> {
  const table = encodeURIComponent("Companies");
  const baseFormula = `{Today_Call_List}=TRUE()`;
  const companies: PlaybookCompany[] = [];

  const fetchPages = async (useScope: boolean) => {
    companies.length = 0;
    const formula = encodeURIComponent(useScope && clientId ? scopedFormula(clientId, baseFormula) : baseFormula);
    let offset: string | undefined;
    do {
      let params = `?pageSize=100&filterByFormula=${formula}`;
      if (offset) params += `&offset=${offset}`;
      const data = await airtableRequest(`${table}${params}`);
      for (const rec of data.records || []) {
        const f = rec.fields;
        companies.push({
          id: rec.id,
          companyName: String(f.company_name || f.Company_Name || "").trim(),
          bucket: String(f.Bucket || "").trim(),
          primaryDMName: String(f.Primary_DM_Name || "").trim(),
          primaryDMTitle: String(f.Primary_DM_Title || "").trim(),
          primaryDMEmail: String(f.Primary_DM_Email || "").trim(),
          primaryDMPhone: String(f.Primary_DM_Phone || "").trim(),
          offerDMName: String(f.Offer_DM_Name || "").trim(),
          offerDMTitle: String(f.Offer_DM_Title || "").trim(),
          offerDMEmail: String(f.Offer_DM_Email || "").trim(),
          offerDMPhone: String(f.Offer_DM_Phone || "").trim(),
          offerDMReason: String(f.Offer_DM_Reason || "").trim(),
          gatekeeperName: String(f.Gatekeeper_Name || "").trim(),
          rankReason: String(f.Rank_Reason || "").trim(),
          rankEvidence: String(f.Rank_Evidence || "").trim(),
          opportunityType: String(f.Opportunity_Type || "").trim(),
          opportunitySignal: String(f.Opportunity_Signal || "").trim(),
          opportunityScore: parseInt(f.Opportunity_Score || "0", 10) || 0,
          engagementScore: parseInt(f.Engagement_Score || "0", 10) || 0,
          timesCalled: parseInt(f.Times_Called || "0", 10) || 0,
          lastOutcome: String(f.Last_Outcome || "").trim(),
          followupDue: f.Followup_Due || null,
          notes: String(f.Notes || f.Opportunity_Notes || "").trim(),
          playbookVersion: String(f.Playbook_Version || "").trim(),
          playbookLastGenerated: f.Playbook_Last_Generated || null,
          rankVersion: String(f.Rank_Version || "").trim(),
          configName: String(f._Playbook_Config || "").trim(),
          lastCallAnalysis: null,
          evolutionContext: null,
        });
      }
      offset = data.offset;
    } while (offset);
  };

  try {
    await fetchPages(!!clientId);
  } catch (e: any) {
    if (clientId && (e.message.includes("INVALID_FILTER") || e.message.includes("UNKNOWN_FIELD") || e.message.includes("Unknown field"))) {
      const { markClientIdMissing } = await import("./airtable-scoped");
      markClientIdMissing();
      await fetchPages(false);
    } else {
      throw e;
    }
  }

  return companies;
}

function shouldGenerate(c: PlaybookCompany, force: boolean, currentConfigName: string): boolean {
  if (force) return true;
  if (c.playbookVersion !== PLAYBOOK_VERSION) return true;
  if (c.rankVersion && c.configName && c.configName !== currentConfigName) return true;
  if (!c.playbookLastGenerated) return true;

  if (c.lastCallAnalysis?.problemDetected) return true;

  const genDate = new Date(c.playbookLastGenerated);
  const daysSince = (Date.now() - genDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > STALE_DAYS) return true;

  return false;
}

function buildPrompt(c: PlaybookCompany, cfg: IndustryConfig): string {
  const bestDMName = c.offerDMName || c.primaryDMName;
  const bestDMTitle = c.offerDMName ? c.offerDMTitle : c.primaryDMTitle;

  const dmSection = bestDMName
    ? `Decision maker: ${bestDMName}${bestDMTitle ? ` (${bestDMTitle})` : ""}. Address them by name.${c.offerDMName ? ` (Selected for offer fit: ${c.offerDMReason || "best match for this offer"})` : ""}`
    : `No known decision maker. Ask for the ${cfg.decision_maker_titles_tiers.tier1[0] || "owner"} by title.`;

  const gkSection = c.gatekeeperName
    ? `Gatekeeper known: ${c.gatekeeperName}. Reference them naturally (e.g. "Hey ${c.gatekeeperName}, can you connect me with…").`
    : "No known gatekeeper.";

  let bucketGuidance = "";
  if (c.bucket === "Hot Follow-up") {
    bucketGuidance = `This is a HOT FOLLOW-UP. The caller is following up on prior contact. Lead with follow-up context like "calling back as promised" or "following up on our conversation." Do NOT invent details about what was discussed — keep it general.`;
    if (c.followupDue) {
      bucketGuidance += ` Follow-up was due: ${c.followupDue.split("T")[0]}.`;
    }
    if (c.lastOutcome) {
      bucketGuidance += ` Last call outcome: ${c.lastOutcome}.`;
    }
  } else if (c.bucket === "Working") {
    bucketGuidance = `This is a WORKING lead with prior engagement. Lead with relevance and timing. Reference the company's fit without inventing specifics.`;
  } else {
    bucketGuidance = `This is a FRESH lead (first contact). Lead with pattern-based relevance using industry keywords. Include a quick qualification question.`;
  }

  const evidenceSection = c.rankEvidence
    ? `Evidence from ranking:\n${c.rankEvidence}`
    : "";

  const opportunitySection = (c.opportunityType || c.opportunitySignal)
    ? `Opportunity: ${[c.opportunityType, c.opportunitySignal].filter(Boolean).join(" — ")}`
    : "";

  const notesSection = c.notes ? `Company notes: ${c.notes}` : "";

  let callAnalysisSection = "";
  if (c.lastCallAnalysis) {
    const a = c.lastCallAnalysis;
    callAnalysisSection = `\nCALL ANALYSIS FROM LAST RECORDING (CRITICAL — adapt scripts based on this):`;
    callAnalysisSection += `\nLast call outcome: ${a.outcome}`;
    if (a.problemDetected) {
      callAnalysisSection += `\nPROBLEM DETECTED: ${a.problemDetected}`;
      callAnalysisSection += `\nPatch type needed: ${a.proposedPatchType}`;
      callAnalysisSection += `\nConfidence: ${a.confidence}`;
      if (a.proposedPatchType === "add_gatekeeper_redirect_line") {
        callAnalysisSection += `\nThe caller accepted a containment deflection (e.g., "just send info") without redirecting to an authority. The gatekeeper script MUST include a redirect line like "I understand — before I do, who typically handles [service area] decisions? I want to make sure the right person sees this."`;
      }
    }
    if (a.analysis) {
      const analysisPreview = a.analysis.length > 500 ? a.analysis.slice(0, 500) + "..." : a.analysis;
      callAnalysisSection += `\nAnalysis summary:\n${analysisPreview}`;
    }
  }

  let evolutionSection = "";
  if (c.evolutionContext?.promptInjection) {
    evolutionSection = c.evolutionContext.promptInjection;
  }

  return `You are a B2B sales script writer for the ${cfg.name} industry (${cfg.market} market).
Write outreach scripts for calling ${c.companyName}.

CONTEXT:
${dmSection}
${gkSection}
${bucketGuidance}
${evidenceSection}
${opportunitySection}
${notesSection}${callAnalysisSection}${evolutionSection}
Engagement score: ${c.engagementScore}. Times called: ${c.timesCalled}.

TONE: Confident, concise, operator voice. Industry-specific language for ${cfg.name}.
CRITICAL: Never hallucinate facts. Only reference evidence that appears above. Use company name and any known names naturally.

Generate a JSON object with these 6 fields: call_opener, gatekeeper_ask, voicemail, email_subject, email_body, followup_text.

SCRIPT FORMAT RULES:
- call_opener and gatekeeper_ask must be FULL CONVERSATION GUIDES, not just opening lines.
- Structure each script as multiple stages separated by double newlines (\\n\\n).
- Start each stage with an ALL CAPS LABEL followed by a colon, then the spoken script.
- DO NOT include any meta-instructions, format descriptions, or preambles. Start directly with "OPENER:" as the first words.

CALL_OPENER REQUIRED STAGES (separate each with \\n\\n):
OPENER: ${bestDMName ? `Address ${bestDMName} by name.` : `Ask for the ${cfg.decision_maker_titles_tiers.tier1[0] || "person in charge"}.`} Introduce yourself and state why you are calling. 2-3 sentences.
IF THEY SHOW INTEREST: Build on their interest and transition to qualifying. 2-3 sentences.
QUALIFYING QUESTIONS: 2-3 specific questions to determine fit (crew size, current solution, timeline, pain points). Write as a numbered list.
HANDLE OBJECTIONS: Write 3 common objections each starting with a dash, followed by the response. Cover: "We already have a vendor", "Not in the budget", "Just send me info".
THE ASK: How to close — request a meeting, demo, or site visit with a specific proposed time. 2 sentences.
IF THEY SAY NO: Graceful exit that leaves the door open. 1-2 sentences.

GATEKEEPER_ASK REQUIRED STAGES (separate each with \\n\\n):
OPENER: ${c.gatekeeperName ? `Address ${c.gatekeeperName} by name.` : "Greet professionally."} ${bestDMName ? `Ask to speak with ${bestDMName}.` : `Ask for the ${cfg.decision_maker_titles_tiers.tier1[0] || "person in charge"}.`} 1-2 sentences.
IF THEY ASK WHY: Brief, confident reason for calling. Sound like a peer, not a salesperson. 1-2 sentences.
IF THEY BLOCK: Redirect strategy — ask for the right person by title, offer to leave a message, or ask for their email. 2-3 sentences.
IF DM IS UNAVAILABLE: Ask for best time to call back, try to get DM's direct line or email. 1-2 sentences.

OTHER FIELDS:
- voicemail: 20-30 seconds spoken. Name, company, reason, one compelling callback reason, [YOUR_NUMBER], name again.
- email_subject: Short, specific subject line. No spam words.
- email_body: Follow-up email. Max 130 words. Professional but conversational.
- followup_text: SMS/text message. Max 240 characters.

Return ONLY valid JSON, no markdown formatting.`;
}

async function generatePlaybook(c: PlaybookCompany, cfg: IndustryConfig): Promise<PlaybookOutput> {
  const prompt = buildPrompt(c, cfg);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty OpenAI response");

  const parsed = JSON.parse(content);

  function flattenField(val: any): string {
    if (typeof val === "string") return val;
    if (val && typeof val === "object") {
      if (Array.isArray(val)) return val.map(flattenField).join("\n\n");
      return Object.entries(val)
        .map(([k, v]) => {
          const label = k.replace(/_/g, " ").toUpperCase().trim();
          return `${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`;
        })
        .join("\n\n");
    }
    return String(val || "");
  }

  return {
    call_opener: flattenField(parsed.call_opener),
    gatekeeper_ask: flattenField(parsed.gatekeeper_ask),
    voicemail: flattenField(parsed.voicemail),
    email_subject: flattenField(parsed.email_subject),
    email_body: flattenField(parsed.email_body),
    followup_text: flattenField(parsed.followup_text).slice(0, 240),
  };
}

async function writePlaybook(
  companyId: string,
  playbook: PlaybookOutput,
  configName: string,
  evolutionCtx?: ScriptEvolutionContext | null
): Promise<void> {
  const table = encodeURIComponent("Companies");
  const fields: Record<string, any> = {
    Playbook_Call_Opener: playbook.call_opener,
    Playbook_Gatekeeper_Ask: playbook.gatekeeper_ask,
    Playbook_Voicemail: playbook.voicemail,
    Playbook_Email_Subject: playbook.email_subject,
    Playbook_Email_Body: playbook.email_body,
    Playbook_Followup_Text: playbook.followup_text,
    Playbook_Version: PLAYBOOK_VERSION,
    Playbook_Last_Generated: new Date().toISOString(),
  };

  if (evolutionCtx && evolutionCtx.promptInjection) {
    fields.Playbook_Strategy_Notes = evolutionCtx.strategyNotes;
    fields.Playbook_Learning_Version = evolutionCtx.learningVersion;
    fields.Playbook_Applied_Patches = evolutionCtx.appliedPatches.length > 0
      ? JSON.stringify(
          evolutionCtx.appliedPatches.map(p => ({
            type: p.patchType,
            title: p.patchTitle,
            priority: p.priority,
            source: p.source,
          }))
        )
      : "";
    fields.Playbook_Confidence = evolutionCtx.confidence;
  } else {
    fields.Playbook_Strategy_Notes = "";
    fields.Playbook_Learning_Version = "";
    fields.Playbook_Applied_Patches = "";
    fields.Playbook_Confidence = 0;
  }

  await airtableRequest(table, {
    method: "PATCH",
    body: JSON.stringify({ records: [{ id: companyId, fields }] }),
  });
}

export async function generatePlaybooksForTodayList(options: {
  limit?: number;
  force?: boolean;
  clientId?: string;
}, clientId?: string): Promise<PlaybookResult> {
  const cfg = getIndustryConfig();
  const limit = options.limit ?? 25;
  const force = options.force ?? false;
  const effectiveClientId = clientId || options.clientId;

  logPB("Fetching Today_Call_List companies...");
  const companies = await fetchTodayListCompanies(effectiveClientId);
  logPB(`Found ${companies.length} companies on today's list`);

  const companyNames = companies.map(c => c.companyName);
  const analysisMap = await fetchCallAnalysisForCompanies(companyNames, effectiveClientId);
  let analysisMatched = 0;
  for (const c of companies) {
    const key = c.companyName.trim().toLowerCase();
    const ctx = analysisMap.get(key);
    if (ctx) {
      c.lastCallAnalysis = ctx;
      analysisMatched++;
    }
  }
  if (analysisMatched > 0) {
    logPB(`Matched call analysis context for ${analysisMatched} companies`);
  }

  if (effectiveClientId) {
    try {
      let matched = 0;
      for (const c of companies) {
        try {
          const ctx = await buildScriptEvolutionContext(
            effectiveClientId,
            c.companyName,
            c.bucket,
            c.opportunityType || undefined
          );
          if (ctx.promptInjection) {
            c.evolutionContext = ctx;
            matched++;
          }
        } catch (companyErr: any) {
          logPB(`Evolution context for ${c.companyName} failed (non-blocking): ${companyErr.message}`);
        }
      }
      if (matched > 0) {
        logPB(`Script evolution context loaded for ${matched} companies`);
      }
    } catch (e: any) {
      logPB(`Script evolution context failed (non-blocking): ${e.message}`);
    }
  }

  const result: PlaybookResult = {
    generated: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  const toProcess = companies.slice(0, limit);

  for (const c of toProcess) {
    if (!shouldGenerate(c, force, cfg.name)) {
      result.skipped++;
      result.details.push({ companyName: c.companyName, status: "skipped" });
      logPB(`Skipped ${c.companyName} (already ${c.playbookVersion}, generated ${c.playbookLastGenerated?.split("T")[0] || "unknown"})`);
      continue;
    }

    try {
      logPB(`Generating playbook for ${c.companyName} (${c.bucket})...`);
      const playbook = await generatePlaybook(c, cfg);
      await writePlaybook(c.id, playbook, cfg.name, c.evolutionContext);
      result.generated++;
      result.details.push({
        companyName: c.companyName,
        status: "generated",
        callOpener: playbook.call_opener,
        gatekeeperAsk: playbook.gatekeeper_ask,
      });
      logPB(`Playbook written for ${c.companyName}`);

      if (effectiveClientId && c.evolutionContext && c.evolutionContext.promptInjection) {
        try {
          await saveScriptVersion(
            effectiveClientId,
            c.companyName,
            c.bucket,
            playbook,
            c.evolutionContext.appliedPatches.map(p => ({ patchType: p.patchType, title: p.patchTitle, priority: p.priority })),
            c.evolutionContext.appliedPatches.map(p => p.id),
            c.evolutionContext.confidence,
            c.id
          );
        } catch (vErr: any) {
          logPB(`Script version save failed for ${c.companyName} (non-blocking): ${vErr.message}`);
        }
      }
    } catch (e: any) {
      result.errors++;
      result.details.push({ companyName: c.companyName, status: "error" });
      logPB(`Error generating playbook for ${c.companyName}: ${e.message}`);
    }
  }

  logPB(`Playbooks complete: ${result.generated} generated, ${result.skipped} skipped, ${result.errors} errors`);
  return result;
}
