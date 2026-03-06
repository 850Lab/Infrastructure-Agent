import { resolveAndWriteDMs, type DMResolutionSummary } from "./dm-resolver";
import { getIndustryConfig } from "./config";
import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";
import { getTimeWeight } from "./time-weight";

interface CompanyRecord {
  id: string;
  companyName: string;
  phone: string;
  leadStatus: string;
  priorityTier: string;
  priorityScore: number;
  engagementScore: number;
  opportunityScore: number;
  activeWorkScore: number;
  firstSeen: string | null;
  timesCalled: number;
  lastOutcome: string;
  followupDue: string | null;
  finalPriority: number;
  todayCallList: boolean;
  normalizedDomain: string | null;
  primaryDMName: string;
  primaryDMTitle: string;
  primaryDMEmail: string;
  primaryDMPhone: string;
  primaryDMConfidence: number;
  gatekeeperName: string;
  opportunityType: string;
  opportunitySignal: string;
  existingRankVersion: string;
  offerDMName: string;
  offerDMTitle: string;
  offerDMFitScore: number;
}

interface CallRecord {
  id: string;
  company: string;
  outcome: string;
  callTime: string;
  nextFollowup: string | null;
}

interface EngagementFacts {
  timesCalled: number;
  lastCalled: string | null;
  lastOutcome: string;
  followupDue: string | null;
}

export interface BucketConfig {
  top: number;
  pctHot: number;
  pctWorking: number;
  pctFresh: number;
}

interface Explainability {
  rankReason: string;
  rankEvidence: string;
  rankInputsJSON: string;
  rankVersion: string;
}

export interface EngineResult {
  top_requested: number;
  hot_selected: number;
  working_selected: number;
  fresh_selected: number;
  score_fill_selected: number;
  overdue_followups_included: number;
  dm_resolution: DMResolutionSummary | null;
  freshness_alert: { triggered: boolean; required: number; available: number };
  slip_alert: { triggered: boolean; overdue_count: number };
  companies_updated: number;
  rank_writes: number;
  rank_skipped: number;
  details: Array<{
    companyName: string;
    bucket: string;
    finalPriority: number;
    followupDue: string | null;
    overdue: boolean;
    phone: string;
    primaryDMName: string;
    primaryDMTitle: string;
    primaryDMEmail: string;
    gatekeeperName: string;
    rankReason: string;
    offerDMName: string;
    offerDMTitle: string;
    offerDMFitScore: number;
  }>;
}

function logOE(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [opp-engine] ${message}`);
}

async function airtableRequest(path: string, options: RequestInit = {}, config?: { apiKey: string; baseId: string }): Promise<any> {
  const apiKey = config?.apiKey || process.env.AIRTABLE_API_KEY;
  const baseId = config?.baseId || process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) throw new Error("Airtable credentials not configured");
  const url = `https://api.airtable.com/v0/${baseId}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchAllCompanies(clientId?: string, atConfig?: { apiKey: string; baseId: string }): Promise<CompanyRecord[]> {
  const table = encodeURIComponent("Companies");
  const companies: CompanyRecord[] = [];
  let offset: string | undefined;

  do {
    let params = offset ? `?pageSize=100&offset=${offset}` : "?pageSize=100";
    if (clientId) {
      const formula = encodeURIComponent(scopedFormula(clientId));
      params += `&filterByFormula=${formula}`;
    }
    const data = await airtableRequest(`${table}${params}`, {}, atConfig);

    for (const rec of data.records || []) {
      const f = rec.fields;
      companies.push({
        id: rec.id,
        companyName: String(f.company_name || f.Company_Name || "").trim(),
        phone: String(f.phone || f.Phone || "").trim(),
        leadStatus: String(f.Lead_Status || "").trim(),
        priorityTier: String(f.Priority_Tier || "").trim(),
        priorityScore: parseInt(f.Priority_Score || "0", 10) || 0,
        engagementScore: parseInt(f.Engagement_Score || "0", 10) || 0,
        opportunityScore: parseInt(f.Opportunity_Score || "0", 10) || 0,
        activeWorkScore: parseInt(f.Active_Work_Score || "0", 10) || 0,
        firstSeen: f.First_Seen || null,
        timesCalled: parseInt(f.Times_Called || "0", 10) || 0,
        lastOutcome: String(f.Last_Outcome || "").trim(),
        followupDue: f.Followup_Due || null,
        finalPriority: parseInt(f.Final_Priority || "0", 10) || 0,
        todayCallList: !!f.Today_Call_List,
        normalizedDomain: f.Normalized_Domain || null,
        primaryDMName: String(f.Primary_DM_Name || "").trim(),
        primaryDMTitle: String(f.Primary_DM_Title || "").trim(),
        primaryDMEmail: String(f.Primary_DM_Email || "").trim(),
        primaryDMPhone: String(f.Primary_DM_Phone || "").trim(),
        primaryDMConfidence: parseInt(f.Primary_DM_Confidence || "0", 10) || 0,
        gatekeeperName: String(f.Gatekeeper_Name || "").trim(),
        opportunityType: String(f.Opportunity_Type || "").trim(),
        opportunitySignal: String(f.Opportunity_Signal || "").trim(),
        existingRankVersion: String(f.Rank_Version || "").trim(),
        offerDMName: String(f.Offer_DM_Name || "").trim(),
        offerDMTitle: String(f.Offer_DM_Title || "").trim(),
        offerDMFitScore: parseInt(f.Offer_DM_FitScore || "0", 10) || 0,
      });
    }
    offset = data.offset;
  } while (offset);

  return companies;
}

