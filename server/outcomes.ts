import { log } from "./logger";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
}

async function airtableFetch(
  table: string,
  formula: string,
  fields: string[],
): Promise<AirtableRecord[]> {
  const key = AIRTABLE_API_KEY();
  const base = AIRTABLE_BASE_ID();
  if (!key || !base) return [];

  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  try {
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (formula) params.set("filterByFormula", formula);
      for (const f of fields) params.append("fields[]", f);
      if (offset) params.set("offset", offset);

      const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) return records;

      const data = await res.json();
      records.push(...(data.records || []));
      offset = data.offset;
    } while (offset);
  } catch (e: any) {
    log(`Outcomes airtable fetch error (${table}): ${e.message}`, "outcomes");
  }

  return records;
}

export interface OutcomeMetrics {
  calls_made: number;
  dm_reached: number;
  qualified: number;
  won: number;
  not_interested: number;
  followups_due: number;
  dm_coverage_rate: number;
  fresh_pool_rate: number;
  range: string;
  computed_at: number;
}

export interface ConfidenceResult {
  confidence_score: number;
  explanation: string;
  components: {
    dm_reached_rate: number;
    qualified_rate: number;
    won_rate: number;
    not_interested_rate: number;
  };
  computed_at: number;
}

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export async function computeOutcomes(range: string): Promise<OutcomeMetrics> {
  const days = range === "30d" ? 30 : 7;
  const since = daysAgoISO(days);

  log(`Computing outcomes for ${range} (since ${since.slice(0, 10)})...`, "outcomes");

  const callFormula = `IS_AFTER({Call_Time},'${since}')`;

  const [
    calls,
    todayList,
    todayWithDM,
    freshPool,
    followupsDue,
    wonCompanies,
  ] = await Promise.all([
    airtableFetch("Calls", callFormula, ["Outcome", "Call_Time"]),
    airtableFetch("Companies", "{Today_Call_List}=TRUE()", ["Company_Name"]),
    airtableFetch("Companies", "AND({Today_Call_List}=TRUE(),{Offer_DM_Name}!='')", ["Company_Name"]),
    airtableFetch("Companies", "OR({Times_Called}=0,{Lead_Status}='New')", ["Company_Name"]),
    airtableFetch(
      "Companies",
      `AND({Followup_Due}!='',IS_BEFORE({Followup_Due},DATEADD(TODAY(),1,'day')),{Lead_Status}!='Won',{Lead_Status}!='Lost')`,
      ["Company_Name"],
    ),
    airtableFetch("Companies", "{Lead_Status}='Won'", ["Company_Name"]),
  ]);

  const DM_OUTCOMES = new Set(["decision maker", "qualified", "callback"]);

  let dmReached = 0;
  let qualified = 0;
  let won = 0;
  let notInterested = 0;

  for (const c of calls) {
    const outcome = String(c.fields.Outcome || "").trim().toLowerCase();
    if (DM_OUTCOMES.has(outcome)) dmReached++;
    if (outcome === "qualified") qualified++;
    if (outcome === "won") won++;
    if (outcome === "not interested") notInterested++;
  }

  won += wonCompanies.length;

  const todayCount = todayList.length;
  const todayDMCount = todayWithDM.length;
  const dmCoverageRate = todayCount > 0 ? todayDMCount / todayCount : 0;

  const targetFresh = 50;
  const freshPoolRate = Math.min(1, freshPool.length / targetFresh);

  const metrics: OutcomeMetrics = {
    calls_made: calls.length,
    dm_reached: dmReached,
    qualified,
    won,
    not_interested: notInterested,
    followups_due: followupsDue.length,
    dm_coverage_rate: Math.round(dmCoverageRate * 100) / 100,
    fresh_pool_rate: Math.round(freshPoolRate * 100) / 100,
    range,
    computed_at: Date.now(),
  };

  log(`Outcomes computed: ${calls.length} calls, ${dmReached} DM reached, ${qualified} qualified, ${won} won`, "outcomes");
  return metrics;
}

export async function computeConfidence(): Promise<ConfidenceResult> {
  const outcomes = await computeOutcomes("7d");

  const totalCalls = Math.max(1, outcomes.calls_made);
  const dmReachedRate = outcomes.dm_reached / totalCalls;
  const qualifiedRate = outcomes.qualified / totalCalls;
  const wonRate = outcomes.won / Math.max(1, outcomes.dm_reached);
  const notInterestedRate = outcomes.not_interested / totalCalls;

  let score = 50;
  score += dmReachedRate * 30;
  score += qualifiedRate * 40;
  score += wonRate * 60;
  score -= notInterestedRate * 20;
  score = Math.round(Math.max(0, Math.min(100, score)));

  const parts: string[] = [];
  if (outcomes.calls_made === 0) {
    parts.push("No calls logged yet — baseline score.");
  } else {
    if (dmReachedRate > 0.3) parts.push(`Strong DM reach rate (${(dmReachedRate * 100).toFixed(0)}%).`);
    else if (dmReachedRate > 0) parts.push(`DM reach rate at ${(dmReachedRate * 100).toFixed(0)}%.`);
    else parts.push("No DMs reached yet.");

    if (qualifiedRate > 0.1) parts.push(`Good qualification rate (${(qualifiedRate * 100).toFixed(0)}%).`);
    else if (outcomes.qualified > 0) parts.push(`${outcomes.qualified} qualified so far.`);

    if (outcomes.won > 0) parts.push(`${outcomes.won} won — boosting confidence.`);
    if (notInterestedRate > 0.5) parts.push(`High rejection rate (${(notInterestedRate * 100).toFixed(0)}%) — dragging score down.`);
  }

  const explanation = parts.join(" ") || "Baseline targeting score.";

  return {
    confidence_score: score,
    explanation,
    components: {
      dm_reached_rate: Math.round(dmReachedRate * 100) / 100,
      qualified_rate: Math.round(qualifiedRate * 100) / 100,
      won_rate: Math.round(wonRate * 100) / 100,
      not_interested_rate: Math.round(notInterestedRate * 100) / 100,
    },
    computed_at: Date.now(),
  };
}
