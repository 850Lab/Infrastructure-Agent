import { scopedFormula } from "../airtable-scoped";

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [sales-learning:pattern] ${msg}`);
}

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY!;
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID!;

async function airtableRequest(path: string, options: RequestInit = {}): Promise<any> {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY()}`,
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

const MIN_SAMPLE_COMPANY = 3;
const MIN_SAMPLE_CATEGORY = 5;

interface ObservationRow {
  id: string;
  Company_Name: string;
  Gatekeeper_Name: string;
  Objection_Type: string;
  Outcome: string;
  Opener_Used: string;
  Deflection_Phrase: string;
  Prospect_Engagement: string;
  Operator_Performance: string;
  Authority_Redirect_Attempted: boolean;
  Authority_Redirect_Success: boolean;
}

interface LearningRow {
  id: string;
  Call_ID: string;
  Company_ID: string;
  Failure_Modes: string;
  Strength_Modes: string;
  Severity_Score: number;
  Pattern_Types: string;
}

export interface PatternInsight {
  Client_ID: string;
  Insight_Type: string;
  Segment_Key: string;
  Pattern_Description: string;
  Sample_Size: number;
  Confidence_Score: number;
  Recommended_Action: string;
  Recommended_Targeting_Change: string;
  Recommended_Script_Change: string;
  Recommended_Sequence_Change: string;
  Active: boolean;
  Created_At: string;
  Updated_At: string;
}