async function fetchAllCalls(clientId?: string, atConfig?: { apiKey: string; baseId: string }): Promise<CallRecord[]> {
  const table = encodeURIComponent("Calls");
  const calls: CallRecord[] = [];
  let offset: string | undefined;

  do {
    let params = offset ? `?pageSize=100&offset=${offset}` : "?pageSize=100";
    if (clientId) {
      const formula = encodeURIComponent(scopedFormula(clientId));
      params += `&filterByFormula=${formula}`;
    }
    const data = await airtableRequest(`${table}${params}`, {}, atConfig);

    for (const rec of data.records || []) {
      const f = rec.fields;
      calls.push({
        id: rec.id,
        company: String(f.Company || "").trim(),
        outcome: String(f.Outcome || "").trim(),
        callTime: String(f.Call_Time || ""),
        nextFollowup: f.Next_Followup || null,
      });
    }
    offset = data.offset;
  } while (offset);

  return calls;
}

function deriveEngagementFacts(companyName: string, calls: CallRecord[]): EngagementFacts {
  const companyCalls = calls.filter(c =>
    c.company.toLowerCase() === companyName.toLowerCase() && c.outcome
  );

  if (companyCalls.length === 0) {
    return { timesCalled: 0, lastCalled: null, lastOutcome: "", followupDue: null };
  }

  companyCalls.sort((a, b) => {
    const tA = a.callTime ? new Date(a.callTime).getTime() : 0;
    const tB = b.callTime ? new Date(b.callTime).getTime() : 0;
    return tB - tA;
  });

  const now = Date.now();
  let followupDue: string | null = null;
  for (const c of companyCalls) {
    if (!c.nextFollowup) continue;
    const outcome = c.outcome.toLowerCase();
    if (outcome === "won" || outcome === "lost") continue;
    const fDate = new Date(c.nextFollowup).getTime();
    if (!followupDue || fDate < new Date(followupDue).getTime()) {
      followupDue = c.nextFollowup;
    }
  }

  return {
    timesCalled: companyCalls.length,
    lastCalled: companyCalls[0].callTime || null,
    lastOutcome: companyCalls[0].outcome,
    followupDue,
  };
}

function computeFinalPriority(c: CompanyRecord): number {
  const cfg = getIndustryConfig().scoring;
  const recencyWeight = getTimeWeight(c.firstSeen);
  let score = Math.floor(c.priorityScore * cfg.priority_weight);
  score += Math.min(Math.round(c.engagementScore * recencyWeight), cfg.engagement_weight);
  score += Math.min(Math.round(c.opportunityScore * recencyWeight), cfg.opportunity_weight);
  score += Math.min(Math.floor(c.activeWorkScore / 3), 20);
  if (c.phone && c.phone.length > 5) score += cfg.dm_phone_bonus * 2;
  if (c.priorityTier === "A") score += 15;
  else if (c.priorityTier === "B") score += 5;
  return Math.max(0, Math.min(score, 200));
}

