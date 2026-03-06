import { log } from "./logger";
import OpenAI from "openai";
import { getIndustryConfig } from "./config";
import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const proxyClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function logQI(message: string) {
  log(message, "query-intel");
}

async function airtableRequest(path: string, options: RequestInit = {}): Promise<any> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) throw new Error("Airtable credentials not configured");
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
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

async function fetchAllPaginated(table: string, formula?: string, fields?: string[]): Promise<any[]> {
  const encoded = encodeURIComponent(table);
  const records: any[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (formula) params.set("filterByFormula", formula);
    if (fields) fields.forEach(f => params.append("fields[]", f));
    if (offset) params.set("offset", offset);

    const data = await airtableRequest(`${encoded}?${params.toString()}`);
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

interface QueryRecord {
  id: string;
  query: string;
  category: string;
  market: string;
  status: string;
  lastRun: string | null;
  resultsCount: number;
  runs: number;
  wins: number;
  performanceScore: number;
  retired: boolean;
  notes: string;
}

export type WinTier = 'closed' | 'pipeline' | 'qualified' | null;

interface CompanyRecord {
  id: string;
  companyName: string;
  category: string;
  city: string;
  state: string;
  sourceQuery: string;
  firstSeen: string | null;
  timesCalled: number;
  leadStatus: string;
  engagementScore: number;
  primaryDMName: string;
  primaryDMEmail: string;
  primaryDMPhone: string;
  finalPriority: number;
  lastOutcome: string;
  winFlag: boolean;
  winTier: WinTier;
  opportunityStage: string;
  notes: string;
}

function parseQueryRecord(rec: any): QueryRecord {
  const f = rec.fields;
  return {
    id: rec.id,
    query: String(f.Query || f.query_text || "").trim(),
    category: String(f.Category || f.category || "").trim(),
    market: String(f.Market || f.market || "").trim(),
    status: String(f.Status || f.status || "").trim(),
    lastRun: f.Last_Run || f.last_run || null,
    resultsCount: parseInt(f.Results_Count || f.results_count || "0", 10) || 0,
    runs: parseInt(f.Runs || "0", 10) || 0,
    wins: parseInt(f.Wins || "0", 10) || 0,
    performanceScore: parseInt(f.Performance_Score || "0", 10) || 0,
    retired: !!f.Retired,
    notes: String(f.Notes || f.notes || "").trim(),
  };
}

function parseCompanyRecord(rec: any): CompanyRecord {
  const f = rec.fields;
  const parsed: CompanyRecord = {
    id: rec.id,
    companyName: String(f.company_name || f.Company_Name || "").trim(),
    category: String(f.Category || f.category || "").trim(),
    city: String(f.city || f.City || "").trim(),
    state: String(f.state || f.State || "").trim(),
    sourceQuery: String(f.Source_Query || "").trim(),
    firstSeen: f.First_Seen || null,
    timesCalled: parseInt(f.Times_Called || "0", 10) || 0,
    leadStatus: String(f.Lead_Status || "").trim(),
    engagementScore: parseInt(f.Engagement_Score || "0", 10) || 0,
    primaryDMName: String(f.Primary_DM_Name || "").trim(),
    primaryDMEmail: String(f.Primary_DM_Email || "").trim(),
    primaryDMPhone: String(f.Primary_DM_Phone || "").trim(),
    finalPriority: parseInt(f.Final_Priority || "0", 10) || 0,
    lastOutcome: String(f.Last_Outcome || "").trim(),
    winFlag: !!f.Win_Flag,
    winTier: null,
    opportunityStage: String(f.Opportunity_Stage || "").trim(),
    notes: String(f.Notes || f.notes || "").trim(),
  };
  parsed.winTier = getWinTier(parsed);
  return parsed;
}

const PIPELINE_STAGES = ['sitewalk', 'quotesent', 'deploymentscheduled'];

function getWinTier(c: CompanyRecord): WinTier {
  const leadStatusLower = c.leadStatus.toLowerCase();
  const stageLower = c.opportunityStage.toLowerCase();

  if (leadStatusLower === 'won' || stageLower === 'won') {
    return 'closed';
  }

  if (PIPELINE_STAGES.includes(stageLower)) {
    return 'pipeline';
  }

  const outcomeLower = c.lastOutcome.toLowerCase();
  if ((outcomeLower === 'qualified' || outcomeLower === 'decision maker') && c.engagementScore >= 10) {
    return 'qualified';
  }

  return null;
}

function isWin(c: CompanyRecord): boolean {
  const tier = c.winTier ?? getWinTier(c);
  return tier === 'closed' || tier === 'pipeline';
}

export interface QueryIntelConfig {
  generate: number;
  targetFresh: number;
  market: string;
}

export interface QueryIntelResult {
  freshCount: number;
  freshNeeded: number;
  queriesGenerated: number;
  queriesInserted: number;
  queriesSkippedDuplicates: number;
  queriesRetired: number;
  attributionMode: string;
  winFlagUpdated: number;
  queryStatsUpdated: number;
}

export async function runQueryIntel(config: QueryIntelConfig, clientId?: string): Promise<QueryIntelResult> {
  logQI("Fetching all data...");

  const clientFilter = clientId ? scopedFormula(clientId) : undefined;

  const [queryRecords, companyRecords, opportunityRecords] = await Promise.all([
    fetchAllPaginated("Search_Queries", clientFilter),
    fetchAllPaginated("Companies", clientFilter, [
      "company_name", "Company_Name", "Category", "category", "city", "City", "state", "State",
      "Source_Query", "First_Seen", "Times_Called", "Lead_Status", "Engagement_Score",
      "Primary_DM_Name", "Primary_DM_Email", "Primary_DM_Phone", "Final_Priority",
      "Last_Outcome", "Win_Flag", "Notes", "notes", "Opportunity_Stage"
    ]),
    fetchAllPaginated("Opportunities", clientFilter, ["Company", "Stage"]).catch(() => []),
  ]);

  const opportunityStageMap = new Map<string, string>();
  for (const rec of opportunityRecords) {
    const company = String(rec.fields?.Company || "").trim().toLowerCase();
    const stage = String(rec.fields?.Stage || "").trim();
    if (company && stage) {
      const existing = opportunityStageMap.get(company);
      const STAGE_RANK: Record<string, number> = { won: 5, deploymentscheduled: 4, quotesent: 3, sitewalk: 2, qualified: 1 };
      if (!existing || (STAGE_RANK[stage.toLowerCase()] || 0) > (STAGE_RANK[existing.toLowerCase()] || 0)) {
        opportunityStageMap.set(company, stage);
      }
    }
  }

  const queries = queryRecords.map(parseQueryRecord);
  const companies = companyRecords.map((rec: any) => {
    const c = parseCompanyRecord(rec);
    if (!c.opportunityStage) {
      const oppStage = opportunityStageMap.get(c.companyName.toLowerCase());
      if (oppStage) {
        c.opportunityStage = oppStage;
        c.winTier = getWinTier(c);
      }
    }
    return c;
  });

  logQI(`Loaded ${queries.length} queries, ${companies.length} companies`);

  const winFlagUpdated = await updateWinFlags(companies);
  logQI(`Win flags updated: ${winFlagUpdated}`);

  const { mode, statsUpdated } = await attributeAndScore(queries, companies);
  logQI(`Attribution mode: ${mode}, query stats updated: ${statsUpdated}`);

  const freshCount = companies.filter(c => {
    if (c.timesCalled > 0 && c.leadStatus !== "New") return false;
    if (!c.firstSeen) return true;
    const daysSince = (Date.now() - new Date(c.firstSeen).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince <= 14;
  }).length;

  const freshNeeded = Math.max(0, config.targetFresh - freshCount);
  logQI(`Fresh pool: ${freshCount}, target: ${config.targetFresh}, needed: ${freshNeeded}`);

  let queriesGenerated = 0;
  let queriesInserted = 0;
  let queriesSkippedDuplicates = 0;

  if (freshNeeded > 0 || config.generate > 0) {
    const winners = companies
      .filter(c => isWin(c))
      .sort((a, b) => b.finalPriority - a.finalPriority)
      .slice(0, 50);

    logQI(`Top winners for pattern extraction: ${winners.length}`);

    const winPatterns = extractWinPatterns(companies);
    if (winPatterns) {
      logQI(`Win patterns available: ${winPatterns.totalWinners} winners, top category: ${winPatterns.topCategories[0]?.category || "N/A"}`);
    }

    const existingQueryTexts = new Set(queries.map(q => q.query.toLowerCase().trim()));

    let newQueries: Array<{ query: string; category: string; market: string; rationale: string }>;
    let generatedBy = "QueryIntel";

    if (winners.length < 3) {
      logQI("COLD_START_MODE — not enough winners, using static templates");
      newQueries = generateColdStartQueries(config.market, config.generate);
    } else {
      newQueries = await generateIntelligentQueries(winners, config.market, config.generate, winPatterns);
      if (winPatterns) {
        generatedBy = "WinPattern";
      }
    }

    queriesGenerated = newQueries.length;

    const toInsert: typeof newQueries = [];
    for (const nq of newQueries) {
      const normalized = nq.query.toLowerCase().trim();
      if (existingQueryTexts.has(normalized)) {
        queriesSkippedDuplicates++;
        continue;
      }
      let similar = false;
      for (const existing of existingQueryTexts) {
        if (existing.includes(normalized) || normalized.includes(existing)) {
          similar = true;
          break;
        }
      }
      if (similar) {
        queriesSkippedDuplicates++;
        continue;
      }
      existingQueryTexts.add(normalized);
      toInsert.push(nq);
    }

    if (toInsert.length > 0) {
      const table = encodeURIComponent("Search_Queries");
      const batchSize = 10;
      for (let i = 0; i < toInsert.length; i += batchSize) {
        const batch = toInsert.slice(i, i + batchSize);
        const records = batch.map(q => ({
          fields: {
            Query: q.query,
            Category: q.category,
            Market: q.market,
            Status: "Queued",
            Results_Count: 0,
            Runs: 0,
            Wins: 0,
            Performance_Score: 0,
            Last_Generated_By: generatedBy,
            Generation_Mode: generatedBy,
            Notes: `Rationale: ${q.rationale}`,
            ...(clientId ? { Client_ID: clientId } : {}),
          },
        }));

        try {
          await airtableRequest(table, {
            method: "POST",
            body: JSON.stringify({ records }),
          });
          queriesInserted += batch.length;
        } catch (e: any) {
          logQI(`Insert error: ${e.message}`);
        }
      }
    }

    logQI(`Queries: ${queriesGenerated} generated, ${queriesInserted} inserted, ${queriesSkippedDuplicates} skipped`);
  }

  const queriesRetired = await retireLowPerformers(queries);
  logQI(`Queries retired: ${queriesRetired}`);

  if (freshNeeded > 0) {
    logQI(`FRESHNESS_ALERT: Need ${freshNeeded} more fresh leads. ${queriesInserted} new queries queued.`);
  }

  return {
    freshCount,
    freshNeeded,
    queriesGenerated,
    queriesInserted,
    queriesSkippedDuplicates,
    queriesRetired,
    attributionMode: mode,
    winFlagUpdated,
    queryStatsUpdated: statsUpdated,
  };
}

async function updateWinFlags(companies: CompanyRecord[]): Promise<number> {
  const table = encodeURIComponent("Companies");
  const toUpdate: Array<{ id: string; fields: { Win_Flag: boolean } }> = [];

  for (const c of companies) {
    const shouldBeWin = isWin(c);
    if (shouldBeWin !== c.winFlag) {
      toUpdate.push({ id: c.id, fields: { Win_Flag: shouldBeWin } });
      c.winFlag = shouldBeWin;
    }
  }

  if (toUpdate.length === 0) return 0;

  const batchSize = 10;
  for (let i = 0; i < toUpdate.length; i += batchSize) {
    const batch = toUpdate.slice(i, i + batchSize);
    try {
      await airtableRequest(table, {
        method: "PATCH",
        body: JSON.stringify({ records: batch }),
      });
    } catch (e: any) {
      logQI(`Win_Flag update error: ${e.message}`);
    }
  }

  return toUpdate.length;
}

async function attributeAndScore(
  queries: QueryRecord[],
  companies: CompanyRecord[]
): Promise<{ mode: string; statsUpdated: number }> {
  let mode = "exact";
  const queryWins = new Map<string, number>();
  const queryClosed = new Map<string, number>();
  const queryPipeline = new Map<string, number>();
  const queryQualified = new Map<string, number>();
  const queryNotInterested = new Map<string, number>();
  const queryDMFound = new Map<string, number>();

  for (const q of queries) {
    queryWins.set(q.id, 0);
    queryClosed.set(q.id, 0);
    queryPipeline.set(q.id, 0);
    queryQualified.set(q.id, 0);
    queryNotInterested.set(q.id, 0);
    queryDMFound.set(q.id, 0);
  }

  function attributeCompanyToQuery(queryId: string, c: CompanyRecord) {
    if (c.winFlag) queryWins.set(queryId, (queryWins.get(queryId) || 0) + 1);
    if (c.primaryDMName) queryDMFound.set(queryId, (queryDMFound.get(queryId) || 0) + 1);
    if (c.winTier === 'closed') queryClosed.set(queryId, (queryClosed.get(queryId) || 0) + 1);
    else if (c.winTier === 'pipeline') queryPipeline.set(queryId, (queryPipeline.get(queryId) || 0) + 1);
    else if (c.winTier === 'qualified') queryQualified.set(queryId, (queryQualified.get(queryId) || 0) + 1);
    const outcomeLower = c.lastOutcome.toLowerCase();
    if (outcomeLower === 'not interested') {
      queryNotInterested.set(queryId, (queryNotInterested.get(queryId) || 0) + 1);
    }
  }

  let exactMatches = 0;
  let approxMatches = 0;

  for (const c of companies) {
    if (c.sourceQuery) {
      const matchedQuery = queries.find(q =>
        q.query.toLowerCase() === c.sourceQuery.toLowerCase()
      );
      if (matchedQuery) {
        exactMatches++;
        attributeCompanyToQuery(matchedQuery.id, c);
        continue;
      }
    }

    if (c.firstSeen) {
      const firstSeenTime = new Date(c.firstSeen).getTime();
      for (const q of queries) {
        if (!q.lastRun) continue;
        const lastRunTime = new Date(q.lastRun).getTime();
        const hoursDiff = (firstSeenTime - lastRunTime) / (1000 * 60 * 60);
        if (hoursDiff >= 0 && hoursDiff <= 24) {
          const catMatch = !c.category || !q.category ||
            c.category.toLowerCase() === q.category.toLowerCase();
          if (catMatch) {
            approxMatches++;
            attributeCompanyToQuery(q.id, c);
            break;
          }
        }
      }
    }
  }

  if (approxMatches > exactMatches) mode = "approx";
  if (approxMatches > 0 && exactMatches === 0) mode = "approx";
  logQI(`Attribution: ${exactMatches} exact, ${approxMatches} approx (ATTRIB_APPROX)`);

  const table = encodeURIComponent("Search_Queries");
  let statsUpdated = 0;
  const updates: Array<{ id: string; fields: Record<string, any> }> = [];

  for (const q of queries) {
    const wins = queryWins.get(q.id) || 0;
    const closed = queryClosed.get(q.id) || 0;
    const pipeline = queryPipeline.get(q.id) || 0;
    const qualified = queryQualified.get(q.id) || 0;
    const notInterested = queryNotInterested.get(q.id) || 0;

    const perfScore = (closed * 50) + (pipeline * 30) + (qualified * 15) - (notInterested * 15);

    const computedRuns = (q.status === "Done" || q.status === "Error") ? Math.max(q.runs, 1) : q.runs;

    if (wins !== q.wins || perfScore !== q.performanceScore || computedRuns !== q.runs) {
      updates.push({
        id: q.id,
        fields: {
          Wins: wins,
          Runs: computedRuns,
          Performance_Score: perfScore,
        },
      });
    }
  }

  const batchSize = 10;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    try {
      await airtableRequest(table, {
        method: "PATCH",
        body: JSON.stringify({ records: batch }),
      });
      statsUpdated += batch.length;
    } catch (e: any) {
      logQI(`Query stats update error: ${e.message}`);
    }
  }

  return { mode, statsUpdated };
}


export interface WinPatternProfile {
  topCategories: Array<{ category: string; count: number; winRate: number }>;
  topCities: Array<{ city: string; count: number }>;
  topOpportunityTypes: Array<{ type: string; count: number }>;
  commonKeywords: string[];
  avgEngagement: number;
  closedWins: number;
  pipelineWins: number;
  totalWinners: number;
}

export function extractWinPatterns(companies: CompanyRecord[]): WinPatternProfile | null {
  const winners = companies.filter(c => c.winTier === 'closed' || c.winTier === 'pipeline');

  if (winners.length < 3) {
    logQI(`Win patterns: insufficient data (${winners.length} winners, need 3)`);
    return null;
  }

  const categoryCounts: Record<string, { total: number; wins: number }> = {};
  const cityCounts: Record<string, number> = {};
  const oppTypeCounts: Record<string, number> = {};
  const keywords: string[] = [];
  let totalEngagement = 0;

  const allByCategory: Record<string, number> = {};
  for (const c of companies) {
    if (c.category) allByCategory[c.category] = (allByCategory[c.category] || 0) + 1;
  }

  for (const w of winners) {
    if (w.category) {
      if (!categoryCounts[w.category]) categoryCounts[w.category] = { total: allByCategory[w.category] || 1, wins: 0 };
      categoryCounts[w.category].wins++;
    }
    if (w.city) cityCounts[w.city] = (cityCounts[w.city] || 0) + 1;

    const oppStage = w.opportunityStage;
    if (oppStage) oppTypeCounts[oppStage] = (oppTypeCounts[oppStage] || 0) + 1;

    totalEngagement += w.engagementScore;

    const text = `${w.companyName} ${w.notes} ${w.sourceQuery}`.toLowerCase();
    const kws = getIndustryConfig().opportunity_keywords;
    for (const kw of kws) {
      if (text.includes(kw)) keywords.push(kw);
    }
  }

  const topCategories = Object.entries(categoryCounts)
    .map(([category, { total, wins }]) => ({ category, count: wins, winRate: Math.round((wins / total) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const topCities = Object.entries(cityCounts)
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topOpportunityTypes = Object.entries(oppTypeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const closedWins = winners.filter(w => w.winTier === 'closed').length;
  const pipelineWins = winners.filter(w => w.winTier === 'pipeline').length;

  logQI(`Win patterns extracted: ${winners.length} winners (${closedWins} closed, ${pipelineWins} pipeline), ${topCategories.length} categories, ${topCities.length} cities`);

  return {
    topCategories,
    topCities,
    topOpportunityTypes,
    commonKeywords: [...new Set(keywords)].slice(0, 10),
    avgEngagement: Math.round(totalEngagement / winners.length),
    closedWins,
    pipelineWins,
    totalWinners: winners.length,
  };
}

function generateColdStartQueries(
  market: string,
  count: number
): Array<{ query: string; category: string; market: string; rationale: string }> {
  const cfg = getIndustryConfig();
  const templates = cfg.cold_start_queries.map(q => ({
    query: q.query,
    category: q.category,
    rationale: `COLD_START_MODE: ${q.category.toLowerCase()}`,
  }));

  const cities = cfg.geo.cities;

  const result: Array<{ query: string; category: string; market: string; rationale: string }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < count; i++) {
    const t = templates[i % templates.length];
    const city = cities[i % cities.length];
    const suffix = i >= templates.length ? ` ${cities[(i + 3) % cities.length]}` : "";
    const queryText = `${t.query} ${city}${suffix}`.trim();
    if (seen.has(queryText)) continue;
    seen.add(queryText);
    result.push({
      query: queryText,
      category: t.category,
      market: market,
      rationale: t.rationale,
    });
  }

  return result;
}

async function generateIntelligentQueries(
  winners: CompanyRecord[],
  market: string,
  count: number,
  winPatterns?: WinPatternProfile | null
): Promise<Array<{ query: string; category: string; market: string; rationale: string }>> {
  const categoryCounts: Record<string, number> = {};
  const cityCounts: Record<string, number> = {};
  const keywords: string[] = [];

  for (const w of winners) {
    if (w.category) categoryCounts[w.category] = (categoryCounts[w.category] || 0) + 1;
    if (w.city) cityCounts[w.city] = (cityCounts[w.city] || 0) + 1;

    const text = `${w.companyName} ${w.notes}`.toLowerCase();
    const kws = getIndustryConfig().opportunity_keywords;
    for (const kw of kws) {
      if (text.includes(kw)) keywords.push(kw);
    }
  }

  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat]) => cat);

  const topCities = Object.entries(cityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([city]) => city);

  const topKeywords = [...new Set(keywords)].slice(0, 10);

  const cfg = getIndustryConfig();
  const defaultCategories = cfg.company_categories.slice(0, 3).join(", ");
  const defaultCities = cfg.geo.cities.slice(0, 3).join(", ");
  const defaultKeywords = cfg.opportunity_keywords.slice(0, 4).join(", ");

  let winPatternContext = "";
  if (winPatterns) {
    const catInsight = winPatterns.topCategories
      .map(c => `${c.category} (${c.winRate}% win rate, ${c.count} wins)`)
      .join(", ");
    const cityInsight = winPatterns.topCities
      .map(c => `${c.city} (${c.count} wins)`)
      .join(", ");
    const oppInsight = winPatterns.topOpportunityTypes
      .map(o => `${o.type} (${o.count})`)
      .join(", ");

    winPatternContext = `
REAL WIN DATA (prioritize these patterns — they represent actual closed deals and pipeline):
- Winning categories by conversion rate: ${catInsight || "N/A"}
- Cities with most wins: ${cityInsight || "N/A"}
- Opportunity stages reached: ${oppInsight || "N/A"}
- Average engagement score of winners: ${winPatterns.avgEngagement}
- Total wins: ${winPatterns.closedWins} closed, ${winPatterns.pipelineWins} in pipeline
Focus at least 60% of queries on the highest win-rate categories and cities.`;
  }

  const prompt = `You are a B2B lead generation expert for ${cfg.name} in ${cfg.market}.

Based on these winning patterns from our best leads:
- Top categories: ${topCategories.join(", ") || defaultCategories}
- Top cities: ${topCities.join(", ") || defaultCities}
- Common keywords: ${topKeywords.join(", ") || defaultKeywords}
- Market: ${market}
${winPatternContext}

Generate exactly ${count} unique Google Maps search queries to find ${cfg.name.toLowerCase()}.
Each query should combine: category + location + 1-2 industry keywords.

Return strict JSON only:
{
  "queries": [
    {"query": "...", "category": "...", "market": "${market}", "rationale": "..."},
    ...
  ]
}

Valid categories: ${cfg.company_categories.join(", ")}`;

  try {
    const response = await proxyClient.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response");

    const parsed = JSON.parse(content);
    if (!parsed.queries || !Array.isArray(parsed.queries)) throw new Error("Invalid format");

    return parsed.queries.map((q: any) => ({
      query: String(q.query || "").toLowerCase().trim(),
      category: String(q.category || "Other").trim(),
      market: String(q.market || market).trim(),
      rationale: String(q.rationale || "AI-generated").trim(),
    }));
  } catch (e: any) {
    logQI(`OpenAI query generation failed: ${e.message}, falling back to cold start`);
    return generateColdStartQueries(market, count);
  }
}

export interface QueryIntelSummary {
  topQueries: Array<{ query: string; category: string; wins: number; runs: number; performanceScore: number }>;
  totalActive: number;
  totalRetired: number;
  winPatterns: WinPatternProfile | null;
  generationMode: string;
}

export async function getQueryIntelSummary(clientId?: string): Promise<QueryIntelSummary> {
  const clientFilter = clientId ? scopedFormula(clientId) : undefined;

  const [queryRecords, companyRecords, opportunityRecords] = await Promise.all([
    fetchAllPaginated("Search_Queries", clientFilter),
    fetchAllPaginated("Companies", clientFilter, [
      "company_name", "Company_Name", "Category", "category", "city", "City", "state", "State",
      "Source_Query", "First_Seen", "Times_Called", "Lead_Status", "Engagement_Score",
      "Primary_DM_Name", "Primary_DM_Email", "Primary_DM_Phone", "Final_Priority",
      "Last_Outcome", "Win_Flag", "Notes", "notes", "Opportunity_Stage"
    ]),
    fetchAllPaginated("Opportunities", clientFilter, ["Company", "Stage"]).catch(() => []),
  ]);

  const opportunityStageMap = new Map<string, string>();
  for (const rec of opportunityRecords) {
    const company = String(rec.fields?.Company || "").trim().toLowerCase();
    const stage = String(rec.fields?.Stage || "").trim();
    if (company && stage) {
      const existing = opportunityStageMap.get(company);
      const STAGE_RANK: Record<string, number> = { won: 5, deploymentscheduled: 4, quotesent: 3, sitewalk: 2, qualified: 1 };
      if (!existing || (STAGE_RANK[stage.toLowerCase()] || 0) > (STAGE_RANK[existing.toLowerCase()] || 0)) {
        opportunityStageMap.set(company, stage);
      }
    }
  }

  const queries = queryRecords.map(parseQueryRecord);
  const companies = companyRecords.map((rec: any) => {
    const c = parseCompanyRecord(rec);
    if (!c.opportunityStage) {
      const oppStage = opportunityStageMap.get(c.companyName.toLowerCase());
      if (oppStage) {
        c.opportunityStage = oppStage;
        c.winTier = getWinTier(c);
      }
    }
    return c;
  });

  const activeQueries = queries.filter(q => !q.retired);
  const retiredQueries = queries.filter(q => q.retired);

  const topQueries = activeQueries
    .filter(q => q.runs > 0)
    .sort((a, b) => b.performanceScore - a.performanceScore)
    .slice(0, 5)
    .map(q => ({
      query: q.query,
      category: q.category,
      wins: q.wins,
      runs: q.runs,
      performanceScore: q.performanceScore,
    }));

  const winPatterns = extractWinPatterns(companies);
  const winners = companies.filter(c => c.winTier === 'closed' || c.winTier === 'pipeline');
  const generationMode = winners.length >= 3 ? (winPatterns ? "WinPattern" : "Intelligent") : "ColdStart";

  return {
    topQueries,
    totalActive: activeQueries.length,
    totalRetired: retiredQueries.length,
    winPatterns,
    generationMode,
  };
}

async function retireLowPerformers(queries: QueryRecord[]): Promise<number> {
  const table = encodeURIComponent("Search_Queries");
  const toRetire: Array<{ id: string; fields: { Retired: boolean; Status: string } }> = [];

  for (const q of queries) {
    if (q.retired) continue;
    if (q.runs >= 3 && q.wins === 0 && q.resultsCount <= 2) {
      toRetire.push({
        id: q.id,
        fields: { Retired: true, Status: "Done" },
      });
    }
  }

  if (toRetire.length === 0) return 0;

  const batchSize = 10;
  for (let i = 0; i < toRetire.length; i += batchSize) {
    const batch = toRetire.slice(i, i + batchSize);
    try {
      await airtableRequest(table, {
        method: "PATCH",
        body: JSON.stringify({ records: batch }),
      });
    } catch (e: any) {
      logQI(`Retire error: ${e.message}`);
    }
  }

  return toRetire.length;
}
