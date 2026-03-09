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

  const prompt = `You are a B2B sales intelligence analyst for Texas Cool Down Trailers — we sell and lease MOBILE COOLING TRAILERS to industrial contractors working in high-heat environments along the Gulf Coast (Texas, Louisiana). Our trailers keep crews safe and productive during plant turnarounds, shutdowns, refinery maintenance, and any extended heat-exposure work.

YOUR JOB: Analyze the web data below about "${companyName}" and extract intel that helps our sales rep have a STRATEGIC conversation that leads to a trailer lease or purchase.

WHAT WE SELL:
- Mobile cooling stations/trailers deployed on-site at refineries, chemical plants, and industrial job sites
- Available for short-term (turnaround/shutdown) or extended lease, or purchase
- Designed for crews doing scaffolding, insulation, mechanical, coating, blasting, and maintenance work in extreme heat
- Key buyers: Safety Directors, HSE Managers, Site Superintendents, Operations Managers

WEBSITE CONTENT:
${websiteContent.slice(0, 12000) || "(No website content available)"}

WEB SEARCH RESULTS / SNIPPETS:
${searchSnippets || "(No search snippets)"}

SEARCH RESULT PAGE CONTENT:
${searchContent.slice(0, 12000) || "(No search result content available)"}

EXISTING INTEL:
${existingIntel || "(None)"}

Return a JSON object:
{
  "summary": "2-3 sentence intel brief. Focus on: what they do, where they work, crew size if findable, what kind of sites/projects (refinery, plant, offshore, etc.), and WHY they would need cooling trailers. Connect every detail back to heat exposure potential.",
  "signals": ["Specific findings that indicate they NEED cooling support: outdoor/indoor heat work, turnaround projects, refinery contracts, large crew sizes, OSHA safety focus, hiring surges, recent project wins at hot-environment sites. Each signal should explain WHY it means they need our trailers."],
  "recentActivity": "Recent projects, hiring, contract wins, or expansions — especially anything involving refinery work, plant shutdowns, turnarounds, or summer season staffing. Include dates if found.",
  "industryKeywords": ["Terms from their work that connect to heat exposure: turnaround, shutdown, refinery, petrochemical, insulation, scaffolding, blasting, coating, mechanical, plant maintenance, etc."],
  "talkingPoints": ["3-5 STRATEGIC conversation bridges that connect a specific detail about THIS company to our cooling trailers. Each talking point should: (1) reference something specific about them, and (2) bridge naturally to why they need on-site cooling. Examples of GOOD talking points: 'I saw your crews do insulation work at refineries in Lake Charles — those jobs get brutal in summer heat. How are you handling crew cooling on-site right now?' or 'You have a turnaround project coming up at the Motiva facility — have you locked in your heat mitigation plan yet? We deploy cooling trailers specifically for that.' or 'With your team doing scaffolding on refinery units, OSHA heat illness regs are tightening — are you set up with dedicated cooling stations?' BAD talking points (DO NOT GENERATE THESE): 'How is your business going?' or 'Tell me about your services' or 'I noticed you have a website.' Every talking point MUST connect to cooling/heat/safety."],
  "confidence": "high = found specific projects, crew details, or heat-related work indicators / medium = found general industrial work that implies heat exposure / low = minimal useful data"
}

CRITICAL RULES:
- Every talking point must be a BRIDGE from their specific situation to our cooling trailers
- If they do ANY work at refineries, chemical plants, or outdoor industrial sites, that IS a cooling trailer opportunity — say why
- If they mention OSHA, safety, HSE, or heat illness prevention, that directly connects to our product
- If they're hiring or expanding crews, that means more people who need cooling
- Do NOT generate generic business questions — every question must strategically lead toward a trailer conversation`;

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

  const bucketLine = existingReason.split(".").find(s =>
    s.includes("Hot follow-up") || s.includes("Fresh lead") || s.includes("Active pipeline") || s.includes("High priority")
  );
  if (bucketLine) {
    parts.push(bucketLine.trim() + ".");
  }

  if (intel.summary) {
    parts.push(intel.summary);
  }

  if (intel.talkingPoints.length > 0) {
    parts.push(`Talking point: ${intel.talkingPoints[0]}`);
  }

  if (intel.talkingPoints.length > 1) {
    parts.push(`Talking point: ${intel.talkingPoints[1]}`);
  }

  if (intel.recentActivity) {
    parts.push(intel.recentActivity);
  }

  return parts.join(" ").slice(0, 2000);
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

export async function runWebIntelForTodayList(limit: number = 25, force: boolean = false): Promise<{
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
    if (!force) {
      const hasWebIntel = existingReason.includes("Talking point:") || existingReason.includes("Web Intel:");
      if (hasWebIntel) {
        logIntel(`${companyName}: already has web intel — skipping`);
        continue;
      }
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
