import { log } from "./logger";
import { scopedFormula } from "./airtable-scoped";

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
    dm_name_rate: number;
    dm_email_rate: number;
    dm_phone_rate: number;
    website_rate: number;
    social_media_rate: number;
  };
  total_companies: number;
  computed_at: number;
}

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export async function computeOutcomes(range: string, clientId?: string): Promise<OutcomeMetrics> {
  const days = range === "30d" ? 30 : 7;
  const since = daysAgoISO(days);

  log(`Computing outcomes for ${range} (since ${since.slice(0, 10)})...`, "outcomes");

  const sf = (formula: string) => clientId ? scopedFormula(clientId, formula) : formula;

  const callFormula = sf(`IS_AFTER({Call_Time},'${since}')`);

  const [
    calls,
    todayList,
    todayWithDM,
    freshPool,
    followupsDue,
    wonCompanies,
  ] = await Promise.all([
    airtableFetch("Calls", callFormula, ["Outcome", "Call_Time"]),
    airtableFetch("Companies", sf("{Today_Call_List}=TRUE()"), ["Company_Name"]),
    airtableFetch("Companies", sf("AND({Today_Call_List}=TRUE(),{Offer_DM_Name}!='')"), ["Company_Name"]),
    airtableFetch("Companies", sf("OR({Times_Called}=0,{Lead_Status}='New')"), ["Company_Name"]),
    airtableFetch(
      "Companies",
      sf(`AND({Followup_Due}!='',IS_BEFORE({Followup_Due},DATEADD(TODAY(),1,'day')),{Lead_Status}!='Won',{Lead_Status}!='Lost')`),
      ["Company_Name"],
    ),
    airtableFetch("Companies", sf("{Lead_Status}='Won'"), ["Company_Name"]),
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

export async function computeConfidence(clientId?: string): Promise<ConfidenceResult> {
  const sf = (formula: string) => clientId ? scopedFormula(clientId, formula) : formula;

  const companies = await airtableFetch(
    "Companies",
    sf("{Today_Call_List}=TRUE()"),
    ["Company_Name", "Offer_DM_Name", "Offer_DM_Email", "Offer_DM_Phone", "Website", "Social_Media",
     "Primary_DM_Name", "Primary_DM_Email", "Primary_DM_Phone"],
  );

  const total = companies.length;

  if (total === 0) {
    return {
      confidence_score: 0,
      explanation: "No companies in today's pull yet.",
      components: { dm_name_rate: 0, dm_email_rate: 0, dm_phone_rate: 0, website_rate: 0, social_media_rate: 0 },
      total_companies: 0,
      computed_at: Date.now(),
    };
  }

  let hasDM = 0;
  let hasEmail = 0;
  let hasPhone = 0;
  let hasWebsite = 0;
  let hasSocial = 0;

  for (const c of companies) {
    const f = c.fields;
    const dmName = String(f.Offer_DM_Name || f.Primary_DM_Name || "").trim();
    const dmEmail = String(f.Offer_DM_Email || f.Primary_DM_Email || "").trim();
    const dmPhone = String(f.Offer_DM_Phone || f.Primary_DM_Phone || "").trim();
    const website = String(f.Website || "").trim();
    const social = String(f.Social_Media || "").trim();

    if (dmName) hasDM++;
    if (dmEmail) hasEmail++;
    if (dmPhone) hasPhone++;
    if (website) hasWebsite++;
    if (social) hasSocial++;
  }

  const dmNameRate = hasDM / total;
  const dmEmailRate = hasEmail / total;
  const dmPhoneRate = hasPhone / total;
  const websiteRate = hasWebsite / total;
  const socialRate = hasSocial / total;

  const score = Math.round(((dmNameRate + dmEmailRate + dmPhoneRate + websiteRate + socialRate) / 5) * 100);

  const parts: string[] = [];
  parts.push(`${total} companies pulled.`);

  const gaps: string[] = [];
  if (dmNameRate < 1) gaps.push(`DM name (${Math.round(dmNameRate * 100)}%)`);
  if (dmEmailRate < 1) gaps.push(`DM email (${Math.round(dmEmailRate * 100)}%)`);
  if (dmPhoneRate < 1) gaps.push(`DM phone (${Math.round(dmPhoneRate * 100)}%)`);
  if (websiteRate < 1) gaps.push(`website (${Math.round(websiteRate * 100)}%)`);
  if (socialRate < 1) gaps.push(`social media (${Math.round(socialRate * 100)}%)`);

  if (gaps.length === 0) {
    parts.push("Full data coverage — every company has all 5 fields.");
  } else if (gaps.length <= 2) {
    parts.push(`Gaps: ${gaps.join(", ")}.`);
  } else {
    parts.push(`Missing data in ${gaps.length} categories.`);
    const worst = gaps[gaps.length - 1];
    parts.push(`Weakest: ${worst}.`);
  }

  return {
    confidence_score: score,
    explanation: parts.join(" "),
    components: {
      dm_name_rate: Math.round(dmNameRate * 100) / 100,
      dm_email_rate: Math.round(dmEmailRate * 100) / 100,
      dm_phone_rate: Math.round(dmPhoneRate * 100) / 100,
      website_rate: Math.round(websiteRate * 100) / 100,
      social_media_rate: Math.round(socialRate * 100) / 100,
    },
    total_companies: total,
    computed_at: Date.now(),
  };
}