async function fetchAllRecords(table: string, clientId: string, fields: string[]): Promise<any[]> {
  const encoded = encodeURIComponent(table);
  const baseFormula = `{Client_ID}='${clientId}'`;
  const formula = encodeURIComponent(baseFormula);
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const all: any[] = [];
  let offset: string | undefined;

  do {
    let url = `${encoded}?pageSize=100&filterByFormula=${formula}&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    all.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return all;
}

function computeConfidence(matchCount: number, sampleSize: number): number {
  if (sampleSize === 0) return 0;
  const ratio = matchCount / sampleSize;
  const sizeBonus = Math.min(sampleSize / 10, 1) * 20;
  return Math.min(100, Math.round(ratio * 80 + sizeBonus));
}

interface AggBucket {
  key: string;
  items: any[];
}

function groupBy(records: any[], keyFn: (r: any) => string): AggBucket[] {
  const map = new Map<string, any[]>();
  for (const r of records) {
    const key = keyFn(r);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }));
}

function buildGatekeeperPatterns(observations: any[], clientId: string): PatternInsight[] {
  const insights: PatternInsight[] = [];
  const gkGroups = groupBy(
    observations.filter(o => o.fields.Gatekeeper_Name && o.fields.Deflection_Phrase),
    o => `${(o.fields.Company_Name || "").toLowerCase()}::${(o.fields.Gatekeeper_Name || "").toLowerCase()}`
  );

  for (const group of gkGroups) {
    if (group.items.length < MIN_SAMPLE_COMPANY) continue;
    const [company, gk] = group.key.split("::");
    const deflections = group.items.map(o => o.fields.Deflection_Phrase).filter(Boolean);
    const uniqueDeflections = [...new Set(deflections)];
    const mostCommon = deflections.sort((a: string, b: string) =>
      deflections.filter((v: string) => v === b).length - deflections.filter((v: string) => v === a).length
    )[0];

    insights.push({
      Client_ID: clientId,
      Insight_Type: "gatekeeper_deflection_pattern",
      Segment_Key: `gatekeeper:${group.key}`,
      Pattern_Description: `Gatekeeper "${gk}" at "${company}" has used deflection ${group.items.length} times. Most common phrase: "${mostCommon}". Unique deflections: ${uniqueDeflections.length}.`,
      Sample_Size: group.items.length,
      Confidence_Score: computeConfidence(group.items.length, group.items.length),
      Recommended_Action: `Add specific counter to "${mostCommon}" in gatekeeper script for ${company}.`,
      Recommended_Targeting_Change: "",
      Recommended_Script_Change: `Add redirect line after "${mostCommon}": "I understand — before I do, who typically handles [service area] decisions?"`,
      Recommended_Sequence_Change: "",
      Active: true,
      Created_At: new Date().toISOString(),
      Updated_At: new Date().toISOString(),
    });
  }

  return insights;
}

function buildObjectionPatterns(observations: any[], clientId: string): PatternInsight[] {
  const insights: PatternInsight[] = [];
  const objGroups = groupBy(
    observations.filter(o => o.fields.Objection_Type && o.fields.Objection_Type !== "none_detected"),
    o => o.fields.Objection_Type
  );

  for (const group of objGroups) {
    if (group.items.length < MIN_SAMPLE_CATEGORY) continue;

    const totalObs = observations.length;
    const pct = Math.round((group.items.length / totalObs) * 100);

    insights.push({
      Client_ID: clientId,
      Insight_Type: "objection_frequency",
      Segment_Key: `objection:${group.key}`,
      Pattern_Description: `"${group.key.replace(/_/g, " ")}" is the objection in ${group.items.length} calls (${pct}% of all calls).`,
      Sample_Size: group.items.length,
      Confidence_Score: computeConfidence(group.items.length, totalObs),
      Recommended_Action: `Build a specific objection handler for "${group.key.replace(/_/g, " ")}" objections.`,
      Recommended_Targeting_Change: "",
      Recommended_Script_Change: `Add objection handler: when prospect says "${group.key.replace(/_/g, " ")}", respond with evidence-based counter.`,
      Recommended_Sequence_Change: "",
      Active: true,
      Created_At: new Date().toISOString(),
      Updated_At: new Date().toISOString(),
    });
  }

  return insights;
}

function buildOutcomePatterns(observations: any[], clientId: string): PatternInsight[] {
  const insights: PatternInsight[] = [];

  const companyGroups = groupBy(observations, o => (o.fields.Company_Name || "").toLowerCase());

  for (const group of companyGroups) {
    if (group.items.length < MIN_SAMPLE_COMPANY) continue;

    const outcomes = group.items.map((o: any) => o.fields.Outcome);
    const noAnswerCount = outcomes.filter((o: string) => o === "No Answer").length;
    const gkCount = outcomes.filter((o: string) => o === "Gatekeeper").length;
    const dmCount = outcomes.filter((o: string) => o === "Decision Maker" || o === "Qualified").length;

    if (noAnswerCount === group.items.length) {
      insights.push({
        Client_ID: clientId,
        Insight_Type: "company_unreachable",
        Segment_Key: `company:${group.key}`,
        Pattern_Description: `${group.key} has been called ${group.items.length} times with 0 connections. Consider alternative contact method.`,
        Sample_Size: group.items.length,
        Confidence_Score: computeConfidence(noAnswerCount, group.items.length),
        Recommended_Action: "Switch to email sequence or try different time slots.",
        Recommended_Targeting_Change: "Decrease call priority; route to email sequence.",
        Recommended_Script_Change: "",
        Recommended_Sequence_Change: "Route to email-first sequence after 3+ no-answer calls.",
        Active: true,
        Created_At: new Date().toISOString(),
        Updated_At: new Date().toISOString(),
      });
    }

    if (gkCount >= MIN_SAMPLE_COMPANY && dmCount === 0) {
      insights.push({
        Client_ID: clientId,
        Insight_Type: "gatekeeper_wall",
        Segment_Key: `company:${group.key}:gk_wall`,
        Pattern_Description: `${group.key} has blocked at gatekeeper ${gkCount} times with no DM access. Gatekeeper strategy needs revision.`,
        Sample_Size: gkCount,
        Confidence_Score: computeConfidence(gkCount, group.items.length),
        Recommended_Action: "Try alternate approach: ask for DM by name, try different time, or request email for DM directly.",
        Recommended_Targeting_Change: "",
        Recommended_Script_Change: "Rewrite gatekeeper script with DM name request and specific authority language.",
        Recommended_Sequence_Change: "Add email touch between call attempts to this company.",
        Active: true,
        Created_At: new Date().toISOString(),
        Updated_At: new Date().toISOString(),
      });
    }
  }

  return insights;
}

function buildFailurePatterns(learningRecords: any[], clientId: string): PatternInsight[] {
  const insights: PatternInsight[] = [];

  const allFailures: string[] = [];
  for (const rec of learningRecords) {
    try {
      const modes = JSON.parse(rec.fields.Failure_Modes || "[]");
      allFailures.push(...modes);
    } catch {}
  }

  const failureCounts = new Map<string, number>();
  for (const f of allFailures) {
    failureCounts.set(f, (failureCounts.get(f) || 0) + 1);
  }

  for (const [mode, count] of failureCounts) {
    if (count < MIN_SAMPLE_CATEGORY) continue;
    const pct = Math.round((count / learningRecords.length) * 100);

    insights.push({
      Client_ID: clientId,
      Insight_Type: "failure_frequency",
      Segment_Key: `failure:${mode}`,
      Pattern_Description: `"${mode.replace(/_/g, " ")}" appears in ${count} calls (${pct}% of analyzed calls). This is a systemic issue.`,
      Sample_Size: count,
      Confidence_Score: computeConfidence(count, learningRecords.length),
      Recommended_Action: `Focus coaching on "${mode.replace(/_/g, " ")}". This is the most impactful improvement area.`,
      Recommended_Targeting_Change: "",
      Recommended_Script_Change: `Strengthen script to prevent "${mode.replace(/_/g, " ")}".`,
      Recommended_Sequence_Change: "",
      Active: true,
      Created_At: new Date().toISOString(),
      Updated_At: new Date().toISOString(),
    });
  }

  return insights;
}

async function fetchExistingInsights(clientId: string): Promise<Map<string, string>> {
  const records = await fetchAllRecords("Pattern_Insights", clientId, ["Segment_Key"]);
  const map = new Map<string, string>();
  for (const r of records) {
    if (r.fields.Segment_Key) {
      map.set(r.fields.Segment_Key, r.id);
    }
  }
  return map;
}

async function upsertInsight(insight: PatternInsight, existingId: string | null): Promise<void> {
  const table = encodeURIComponent("Pattern_Insights");
  if (existingId) {
    await airtableRequest(`${table}/${existingId}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { ...insight, Updated_At: new Date().toISOString() } }),
    });
  } else {
    await airtableRequest(table, {
      method: "POST",
      body: JSON.stringify({ records: [{ fields: { ...insight } }] }),
    });
  }
}