function assignBucket(
  c: CompanyRecord,
  facts: EngagementFacts,
  now: Date
): "Hot Follow-up" | "Working" | "Fresh" | "Hold" | null {
  const leadStatus = c.leadStatus;
  if (leadStatus === "Won" || leadStatus === "Lost") return null;

  const twoDaysFromNow = new Date(now);
  twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

  if (facts.followupDue) {
    const fDate = new Date(facts.followupDue);
    if (fDate <= twoDaysFromNow) {
      return "Hot Follow-up";
    }
  }

  if (["Working", "Called", "Enriched"].includes(leadStatus)) {
    const hasSignal = c.opportunityScore >= 60 || c.engagementScore > 0 || c.priorityTier === "A";
    if (hasSignal) {
      const lastCalledDaysAgo = facts.lastCalled
        ? (now.getTime() - new Date(facts.lastCalled).getTime()) / (1000 * 60 * 60 * 24)
        : Infinity;
      const staleDaysWorking = getIndustryConfig().call_list.staleDaysWorking;
      if (lastCalledDaysAgo > staleDaysWorking || !facts.lastCalled) {
        return "Working";
      }
    }
  }

  if (leadStatus === "New" || facts.timesCalled === 0) {
    if (!facts.lastCalled) {
      const firstSeenDate = c.firstSeen ? new Date(c.firstSeen) : null;
      const daysSinceFirstSeen = firstSeenDate
        ? (now.getTime() - firstSeenDate.getTime()) / (1000 * 60 * 60 * 24)
        : 0;
      const staleDaysNoCall = getIndustryConfig().call_list.staleDaysNoCall;
      if (daysSinceFirstSeen <= staleDaysNoCall || c.priorityTier === "A") {
        return "Fresh";
      }
    }
  }

  return null;
}

const RANK_VERSION = "v1";

function buildExplainability(
  c: CompanyRecord,
  bucket: string,
  overdue: boolean,
  now: Date
): Explainability {
  const evidence: string[] = [];
  const reasons: string[] = [];

  if (bucket === "Hot Follow-up") {
    const dueStr = c.followupDue ? c.followupDue.split("T")[0] : "soon";
    if (overdue) {
      const overdueDays = c.followupDue
        ? Math.max(1, Math.floor((now.getTime() - new Date(c.followupDue).getTime()) / (1000 * 60 * 60 * 24)))
        : 0;
      evidence.push(`Bucket: Hot Follow-up (overdue by ${overdueDays} day${overdueDays !== 1 ? "s" : ""})`);
      reasons.push(`Hot follow-up overdue ${dueStr}.`);
    } else {
      evidence.push(`Bucket: Hot Follow-up (due ${dueStr})`);
      reasons.push(`Follow-up due ${dueStr}.`);
    }
  } else if (bucket === "Working") {
    evidence.push("Bucket: Working (active pipeline, has signals)");
    reasons.push("Active pipeline with engagement signals.");
  } else if (bucket === "Fresh") {
    const firstSeenDate = c.firstSeen ? c.firstSeen.split("T")[0] : "recently";
    evidence.push(`Bucket: Fresh (first seen ${firstSeenDate})`);
    reasons.push(`Fresh lead (added ${firstSeenDate}).`);
  } else {
    evidence.push(`Bucket: ${bucket} (score fill)`);
    reasons.push("High priority score filled remaining slot.");
  }

  if (c.opportunityType || c.opportunitySignal) {
    const parts: string[] = [];
    if (c.opportunityType) parts.push(c.opportunityType);
    if (c.opportunityScore) parts.push(`score ${c.opportunityScore}`);
    if (c.opportunitySignal) parts.push(`signal: ${c.opportunitySignal}`);
    evidence.push(`Opportunity: ${parts.join(" | ")}`);
  } else if (c.opportunityScore > 0) {
    evidence.push(`Opportunity score: ${c.opportunityScore}`);
  }

  if (c.engagementScore !== 0) {
    const sign = c.engagementScore > 0 ? "+" : "";
    const lastOutcomeNote = c.lastOutcome ? ` (${c.lastOutcome})` : "";
    evidence.push(`Engagement: ${sign}${c.engagementScore}${lastOutcomeNote}`);
    if (c.engagementScore >= 10) {
      reasons.push(`Prior engagement ${sign}${c.engagementScore}.`);
    }
  }

  if (c.primaryDMName) {
    const channels: string[] = [];
    if (c.primaryDMEmail) channels.push("email");
    if (c.primaryDMPhone) channels.push("phone");
    const channelStr = channels.length > 0 ? ` (${channels.join(" + ")})` : "";
    const titleStr = c.primaryDMTitle ? ` ${c.primaryDMTitle}` : "";
    evidence.push(`Decision maker: ${c.primaryDMName}${titleStr}${channelStr}`);
    reasons.push(`DM: ${c.primaryDMName}${titleStr}.`);
  }

  if (c.gatekeeperName) {
    evidence.push(`Gatekeeper known: ${c.gatekeeperName}`);
  }

  if (c.timesCalled > 0) {
    evidence.push(`Called ${c.timesCalled} time${c.timesCalled !== 1 ? "s" : ""}${c.lastOutcome ? `, last: ${c.lastOutcome}` : ""}`);
  } else {
    evidence.push("Not yet contacted");
  }

  if (c.priorityTier) {
    evidence.push(`Priority: ${c.priorityTier}-tier, score ${c.priorityScore}, final ${c.finalPriority}`);
  }

  const inputs: Record<string, any> = {
    Final_Priority: c.finalPriority,
    Priority_Score: c.priorityScore,
    Priority_Tier: c.priorityTier,
    Opportunity_Score: c.opportunityScore,
    Opportunity_Type: c.opportunityType || null,
    Opportunity_Signal: c.opportunitySignal || null,
    Engagement_Score: c.engagementScore,
    Times_Called: c.timesCalled,
    Last_Outcome: c.lastOutcome || null,
    Followup_Due: c.followupDue || null,
    Bucket: bucket,
    Overdue: overdue,
    Primary_DM_Name: c.primaryDMName || null,
    Primary_DM_Title: c.primaryDMTitle || null,
    Primary_DM_Email: !!c.primaryDMEmail,
    Primary_DM_Phone: !!c.primaryDMPhone,
    Gatekeeper_Name: c.gatekeeperName || null,
    Active_Work_Score: c.activeWorkScore,
    Lead_Status: c.leadStatus,
    First_Seen: c.firstSeen || null,
  };

  return {
    rankReason: reasons.join(" "),
    rankEvidence: evidence.map(e => `• ${e}`).join("\n"),
    rankInputsJSON: JSON.stringify(inputs, null, 2),
    rankVersion: RANK_VERSION,
  };
}

