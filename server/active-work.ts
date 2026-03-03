import { log } from "./index";
import OpenAI from "openai";

const proxyClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const GEOS = [
  { city: "Baytown", state: "TX" },
  { city: "Deer Park", state: "TX" },
  { city: "Pasadena", state: "TX" },
  { city: "La Porte", state: "TX" },
  { city: "Texas City", state: "TX" },
  { city: "Port Arthur", state: "TX" },
  { city: "Beaumont", state: "TX" },
  { city: "Lake Charles", state: "LA" },
  { city: "Baton Rouge", state: "LA" },
  { city: "Corpus Christi", state: "TX" },
];

const KEYWORDS = [
  "turnaround",
  "plant outage",
  "shutdown services",
  "refinery maintenance",
  "industrial cleaning plant",
  "hydroblasting refinery",
  "scaffolding refinery",
  "insulation contractor plant",
  "mechanical contractor plant services",
  "field services refinery",
];

export interface ActiveWorkQuery {
  query: string;
  city: string;
  state: string;
  keyword: string;
  is_active: boolean;
}

export function generateAllQueries(): ActiveWorkQuery[] {
  const queries: ActiveWorkQuery[] = [];
  for (const geo of GEOS) {
    for (const keyword of KEYWORDS) {
      queries.push({
        query: `${geo.city}, ${geo.state} "${keyword}"`,
        city: geo.city,
        state: geo.state,
        keyword,
        is_active: true,
      });
    }
  }
  log(`Generated ${queries.length} active work queries`, "active-work");
  return queries;
}

export function getGeos() {
  return GEOS;
}

export function getKeywords() {
  return KEYWORDS;
}

export async function fetchWebsiteContent(url: string): Promise<string> {
  try {
    let fetchUrl = url;
    if (!fetchUrl.startsWith("http")) {
      fetchUrl = `https://${fetchUrl}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ActiveWorkBot/1.0)",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return "";

    const html = await res.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 15000);
  } catch (e: any) {
    log(`Failed to fetch ${url}: ${e.message}`, "active-work");
    return "";
  }
}

export interface ScoreResult {
  score: number;
  turnaround_mentions: boolean;
  refinery_mentions: boolean;
  twentyfour_seven: boolean;
  crew_size_language: boolean;
  safety_hse_page: boolean;
  reasoning: string;
}

export async function scoreCompanyWebsite(url: string, companyName?: string): Promise<ScoreResult> {
  const content = await fetchWebsiteContent(url);

  if (!content || content.length < 50) {
    return {
      score: 0,
      turnaround_mentions: false,
      refinery_mentions: false,
      twentyfour_seven: false,
      crew_size_language: false,
      safety_hse_page: false,
      reasoning: "Could not fetch website content",
    };
  }

  const response = await proxyClient.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an industrial contractor analyst. Score a company's likelihood of currently working inside refineries or chemical plants based on their website content.

Return a JSON object with these exact fields:
{
  "score": <number 0-100>,
  "turnaround_mentions": <boolean - mentions turnaround, outage, shutdown work>,
  "refinery_mentions": <boolean - mentions refinery, chemical plant, petrochemical>,
  "twentyfour_seven": <boolean - mentions 24/7, on-site, emergency response>,
  "crew_size_language": <boolean - mentions crew, team size, workforce, manpower>,
  "safety_hse_page": <boolean - mentions safety program, HSE, OSHA, ISNetworld, DISA>,
  "reasoning": "<one sentence explaining the score>"
}

Scoring guide:
- 80-100: Clearly active in plant turnaround/maintenance work
- 60-79: Strong industrial presence, likely does plant work
- 40-59: Some industrial indicators but unclear
- 20-39: Generic contractor, unlikely plant work
- 0-19: No relevant indicators

Only return the JSON object, no other text.`,
      },
      {
        role: "user",
        content: `Company: ${companyName || url}\nWebsite URL: ${url}\n\nWebsite content:\n${content}`,
      },
    ],
    max_tokens: 500,
    temperature: 0.1,
  });

  const raw = response.choices[0]?.message?.content || "";
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      score: Math.min(100, Math.max(0, parsed.score || 0)),
      turnaround_mentions: !!parsed.turnaround_mentions,
      refinery_mentions: !!parsed.refinery_mentions,
      twentyfour_seven: !!parsed.twentyfour_seven,
      crew_size_language: !!parsed.crew_size_language,
      safety_hse_page: !!parsed.safety_hse_page,
      reasoning: parsed.reasoning || "",
    };
  } catch {
    log(`Failed to parse score response: ${raw.slice(0, 200)}`, "active-work");
    return {
      score: 0,
      turnaround_mentions: false,
      refinery_mentions: false,
      twentyfour_seven: false,
      crew_size_language: false,
      safety_hse_page: false,
      reasoning: "Failed to parse AI response",
    };
  }
}