export async function refreshPatterns(clientId: string): Promise<{ created: number; updated: number }> {
  log(`Refreshing patterns for client ${clientId}...`);

  const [observations, learningRecords, existingMap] = await Promise.all([
    fetchAllRecords("Call_Observations", clientId, [
      "Company_Name", "Gatekeeper_Name", "Objection_Type", "Outcome",
      "Opener_Used", "Deflection_Phrase", "Prospect_Engagement",
      "Operator_Performance", "Authority_Redirect_Attempted", "Authority_Redirect_Success",
    ]),
    fetchAllRecords("Call_Learning", clientId, [
      "Call_ID", "Company_ID", "Failure_Modes", "Strength_Modes", "Severity_Score", "Pattern_Types",
    ]),
    fetchExistingInsights(clientId),
  ]);

  log(`Loaded ${observations.length} observations, ${learningRecords.length} learning records, ${existingMap.size} existing insights`);

  const allInsights: PatternInsight[] = [
    ...buildGatekeeperPatterns(observations, clientId),
    ...buildObjectionPatterns(observations, clientId),
    ...buildOutcomePatterns(observations, clientId),
    ...buildFailurePatterns(learningRecords, clientId),
  ];

  let created = 0;
  let updated = 0;

  for (const insight of allInsights) {
    const existingId = existingMap.get(insight.Segment_Key) || null;
    await upsertInsight(insight, existingId);
    if (existingId) {
      updated++;
    } else {
      created++;
    }
  }

  log(`Pattern refresh complete: ${created} created, ${updated} updated`);
  return { created, updated };
}