export async function runOpportunityEngine(config: BucketConfig, clientId?: string): Promise<EngineResult> {
  logOE("Fetching all companies and calls...");

  const atConfig = clientId ? await getClientAirtableConfig(clientId) : undefined;

  const [companies, calls] = await Promise.all([
    fetchAllCompanies(clientId, atConfig),
    fetchAllCalls(clientId, atConfig),
  ]);

  logOE(`Loaded ${companies.length} companies, ${calls.length} calls`);

  const now = new Date();
  const compTable = encodeURIComponent("Companies");

  const hotBucket: Array<{ company: CompanyRecord; facts: EngagementFacts; overdue: boolean }> = [];
  const workingBucket: Array<{ company: CompanyRecord; facts: EngagementFacts }> = [];
  const freshBucket: Array<{ company: CompanyRecord; facts: EngagementFacts }> = [];
  const allEligible: Array<{ company: CompanyRecord; facts: EngagementFacts }> = [];

  for (const c of companies) {
    if (!c.phone || c.phone.length <= 5) continue;
    if (c.leadStatus === "Won" || c.leadStatus === "Lost") continue;

    const facts = deriveEngagementFacts(c.companyName, calls);

    c.timesCalled = facts.timesCalled;
    c.lastOutcome = facts.lastOutcome;
    c.followupDue = facts.followupDue;

    const wasFirstSeenMissing = !c.firstSeen;
    if (wasFirstSeenMissing) {
      c.firstSeen = now.toISOString();
    }
    (c as any)._firstSeenNew = wasFirstSeenMissing;

    c.finalPriority = computeFinalPriority(c);

    const bucket = assignBucket(c, facts, now);

    if (bucket === "Hot Follow-up") {
      const isOverdue = facts.followupDue ? new Date(facts.followupDue) < now : false;
      hotBucket.push({ company: c, facts, overdue: isOverdue });
    } else if (bucket === "Working") {
      workingBucket.push({ company: c, facts });
    } else if (bucket === "Fresh") {
      freshBucket.push({ company: c, facts });
    }

    allEligible.push({ company: c, facts });
  }

  hotBucket.sort((a, b) => {
    if (a.overdue && !b.overdue) return -1;
    if (!a.overdue && b.overdue) return 1;
    return b.company.finalPriority - a.company.finalPriority;
  });
  workingBucket.sort((a, b) => b.company.finalPriority - a.company.finalPriority);
  freshBucket.sort((a, b) => b.company.finalPriority - a.company.finalPriority);
  allEligible.sort((a, b) => b.company.finalPriority - a.company.finalPriority);

  logOE(`Buckets: Hot=${hotBucket.length}, Working=${workingBucket.length}, Fresh=${freshBucket.length}, Total eligible=${allEligible.length}`);

  const top = config.top;
  let hotQuota = Math.round(top * config.pctHot);
  let workingQuota = Math.round(top * config.pctWorking);
  let freshQuota = top - hotQuota - workingQuota;

  const selected = new Map<string, { company: CompanyRecord; bucket: string; overdue: boolean }>();

  const hotTake = Math.min(hotQuota, hotBucket.length);
  for (let i = 0; i < hotTake; i++) {
    selected.set(hotBucket[i].company.id, {
      company: hotBucket[i].company,
      bucket: "Hot Follow-up",
      overdue: hotBucket[i].overdue,
    });
  }
  let hotLeftover = hotQuota - hotTake;

  const overdueNotSelected = hotBucket.filter((h, i) => i >= hotTake && h.overdue);
  for (const o of overdueNotSelected) {
    if (!selected.has(o.company.id) && selected.size < top) {
      selected.set(o.company.id, {
        company: o.company,
        bucket: "Hot Follow-up",
        overdue: true,
      });
    }
  }

  const slotsUsedByOverdue = selected.size - hotTake;
  const remainingAfterHot = top - selected.size;
  const adjustedWorkingQuota = Math.round(remainingAfterHot * (config.pctWorking / (config.pctWorking + config.pctFresh)));
  workingQuota = adjustedWorkingQuota;
  freshQuota = remainingAfterHot - adjustedWorkingQuota;

  const workingAvail = workingBucket.filter(w => !selected.has(w.company.id));
  const workingTake = Math.min(workingQuota, workingAvail.length);
  for (let i = 0; i < workingTake; i++) {
    selected.set(workingAvail[i].company.id, {
      company: workingAvail[i].company,
      bucket: "Working",
      overdue: false,
    });
  }
  let workingLeftover = workingQuota - workingTake;

  const freshAvail = freshBucket.filter(f => !selected.has(f.company.id));
  const freshTake = Math.min(freshQuota + workingLeftover, freshAvail.length);
  for (let i = 0; i < freshTake; i++) {
    selected.set(freshAvail[i].company.id, {
      company: freshAvail[i].company,
      bucket: "Fresh",
      overdue: false,
    });
  }

  const remaining = top - selected.size;
  if (remaining > 0) {
    const fillCandidates = allEligible.filter(e => !selected.has(e.company.id));
    const fillTake = Math.min(remaining, fillCandidates.length);
    for (let i = 0; i < fillTake; i++) {
      selected.set(fillCandidates[i].company.id, {
        company: fillCandidates[i].company,
        bucket: "Hold",
        overdue: false,
      });
    }
  }

  const freshnessAlert = {
    triggered: freshTake < freshQuota,
    required: freshQuota,
    available: freshAvail.length,
  };
  if (freshnessAlert.triggered) {
    logOE(`FRESHNESS_ALERT: Need ${freshQuota} fresh leads, only ${freshAvail.length} available`);
  }

  const overdueCount = hotBucket.filter(h => h.overdue).length;
  const slipAlert = {
    triggered: overdueCount > 0,
    overdue_count: overdueCount,
  };
  if (slipAlert.triggered) {
    logOE(`SLIP_ALERT: ${overdueCount} overdue follow-ups detected`);
  }

  logOE(`Computing rank explainability for ${selected.size} selected companies...`);
  const explainMap = new Map<string, Explainability>();
  let rankWrites = 0;
  let rankSkipped = 0;

  for (const [id, sel] of selected) {
    const expl = buildExplainability(sel.company, sel.bucket, sel.overdue, now);
    explainMap.set(id, expl);
  }

  logOE(`Writing back engagement facts and selections for ${companies.length} companies...`);

  const batchSize = 10;
  let companiesUpdated = 0;

  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);
    const records = batch.map(c => {
      const sel = selected.get(c.id);
      const updateFields: Record<string, any> = {
        Times_Called: c.timesCalled,
        Last_Outcome: c.lastOutcome || null,
        Followup_Due: c.followupDue || null,
        Final_Priority: c.finalPriority,
      };

      if ((c as any)._firstSeenNew) {
        updateFields.First_Seen = c.firstSeen;
      }

      if (sel) {
        updateFields.Today_Call_List = true;
        updateFields.Bucket = sel.bucket;

        const expl = explainMap.get(c.id);
        if (expl) {
          if (c.existingRankVersion === RANK_VERSION) {
            rankSkipped++;
          } else {
            updateFields.Rank_Reason = expl.rankReason;
            updateFields.Rank_Evidence = expl.rankEvidence;
            updateFields.Rank_Inputs_JSON = expl.rankInputsJSON;
            updateFields.Rank_Version = expl.rankVersion;
            rankWrites++;
          }
        }
      } else {
        updateFields.Today_Call_List = false;
        updateFields.Bucket = null;
        if (c.existingRankVersion) {
          updateFields.Rank_Reason = null;
          updateFields.Rank_Evidence = null;
          updateFields.Rank_Inputs_JSON = null;
          updateFields.Rank_Version = null;
        }
      }

      return { id: c.id, fields: updateFields };
    });

    try {
      await airtableRequest(compTable, {
        method: "PATCH",
        body: JSON.stringify({ records }),
      }, atConfig);
      companiesUpdated += records.length;
    } catch (e: any) {
      logOE(`Batch update error: ${e.message}`);
    }
  }

  const hotSelectedCount = [...selected.values()].filter(s => s.bucket === "Hot Follow-up").length;
  const workingSelectedCount = [...selected.values()].filter(s => s.bucket === "Working").length;
  const freshSelectedCount = [...selected.values()].filter(s => s.bucket === "Fresh").length;
  const scoreFillCount = [...selected.values()].filter(s => s.bucket === "Hold").length;
  const overdueIncluded = [...selected.values()].filter(s => s.overdue).length;

  logOE(`Rank explainability: ${rankWrites} written, ${rankSkipped} skipped (already v1)`);

  const details = [...selected.values()].map(s => {
    const expl = explainMap.get(s.company.id);
    return {
      companyName: s.company.companyName,
      bucket: s.bucket,
      finalPriority: s.company.finalPriority,
      followupDue: s.company.followupDue,
      overdue: s.overdue,
      phone: s.company.phone,
      primaryDMName: s.company.primaryDMName,
      primaryDMTitle: s.company.primaryDMTitle,
      primaryDMEmail: s.company.primaryDMEmail,
      gatekeeperName: s.company.gatekeeperName,
      rankReason: expl?.rankReason || "",
      offerDMName: s.company.offerDMName,
      offerDMTitle: s.company.offerDMTitle,
      offerDMFitScore: s.company.offerDMFitScore,
    };
  });
  details.sort((a, b) => {
    const bucketOrder: Record<string, number> = { "Hot Follow-up": 0, "Working": 1, "Fresh": 2, "Hold": 3 };
    const oa = bucketOrder[a.bucket] ?? 4;
    const ob = bucketOrder[b.bucket] ?? 4;
    if (oa !== ob) return oa - ob;
    return b.finalPriority - a.finalPriority;
  });

  logOE("Resolving primary decision makers for selected companies...");
  const selectedCompaniesForDM = [...selected.values()].map(s => ({
    id: s.company.id,
    companyName: s.company.companyName,
    normalizedDomain: s.company.normalizedDomain,
    existingDM: s.company.primaryDMName ? {
      name: s.company.primaryDMName,
      email: s.company.primaryDMEmail,
      phone: s.company.primaryDMPhone,
      confidence: s.company.primaryDMConfidence,
    } : undefined,
  }));

  let dmResolution: DMResolutionSummary | null = null;
  try {
    dmResolution = await resolveAndWriteDMs(selectedCompaniesForDM);
  } catch (e: any) {
    logOE(`DM resolution failed: ${e.message}`);
  }

  return {
    top_requested: top,
    hot_selected: hotSelectedCount,
    working_selected: workingSelectedCount,
    fresh_selected: freshSelectedCount,
    score_fill_selected: scoreFillCount,
    overdue_followups_included: overdueIncluded,
    dm_resolution: dmResolution,
    freshness_alert: freshnessAlert,
    slip_alert: slipAlert,
    companies_updated: companiesUpdated,
    rank_writes: rankWrites,
    rank_skipped: rankSkipped,
    details,
  };
}
