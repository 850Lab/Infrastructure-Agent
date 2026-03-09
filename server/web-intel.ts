import OpenAI from "openai";

function log(msg: string, tag: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [${tag}] ${msg}`);
}

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function logIntel(msg: string) {
  log(msg, "web-intel");
}

async function fetchPage(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; IntelBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);
  } catch {
    return "";
  }
}

const INTEL_PAGES = [
  "/", "/about", "/about-us", "/services", "/projects",
  "/news", "/blog", "/press", "/media", "/careers",
];

async function crawlWebsiteForIntel(website: string): Promise<string> {
  let domain = website.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (domain.includes("/")) domain = domain.split("/")[0];
  const baseUrl = `https://${domain}`;
  if (!isSafeUrl(baseUrl)) return "";
  let combined = "";
  let scanned = 0;

  for (const path of INTEL_PAGES) {
    if (scanned >= 5) break;
    const url = path === "/" ? baseUrl : `${baseUrl}${path}`;
    if (!isSafeUrl(url)) continue;
    const content = await fetchPage(url);
    if (content && content.length > 150) {
      combined += `\n--- ${path} ---\n${content}\n`;
      scanned++;
    }
  }

  logIntel(`Crawled ${scanned} pages from ${domain}`);
  return combined.slice(0, 25000);
}

interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
}

async function searchGoogleForCompany(
  companyName: string,
  city?: string,
  state?: string
): Promise<GoogleSearchResult[]> {
  if (!OUTSCRAPER_API_KEY) {
    logIntel("No OUTSCRAPER_API_KEY — skipping web search");
    return [];
  }

  const location = [city, state].filter(Boolean).join(", ");
  const query = `"${companyName}" ${location} industrial contractor projects news`;

  const params = new URLSearchParams({
    query,
    pages_per_query: "1",
    async: "false",
  });

  try {
    const res = await fetch(`https://api.outscraper.com/google-search-v3?${params}`, {
      headers: { "X-API-KEY": OUTSCRAPER_API_KEY },
    });

    if (!res.ok) {
      const text = await res.text();
      logIntel(`Google search error (${res.status}): ${text.slice(0, 200)}`);
      return [];
    }

    const data = await res.json();

    const results: GoogleSearchResult[] = [];
    const organic = data?.data?.[0]?.organic_results || data?.data?.[0] || [];
    const items = Array.isArray(organic) ? organic : [];

    for (const item of items.slice(0, 8)) {
      if (item.title && item.link) {
        results.push({
          title: String(item.title || ""),
          link: String(item.link || ""),
          snippet: String(item.snippet || item.description || ""),
        });
      }
    }

    logIntel(`Google search found ${results.length} results for "${companyName}"`);
    return results;
  } catch (e: any) {
    logIntel(`Google search failed: ${e.message}`);
    return [];
  }
}

function isSafeUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return false;
    if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("172.")) return false;
    if (host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (host === "169.254.169.254" || host === "metadata.google.internal") return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchSearchResultContent(results: GoogleSearchResult[]): Promise<string> {
  let combined = "";
  let fetched = 0;

  const blocked = ["linkedin.com", "facebook.com", "twitter.com", "instagram.com", "youtube.com", "yelp.com", "bbb.org", "mapquest.com"];

  for (const r of results) {
    if (fetched >= 3) break;
    if (!isSafeUrl(r.link)) continue;
    try {
      const url = new URL(r.link);
      if (blocked.some(b => url.hostname.includes(b))) continue;
    } catch {
      continue;
    }

    const content = await fetchPage(r.link);
    if (content && content.length > 200) {
      combined += `\n--- ${r.title} (${r.link}) ---\n${r.snippet}\n${content.slice(0, 6000)}\n`;
      fetched++;
    }
  }

  logIntel(`Fetched content from ${fetched} search result pages`);
  return combined.slice(0, 20000);
}

export interface CompanyIntel {
  summary: string;
  signals: string[];
  recentActivity: string;
  industryKeywords: string[];
  talkingPoints: string[];
  confidence: "high" | "medium" | "low";
}

async function analyzeIntelWithGPT(
  companyName: string,
  websiteContent: string,
  searchContent: string,
  searchSnippets: string,
  existingIntel: string
): Promise<CompanyIntel> {
  const combinedLength = websiteContent.length + searchContent.length;
  if (combinedLength < 100) {
    return {
      summary: `No public intel found for ${companyName}.`,
      signals: [],
      recentActivity: "",
      industryKeywords: [],
      talkingPoints: [],
      confidence: "low",
    };
  }

  const prompt = `You are a B2B sales intelligence analyst for industrial contractor outreach in the Gulf Coast region (Texas, Louisiana).

Analyze the following web data about "${companyName}" and extract ACTIONABLE SALES INTEL — information that would help a sales rep have a meaningful, personalized conversation.

WEBSITE CONTENT:
${websiteContent.slice(0, 12000) || "(No website content available)"}

WEB SEARCH RESULTS / SNIPPETS:
${searchSnippets || "(No search snippets)"}

SEARCH RESULT PAGE CONTENT:
${searchContent.slice(0, 12000) || "(No search result content available)"}

EXISTING INTEL:
${existingIntel || "(None)"}

Extract and return a JSON object with these fields:
{
  "summary": "2-3 sentence intel brief about this company. Focus on what they DO, how big they are, and what makes them relevant. Include specific details like service areas, specialties, notable clients, or project types. Never say 'no information found' — if you have ANY data, lead with the most useful detail.",
  "signals": ["Array of specific business signals found: recent projects, contract wins, expansions, hiring, safety incidents, regulatory filings, partnerships, equipment purchases. Each should be a specific finding, not generic."],
  "recentActivity": "Any recent news, projects, job postings, or changes. Include dates if found. Empty string if truly nothing.",
  "industryKeywords": ["Specific industry terms that describe their work: turnaround, shutdown, refinery, petrochemical, fabrication, mechanical, insulation, scaffolding, etc."],
  "talkingPoints": ["3-5 specific conversation starters a sales rep could use on a cold call. Reference actual details about the company. E.g., 'I saw you completed work on the Motiva Port Arthur project — how did that go?' or 'Your team does turnaround work in Lake Charles — are you staffing up for spring?'"],
  "confidence": "high/medium/low based on how much usable intel was found"
}

Be specific and actionable. Generic statements like "They are a contractor" are useless. If their website is a basic brochure, say what you CAN determine from it. If search results mention them in project databases, bid lists, or news articles, extract those specifics.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty GPT response");

  const parsed = JSON.parse(content);

  return {
    summary: String(parsed.summary || ""),
    signals: Array.isArray(parsed.signals) ? parsed.signals.map(String) : [],
    recentActivity: String(parsed.recentActivity || ""),
    industryKeywords: Array.isArray(parsed.industryKeywords) ? parsed.industryKeywords.map(String) : [],
    talkingPoints: Array.isArray(parsed.talkingPoints) ? parsed.talkingPoints.map(String) : [],
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
  };
}

function formatIntelForRankReason(intel: CompanyIntel, existingReason: string): string {
  const parts: string[] = [];

  if (intel.summary) {
    parts.push(intel.summary);
  }

  if (intel.talkingPoints.length > 0) {
    parts.push(`Talking point: ${intel.talkingPoints[0]}`);
  }

  if (intel.recentActivity) {
    parts.push(intel.recentActivity);
  }

  const bucketLine = existingReason.split(".").find(s =>
    s.includes("Hot follow-up") || s.includes("Fresh lead") || s.includes("Active pipeline") || s.includes("High priority")
  );
  if (bucketLine) {
    parts.unshift(bucketLine.trim() + ".");
  }

  return parts.join(" ").slice(0, 1500);
}

function formatIntelForEvidence(intel: CompanyIntel, existingEvidence: string): string {
  const lines: string[] = [];

  const existingLines = existingEvidence ? existingEvidence.split("\n").filter(l => l.trim()) : [];
  for (const line of existingLines) {
    if (!line.includes("Web Intel:") && !line.includes("Signals:") && !line.includes("Talking Points:") && !line.includes("Industry:")) {
      lines.push(line);
    }
  }

  if (intel.summary) {
    lines.push(`\u2022 Web Intel: ${intel.summary}`);
  }

  if (intel.signals.length > 0) {
    lines.push(`\u2022 Signals: ${intel.signals.slice(0, 3).join("; ")}`);
  }

  if (intel.recentActivity) {
    lines.push(`\u2022 Recent: ${intel.recentActivity}`);
  }

  if (intel.talkingPoints.length > 0) {
    lines.push(`\u2022 Talking Points: ${intel.talkingPoints.slice(0, 3).join(" | ")}`);
  }

  if (intel.industryKeywords.length > 0) {
    lines.push(`\u2022 Industry: ${intel.industryKeywords.join(", ")}`);
  }

  lines.push(`\u2022 Intel confidence: ${intel.confidence}`);

  return lines.join("\n").slice(0, 3000);
}

async function updateAirtableIntel(
  recordId: string,
  rankReason: string,
  rankEvidence: string
): Promise<void> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error("Airtable credentials not configured");
  }

  const encoded = encodeURIComponent("Companies");
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encoded}/${recordId}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        Rank_Reason: rankReason,
        Rank_Evidence: rankEvidence,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable update failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

export interface IntelResult {
  companyName: string;
  recordId: string;
  intel: CompanyIntel;
  updated: boolean;
  error?: string;
}

export async function gatherCompanyIntel(
  recordId: string,
  companyName: string,
  website: string | null,
  city?: string,
  state?: string,
  existingReason?: string,
  existingEvidence?: string,
  skipAirtableUpdate?: boolean
): Promise<IntelResult> {
  logIntel(`Gathering intel for ${companyName}...`);

  try {
    let websiteContent = "";
    let searchContent = "";
    let searchSnippets = "";

    const searchResults = await searchGoogleForCompany(companyName, city, state);

    if (searchResults.length > 0) {
      searchSnippets = searchResults
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.link}`)
        .join("\n\n");

      searchContent = await fetchSearchResultContent(searchResults);
    }

    if (website) {
      websiteContent = await crawlWebsiteForIntel(website);
    }

    const intel = await analyzeIntelWithGPT(
      companyName,
      websiteContent,
      searchContent,
      searchSnippets,
      existingReason || ""
    );

    if (!skipAirtableUpdate) {
      const newReason = formatIntelForRankReason(intel, existingReason || "");
      const newEvidence = formatIntelForEvidence(intel, existingEvidence || "");
      await updateAirtableIntel(recordId, newReason, newEvidence);
    }

    logIntel(`Intel gathered for ${companyName} (confidence: ${intel.confidence})`);

    return { companyName, recordId, intel, updated: !skipAirtableUpdate };
  } catch (e: any) {
    logIntel(`Intel error for ${companyName}: ${e.message}`);
    return { companyName, recordId, intel: { summary: "", signals: [], recentActivity: "", industryKeywords: [], talkingPoints: [], confidence: "low" }, updated: false, error: e.message };
  }
}