async function airtableRequest(path: string, options: RequestInit = {}): Promise<any> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error("Airtable credentials not configured");
  }
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
    throw new Error(`Airtable error (${res.status}): ${text}`);
  }
  return res.json();
}

export async function writeQueriesToAirtable(queries: ActiveWorkQuery[]): Promise<number> {
  const tableName = encodeURIComponent("Search_Queries");
  const batchSize = 10;
  let written = 0;

  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const records = batch.map(q => ({
      fields: {
        query: q.query,
        city: q.city,
        state: q.state,
        keyword: q.keyword,
        is_active: q.is_active,
        type: "active_work",
        created_at: new Date().toISOString(),
      },
    }));

    await airtableRequest(tableName, {
      method: "POST",
      body: JSON.stringify({ records }),
    });
    written += batch.length;
  }

  log(`Wrote ${written} queries to Search_Queries`, "active-work");
  return written;
}

export async function updateCompanyScore(recordId: string, score: ScoreResult): Promise<void> {
  const tableName = encodeURIComponent("Companies");
  await airtableRequest(`${tableName}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        Active_Work_Score: score.score,
        score_turnaround: score.turnaround_mentions,
        score_refinery: score.refinery_mentions,
        score_24_7: score.twentyfour_seven,
        score_crew_size: score.crew_size_language,
        score_safety_hse: score.safety_hse_page,
        score_reasoning: score.reasoning,
        scored_at: new Date().toISOString(),
      },
    }),
  });
  log(`Updated score for record ${recordId}: ${score.score}`, "active-work");
}

export async function fetchCompaniesForScoring(limit = 50): Promise<Array<{ id: string; name: string; website: string }>> {
  const tableName = encodeURIComponent("Companies");
  const formula = encodeURIComponent("AND({website} != '', OR({Active_Work_Score} = BLANK(), {scored_at} = BLANK()))");
  const data = await airtableRequest(`${tableName}?filterByFormula=${formula}&pageSize=${limit}`);

  return (data.records || []).map((r: any) => ({
    id: r.id,
    name: r.fields.name || r.fields.Name || r.fields.company_name || "",
    website: r.fields.website || r.fields.Website || r.fields.url || "",
  })).filter((c: any) => c.website);
}

export async function fetchHighScoreCompanies(): Promise<any[]> {
  const tableName = encodeURIComponent("Companies");
  const formula = encodeURIComponent("AND({Active_Work_Score} > 70, {phone} != '')");
  const data = await airtableRequest(`${tableName}?filterByFormula=${formula}&pageSize=100&sort[0][field]=Active_Work_Score&sort[0][direction]=desc`);
  return data.records || [];
}

export async function disableLowScoreQueries(): Promise<{ disabled: number; generated: number }> {
  const tableName = encodeURIComponent("Search_Queries");
  const formula = encodeURIComponent("AND({is_active} = TRUE(), {type} = 'active_work')");
  const data = await airtableRequest(`${tableName}?filterByFormula=${formula}&pageSize=100`);
  const activeQueries = data.records || [];

  let disabled = 0;
  const usedKeywords = new Set<string>();

  for (const q of activeQueries) {
    const keyword = q.fields.keyword;
    const city = q.fields.city;
    usedKeywords.add(`${city}|${keyword}`);
  }

  const generated: ActiveWorkQuery[] = [];
  for (const geo of GEOS) {
    const unusedKeywords = KEYWORDS.filter(k => !usedKeywords.has(`${geo.city}|${k}`));
    if (unusedKeywords.length > 0) {
      const newKeyword = unusedKeywords[Math.floor(Math.random() * unusedKeywords.length)];
      generated.push({
        query: `${geo.city}, ${geo.state} "${newKeyword}"`,
        city: geo.city,
        state: geo.state,
        keyword: newKeyword,
        is_active: true,
      });
    }
  }

  if (generated.length > 0) {
    await writeQueriesToAirtable(generated);
  }

  return { disabled, generated: generated.length };
}
