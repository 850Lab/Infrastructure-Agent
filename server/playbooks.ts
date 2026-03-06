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
    const formula = encodeURIComponent(clientId ? scopedFormula(clientId, baseFormula) : baseFormula);
    const fields = ["Company", "Transcription", "Analysis", "Problem_Detected", "Proposed_Patch_Type", "Analysis_Confidence", "Outcome", "Call_Time"];
    const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

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
  const formula = encodeURIComponent(clientId ? scopedFormula(clientId, baseFormula) : baseFormula);
  const companies: PlaybookCompany[] = [];
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

Generate a JSON object with these exact fields:
{
  "call_opener": "Opening script when the decision maker answers. Max 45 seconds spoken. ${bestDMName ? `Address ${bestDMName} by name.` : `Ask for the ${cfg.decision_maker_titles_tiers.tier1[0] || "person in charge"}.`}",
  "gatekeeper_ask": "What to say if a receptionist/gatekeeper answers. Max 12 seconds. ${c.gatekeeperName ? `Address ${c.gatekeeperName} by name.` : "Be professional and direct."} ${bestDMName ? `Ask to speak with ${bestDMName}.` : `Ask for the ${cfg.decision_maker_titles_tiers.tier1[0] || "person in charge"}.`}",
  "voicemail": "Voicemail script. Max 25 seconds. Leave callback reason and phone number placeholder [YOUR_NUMBER].",
  "email_subject": "Email subject line. Short, specific, no spam words.",
  "email_body": "Follow-up email body. Max 130 words. Professional but conversational.",
  "followup_text": "SMS/text follow-up message. Max 240 characters."
}

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

  return {
    call_opener: String(parsed.call_opener || ""),
    gatekeeper_ask: String(parsed.gatekeeper_ask || ""),
    voicemail: String(parsed.voicemail || ""),
    email_subject: String(parsed.email_subject || ""),
    email_body: String(parsed.email_body || ""),
    followup_text: String(parsed.followup_text || "").slice(0, 240),
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