export async function runWebIntelForTodayList(limit: number = 25): Promise<{
  processed: number;
  updated: number;
  errors: number;
  results: IntelResult[];
}> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error("Airtable credentials not configured");
  }

  logIntel("Fetching today's call list for intel gathering...");

  const encoded = encodeURIComponent("Companies");
  const formula = encodeURIComponent("{Today_Call_List} = TRUE()");
  const fields = [
    "company_name", "website", "city", "state",
    "Rank_Reason", "Rank_Evidence",
  ].map(f => `fields[]=${f}`).join("&");

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encoded}?filterByFormula=${formula}&${fields}&pageSize=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable fetch error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const records = data.records || [];

  logIntel(`Found ${records.length} companies on today's list`);

  const results: IntelResult[] = [];
  let updated = 0;
  let errors = 0;

  const toProcess = records.slice(0, limit);

  for (const rec of toProcess) {
    const f = rec.fields;
    const companyName = String(f.company_name || "").trim();
    if (!companyName) continue;

    const existingReason = String(f.Rank_Reason || "");
    const hasWebIntel = existingReason.includes("Talking point:") || existingReason.includes("Web Intel:");
    if (hasWebIntel) {
      logIntel(`${companyName}: already has web intel — skipping`);
      continue;
    }

    const result = await gatherCompanyIntel(
      rec.id,
      companyName,
      f.website || null,
      f.city || "",
      f.state || "",
      f.Rank_Reason || "",
      f.Rank_Evidence || ""
    );

    results.push(result);
    if (result.updated) updated++;
    if (result.error) errors++;

    await new Promise(r => setTimeout(r, 1500));
  }

  logIntel(`Intel gathering complete: ${updated} updated, ${errors} errors out of ${results.length} processed`);

  return { processed: results.length, updated, errors, results };
}
