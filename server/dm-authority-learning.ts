import { log } from "./logger";
import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";
import { getTimeWeight } from "./time-weight";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

function logAuth(message: string) {
  log(message, "dm-authority");
}

async function airtableRequest(path: string, options: RequestInit = {}, config?: { apiKey: string; baseId: string }): Promise<any> {
  const apiKey = config?.apiKey || AIRTABLE_API_KEY();
  const baseId = config?.baseId || AIRTABLE_BASE_ID();
  if (!apiKey || !baseId) throw new Error("Airtable credentials not configured");
  const url = `https://api.airtable.com/v0/${baseId}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

async function fetchAllPaginated(table: string, formula: string, fields: string[], config?: { apiKey: string; baseId: string }): Promise<any[]> {
  const encoded = encodeURIComponent(table);
  const records: any[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    params.set("filterByFormula", formula);
    for (const f of fields) params.append("fields[]", f);
    if (offset) params.set("offset", offset);

    const data = await airtableRequest(`${encoded}?${params.toString()}`, {}, config);
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

interface TitleStats {
  title: string;
  total_contacts: number;
  reached_dm: number;
  converted: number;
  wrong_person: number;
  no_authority: number;
  rejected: number;
  authority_score: number;
}

interface TitleCategoryStats extends TitleStats {
  category: string;
}

export interface DMAuthorityReport {
  title_rankings: TitleStats[];
  title_by_category: TitleCategoryStats[];
  total_contacts_analyzed: number;
  computed_at: number;
}

export interface DMAuthorityAdjustment {
  titlePattern: RegExp;
  adjustment: number;
  reason: string;
}

const MIN_CONTACTS_FOR_SCORE = 5;
const MIN_CONTACTS_FOR_ADJUSTMENT = 3;

function normalizeTitle(title: string): string {
  return (title || "").toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/^(mr|mrs|ms|dr)\.?\s+/i, "");
}

function titleBucket(title: string): string {
  const t = normalizeTitle(title);
  if (/safety\s*(director|manager)|hse\s*manager|ehs\s*manager/.test(t)) return "Safety Manager";
  if (/superintendent|site\s*manager|field\s*supervisor/.test(t)) return "Superintendent / Site Manager";
  if (/project\s*manager|turnaround\s*manager|shutdown\s*manager/.test(t)) return "Project / Turnaround Manager";
  if (/operations\s*manager|maintenance\s*manager|plant\s*manager/.test(t)) return "Operations / Maintenance Manager";
  if (/vp|vice\s*president/.test(t)) return "VP";
  if (/director/.test(t)) return "Director";
  if (/\b(ceo|cfo|coo|president|founder|owner|chairman)\b/.test(t)) return "Executive / Owner";
  if (/general\s*manager/.test(t)) return "General Manager";
  if (/manager/.test(t)) return "Manager (Other)";
  return "Other";
}

function titleBucketToPattern(bucket: string): RegExp {
  const patterns: Record<string, RegExp> = {
    "Safety Manager": /safety|hse|ehs/,
    "Superintendent / Site Manager": /superintendent|site\s*manager|field\s*supervisor/,
    "Project / Turnaround Manager": /project\s*manager|turnaround|shutdown/,
    "Operations / Maintenance Manager": /operations\s*manager|maintenance\s*manager|plant\s*manager/,
    "VP": /vp|vice\s*president/,
    "Director": /director/,
    "Executive / Owner": /\b(ceo|cfo|coo|president|founder|owner|chairman)\b/,
    "General Manager": /general\s*manager/,
    "Manager (Other)": /manager/,
  };
  return patterns[bucket] || /./;
}

export async function computeTitleEffectiveness(clientId?: string): Promise<DMAuthorityReport> {
  const atConfig = clientId ? await getClientAirtableConfig(clientId) : undefined;
  const sf = (formula: string) => clientId ? scopedFormula(clientId, formula) : formula;

  const formula = sf("{Offer_DM_Outcome}!=''");
  const fields = [
    "Company_Name", "Category", "Opportunity_Type",
    "Offer_DM_Title_At_Contact", "Offer_DM_Outcome", "Offer_DM_Title",
    "Offer_DM_Last_Selected",
  ];

  logAuth("Fetching companies with DM outcomes...");
  const records = await fetchAllPaginated("Companies", formula, fields, atConfig);
  logAuth(`Found ${records.length} companies with DM outcome data`);

  if (records.length === 0) {
    return {
      title_rankings: [],
      title_by_category: [],
      total_contacts_analyzed: 0,
      computed_at: Date.now(),
    };
  }

  const titleMap = new Map<string, TitleStats>();
  const catTitleMap = new Map<string, TitleCategoryStats>();

  for (const rec of records) {
    const f = rec.fields;
    const rawTitle = String(f.Offer_DM_Title_At_Contact || f.Offer_DM_Title || "").trim();
    if (!rawTitle) continue;

    const bucket = titleBucket(rawTitle);
    const outcome = String(f.Offer_DM_Outcome || "").trim();
    const category = String(f.Category || f.Opportunity_Type || "").trim();
    const contactDate = f.Offer_DM_Last_Selected || null;
    const weight = getTimeWeight(contactDate);

    if (!titleMap.has(bucket)) {
      titleMap.set(bucket, {
        title: bucket,
        total_contacts: 0,
        reached_dm: 0,
        converted: 0,
        wrong_person: 0,
        no_authority: 0,
        rejected: 0,
        authority_score: 0,
      });
    }

    const stats = titleMap.get(bucket)!;
    stats.total_contacts += weight;
    if (outcome === "reached_dm") stats.reached_dm += weight;
    else if (outcome === "converted") stats.converted += weight;
    else if (outcome === "wrong_person") stats.wrong_person += weight;
    else if (outcome === "no_authority") stats.no_authority += weight;
    else if (outcome === "rejected") stats.rejected += weight;

    if (category) {
      const catKey = `${bucket}|||${category}`;
      if (!catTitleMap.has(catKey)) {
        catTitleMap.set(catKey, {
          title: bucket,
          category,
          total_contacts: 0,
          reached_dm: 0,
          converted: 0,
          wrong_person: 0,
          no_authority: 0,
          rejected: 0,
          authority_score: 0,
        });
      }
      const catStats = catTitleMap.get(catKey)!;
      catStats.total_contacts += weight;
      if (outcome === "reached_dm") catStats.reached_dm += weight;
      else if (outcome === "converted") catStats.converted += weight;
      else if (outcome === "wrong_person") catStats.wrong_person += weight;
      else if (outcome === "no_authority") catStats.no_authority += weight;
      else if (outcome === "rejected") catStats.rejected += weight;
    }
  }

  const computeScore = (s: TitleStats): number => {
    if (s.total_contacts < MIN_CONTACTS_FOR_SCORE) return -1;
    return Math.round(((s.converted * 3 + s.reached_dm) / s.total_contacts) * 100);
  };

  for (const stats of titleMap.values()) {
    stats.authority_score = computeScore(stats);
  }
  for (const stats of catTitleMap.values()) {
    stats.authority_score = computeScore(stats);
  }

  const title_rankings = [...titleMap.values()]
    .filter(s => s.total_contacts >= MIN_CONTACTS_FOR_SCORE)
    .sort((a, b) => b.authority_score - a.authority_score);

  const title_by_category = [...catTitleMap.values()]
    .filter(s => s.total_contacts >= MIN_CONTACTS_FOR_SCORE)
    .sort((a, b) => b.authority_score - a.authority_score);

  logAuth(`Title effectiveness computed: ${title_rankings.length} titles with sufficient data`);

  return {
    title_rankings,
    title_by_category,
    total_contacts_analyzed: records.length,
    computed_at: Date.now(),
  };
}

export async function getDMAuthorityAdjustments(clientId?: string): Promise<DMAuthorityAdjustment[]> {
  const report = await computeTitleEffectiveness(clientId);

  if (report.title_rankings.length === 0) {
    logAuth("No authority data available — returning empty adjustments");
    return [];
  }

  const avgScore = report.title_rankings.reduce((sum, r) => sum + r.authority_score, 0) / report.title_rankings.length;

  const adjustments: DMAuthorityAdjustment[] = [];

  for (const ranking of report.title_rankings) {
    if (ranking.total_contacts < MIN_CONTACTS_FOR_ADJUSTMENT) continue;

    const deviation = ranking.authority_score - avgScore;
    const adjustment = Math.round(deviation * 0.3);

    if (Math.abs(adjustment) < 3) continue;

    const cappedAdj = Math.max(-25, Math.min(25, adjustment));
    const pattern = titleBucketToPattern(ranking.title);

    const direction = cappedAdj > 0 ? "boost" : "penalty";
    const convRate = ranking.total_contacts > 0
      ? Math.round((ranking.converted / ranking.total_contacts) * 100)
      : 0;

    adjustments.push({
      titlePattern: pattern,
      adjustment: cappedAdj,
      reason: `Authority learning ${direction}: ${ranking.title} has ${convRate}% conversion (${ranking.converted}/${ranking.total_contacts} contacts)`,
    });

    logAuth(`Authority adjustment: ${ranking.title} → ${cappedAdj > 0 ? "+" : ""}${cappedAdj} (score=${ranking.authority_score}, avg=${Math.round(avgScore)})`);
  }

  return adjustments;
}

export async function computeDMAuthorityReport(clientId?: string): Promise<DMAuthorityReport> {
  return computeTitleEffectiveness(clientId);
}

export async function snapshotAuthorityTrends(clientId: string): Promise<number> {
  const { storage } = await import("./storage");
  const report = await computeTitleEffectiveness(clientId);
  const now = new Date();
  const snapshotDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let inserted = 0;

  const existing = await storage.getAuthorityTrends(clientId);
  const todayStr = snapshotDate.toISOString().slice(0, 10);
  const alreadySnapped = existing.some(t =>
    new Date(t.snapshotDate).toISOString().slice(0, 10) === todayStr
  );
  if (alreadySnapped) {
    logAuth(`Authority trend snapshot already exists for ${todayStr} — skipping`);
    return 0;
  }

  for (const ranking of report.title_rankings) {
    const conversionRate = Math.min(100, Math.max(0, ranking.authority_score));
    const sampleSize = Math.round(ranking.total_contacts);
    await storage.insertAuthorityTrend(clientId, ranking.title, snapshotDate, conversionRate, sampleSize);
    inserted++;
  }

  logAuth(`Authority trend snapshot: ${inserted} title records for client ${clientId}`);
  return inserted;
}
