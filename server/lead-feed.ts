import { log } from "./logger";
import OpenAI from "openai";
import { searchGoogleMaps } from "./outscraper";
import { getIndustryConfig } from "./config";
import { scopedFormula } from "./airtable-scoped";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const QUERIES_TABLE = "Search Queries";
const COMPANIES_TABLE = "Companies";

function getHighValueCategories(): Set<string> {
  const cfg = getIndustryConfig();
  return new Set(cfg.lead_feed.high_value_categories.map(c => c.toLowerCase()));
}

function getIndustrialKeywords(): string[] {
  return getIndustryConfig().lead_feed.industrial_keywords;
}

const RESIDENTIAL_KEYWORDS = [
  "residential only", "home remodeling", "kitchen remodel",
  "bathroom remodel", "home improvement", "landscaping",
  "lawn care", "pool cleaning", "handyman",
];

function getMarkets(): string[] {
  const cfg = getIndustryConfig();
  const markets: string[] = [];
  for (const city of cfg.geo.cities) {
    const state = cfg.geo.states[0] || "TX";
    markets.push(`${city} ${state}`);
  }
  return markets;
}

function getSearchCategories(): string[] {
  return getIndustryConfig().lead_feed.query_seeds;
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
    throw new Error(`Airtable error (${res.status}): ${text}`);
  }
  return res.json();
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\b(llc|inc|co|corp|ltd|lp|l\.l\.c|l\.p|incorporated|corporation|company)\b\.?/gi, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(website: string): string {
  if (!website) return "";
  try {
    let url = website.trim();
    if (!url.startsWith("http")) url = `https://${url}`;
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

function cleanPhone(phone: string): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function buildDedupeKey(normalizedDomain: string, phone: string, normalizedName: string, city: string, state: string): string {
  if (normalizedDomain) return normalizedDomain;
  const digits = cleanPhone(phone);
  if (digits.length >= 10) return digits;
  return `${normalizedName}|${(city || "").toLowerCase().trim()}|${(state || "").toLowerCase().trim()}`;
}

function computePriorityScore(category: string, description: string, website: string, phone: string): { score: number; tier: string } {
  let score = 0;

  const catLower = (category || "").toLowerCase();
  const HIGH_VALUE_CATEGORIES = getHighValueCategories();
  for (const hvc of HIGH_VALUE_CATEGORIES) {
    if (catLower.includes(hvc)) {
      score += 20;
      break;
    }
  }

  const descLower = (description || "").toLowerCase();
  const INDUSTRIAL_KEYWORDS = getIndustrialKeywords();
  const kwMatches = INDUSTRIAL_KEYWORDS.filter(kw => descLower.includes(kw) || catLower.includes(kw));
  if (kwMatches.length > 0) {
    score += Math.min(kwMatches.length * 5, 10);
  }

  if (website && website.trim().length > 5) score += 15;
  if (phone && cleanPhone(phone).length >= 10) score += 10;

  const residentialMatches = RESIDENTIAL_KEYWORDS.filter(kw => descLower.includes(kw) || catLower.includes(kw));
  if (residentialMatches.length > 0) {
    score -= Math.min(residentialMatches.length * 10, 20);
  }

  score = Math.max(0, Math.min(100, score));

  let tier: string;
  if (score >= 75) tier = "A";
  else if (score >= 50) tier = "B";
  else tier = "C";

  return { score, tier };
}

async function fetchExistingQueries(clientId?: string): Promise<Set<string>> {
  const table = encodeURIComponent(QUERIES_TABLE);
  const queries = new Set<string>();
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100", "fields[]": "query_text" });
    if (clientId) params.set("filterByFormula", scopedFormula(clientId));
    if (offset) params.set("offset", offset);

    try {
      const data = await airtableRequest(`${table}?${params.toString()}`);
      for (const rec of data.records || []) {
        const q = String(rec.fields.query_text || "").trim().toLowerCase();
        if (q) queries.add(q);
      }
      offset = data.offset;
    } catch (e: any) {
      if (e.message.includes("404") || e.message.includes("TABLE_NOT_FOUND") || e.message.includes("NOT_FOUND") || e.message.includes("INVALID_PERMISSIONS")) {
        log("Search Queries table not accessible — will try to create on first write", "lead-feed");
        break;
      }
      throw e;
    }
  } while (offset);

  return queries;
}

export async function generateQueries(count: number = 20, clientId?: string): Promise<{
  generated: number;
  written: number;
  duplicatesSkipped: number;
  queries: string[];
}> {
  log(`Generating ${count} search queries via OpenAI`, "lead-feed");

  const existingQueries = await fetchExistingQueries(clientId);
  log(`Found ${existingQueries.size} existing queries`, "lead-feed");

  const cfg = getIndustryConfig();
  const allMarkets = cfg.markets || getMarkets();
  const marketSample = [...allMarkets].sort(() => Math.random() - 0.5).slice(0, 8);
  const categorySample = [...getSearchCategories()].sort(() => Math.random() - 0.5).slice(0, 10);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `${cfg.lead_feed.gpt_prompt_context}

Generate queries that combine a service category with a city/market. Format: "{service} {city} {state}"

Rules:
- Each query should be a realistic Google Maps search
- Mix different service types and different cities
- Include both specific services and broader industry terms
- Vary the phrasing naturally (contractor, services, company, etc.)

Return ONLY a JSON array of query strings, no other text.`,
      },
      {
        role: "user",
        content: `Generate ${count} search queries.

Suggested markets to include: ${marketSample.join(", ")}
Suggested categories to include: ${categorySample.join(", ")}

Return a JSON array of ${count} query strings.`,
      },
    ],
    max_tokens: 2000,
    temperature: 0.8,
  });

  const raw = response.choices[0]?.message?.content || "";
  let queries: string[];
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    queries = JSON.parse(cleaned);
    if (!Array.isArray(queries)) throw new Error("Not an array");
    queries = queries.filter(q => typeof q === "string" && q.trim().length > 5);
  } catch {
    log(`Failed to parse GPT query response: ${raw.slice(0, 200)}`, "lead-feed");
    return { generated: 0, written: 0, duplicatesSkipped: 0, queries: [] };
  }

  log(`GPT generated ${queries.length} queries`, "lead-feed");

  const newQueries = queries.filter(q => !existingQueries.has(q.trim().toLowerCase()));
  const duplicatesSkipped = queries.length - newQueries.length;

  if (duplicatesSkipped > 0) {
    log(`Skipping ${duplicatesSkipped} duplicate queries`, "lead-feed");
  }

  const table = encodeURIComponent(QUERIES_TABLE);
  let written = 0;

  for (let i = 0; i < newQueries.length; i += 10) {
    const batch = newQueries.slice(i, i + 10);

    const allMkts = cfg.markets || getMarkets();
    const allSeeds = getSearchCategories();
    const marketPattern = new RegExp(`(${allMkts.map(m => m.split(" ")[0]).join("|")})`, "i");
    const categoryPattern = new RegExp(`(${allSeeds.map(c => c.split(" ")[0]).join("|")})`, "i");

    const records = batch.map(q => {
      const marketMatch = q.match(marketPattern);
      const catMatch = q.match(categoryPattern);
      return {
        fields: {
          query_text: q,
          market: marketMatch ? marketMatch[0] : cfg.market,
          category: catMatch ? catMatch[0] : cfg.company_categories[0] || "Other",
          status: "Queued",
          results_count: 0,
          ...(clientId ? { Client_ID: clientId } : {}),
        },
      };
    });

    try {
      await airtableRequest(table, {
        method: "POST",
        body: JSON.stringify({ records }),
      });
      written += batch.length;
    } catch (e: any) {
      log(`Failed to write queries batch: ${e.message}`, "lead-feed");
    }
  }

  log(`Wrote ${written} new queries to Search_Queries`, "lead-feed");
  return { generated: queries.length, written, duplicatesSkipped, queries: newQueries };
}

async function fetchQueuedQueries(limit: number, clientId?: string): Promise<Array<{ id: string; query: string; market: string; category: string }>> {
  const table = encodeURIComponent(QUERIES_TABLE);
  const baseFormula = "{status} = 'Queued'";
  const formula = encodeURIComponent(clientId ? scopedFormula(clientId, baseFormula) : baseFormula);
  const data = await airtableRequest(`${table}?filterByFormula=${formula}&pageSize=${limit}`);

  return (data.records || []).map((r: any) => ({
    id: r.id,
    query: r.fields.query_text || "",
    market: r.fields.market || "",
    category: r.fields.category || "",
  })).filter((q: any) => q.query);
}

async function setQueryStatus(recordId: string, status: string, notesText?: string, resultsCount?: number) {
  const table = encodeURIComponent(QUERIES_TABLE);
  const fields: Record<string, any> = { status };
  if (status === "Running" || status === "Done") fields.last_run = new Date().toISOString();
  if (notesText) fields.notes = notesText;
  if (resultsCount !== undefined) fields.results_count = resultsCount;

  await airtableRequest(`${table}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

async function findExistingCompany(dedupeKey: string, normalizedName: string, normalizedDomain: string, clientId?: string): Promise<{ id: string; fields: Record<string, any> } | null> {
  const table = encodeURIComponent(COMPANIES_TABLE);
  const sf = (f: string) => clientId ? scopedFormula(clientId, f) : f;

  if (dedupeKey) {
    try {
      const formula = encodeURIComponent(sf(`{Dedupe_Key} = '${dedupeKey.replace(/'/g, "\\'")}'`));
      const data = await airtableRequest(`${table}?filterByFormula=${formula}&pageSize=1`);
      if (data.records && data.records.length > 0) {
        return { id: data.records[0].id, fields: data.records[0].fields };
      }
    } catch { }
  }

  if (normalizedDomain) {
    try {
      const formula = encodeURIComponent(sf(`{Normalized_Domain} = '${normalizedDomain.replace(/'/g, "\\'")}'`));
      const data = await airtableRequest(`${table}?filterByFormula=${formula}&pageSize=1`);
      if (data.records && data.records.length > 0) {
        return { id: data.records[0].id, fields: data.records[0].fields };
      }
    } catch { }
  }

  if (normalizedName && normalizedName.length > 3) {
    try {
      const formula = encodeURIComponent(sf(`LOWER({company_name}) = '${normalizedName.replace(/'/g, "\\'")}'`));
      const data = await airtableRequest(`${table}?filterByFormula=${formula}&pageSize=1`);
      if (data.records && data.records.length > 0) {
        return { id: data.records[0].id, fields: data.records[0].fields };
      }
    } catch { }
  }

  return null;
}

interface OutscraperCompanyResult {
  name: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  category: string;
  description: string;
  place_id: string;
  full_address: string;
}

function parseOutscraperResult(raw: any): OutscraperCompanyResult {
  const addr = String(raw.full_address || raw.address || "");
  let city = "";
  let state = "";

  const addrParts = addr.split(",").map((s: string) => s.trim());
  if (addrParts.length >= 3) {
    city = addrParts[addrParts.length - 3] || addrParts[1] || "";
    const stateZip = addrParts[addrParts.length - 2] || "";
    state = stateZip.replace(/\d+/g, "").trim();
  } else if (addrParts.length === 2) {
    city = addrParts[0];
    state = addrParts[1].replace(/\d+/g, "").trim();
  }

  const rawDesc = raw.description || raw.about || raw.snippet || "";
  const description = typeof rawDesc === "string" ? rawDesc : (Array.isArray(rawDesc) ? rawDesc.join(" ") : String(rawDesc));
  const rawCat = raw.category || raw.type || "";
  const categoryStr = typeof rawCat === "string" ? rawCat : (Array.isArray(rawCat) ? rawCat.join(", ") : String(rawCat));

  return {
    name: String(raw.name || ""),
    phone: String(raw.phone || raw.phone_number || ""),
    website: String(raw.site || raw.website || ""),
    city: String(raw.city || city),
    state: String(raw.state || state),
    category: categoryStr,
    description,
    place_id: String(raw.place_id || raw.google_id || ""),
    full_address: addr,
  };
}

async function searchOutscraperFull(query: string, retryCount: number = 0): Promise<any[]> {
  const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
  if (!OUTSCRAPER_API_KEY) throw new Error("OUTSCRAPER_API_KEY not configured");

  const params = new URLSearchParams({
    query,
    limit: "20",
    async: "false",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let res: Response;
  try {
    res = await fetch(`https://api.outscraper.com/maps/search-v3?${params}`, {
      headers: { "X-API-KEY": OUTSCRAPER_API_KEY },
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new Error("Outscraper request timed out after 120s");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (res.status === 429) {
    if (retryCount >= 3) {
      throw new Error("Outscraper rate limited after 3 retries — aborting");
    }
    const waitMs = 10000 * Math.pow(2, retryCount);
    log(`Outscraper rate limited — waiting ${waitMs / 1000}s (retry ${retryCount + 1}/3)`, "lead-feed");
    await new Promise(r => setTimeout(r, waitMs));
    return searchOutscraperFull(query, retryCount + 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Outscraper error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.status !== "Success" || !data.data?.[0]) return [];
  return data.data[0] || [];
}

export async function runOutscraper(queryLimit: number = 5, clientId?: string): Promise<{
  queriesProcessed: number;
  totalResults: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const queries = await fetchQueuedQueries(queryLimit, clientId);
  log(`Found ${queries.length} queued queries to process`, "lead-feed");

  let totalResults = 0;
  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const q of queries) {
    try {
      await setQueryStatus(q.id, "Running");
      log(`Running query: "${q.query}"`, "lead-feed");

      const rawResults = await searchOutscraperFull(q.query);
      log(`Got ${rawResults.length} raw results for "${q.query}"`, "lead-feed");

      let queryCreated = 0;
      let queryUpdated = 0;

      for (const raw of rawResults) {
        try {
          const parsed = parseOutscraperResult(raw);
          if (!parsed.name || parsed.name.length < 2) continue;

          const normalizedName = normalizeName(parsed.name);
          const normalizedDomain = normalizeDomain(parsed.website);
          const phoneDigits = cleanPhone(parsed.phone);
          const dedupeKey = buildDedupeKey(normalizedDomain, parsed.phone, normalizedName, parsed.city, parsed.state);

          const { score, tier } = computePriorityScore(
            parsed.category,
            parsed.description,
            parsed.website,
            parsed.phone,
          );

          const existing = await findExistingCompany(dedupeKey, normalizedName, normalizedDomain, clientId);

          if (existing) {
            const updates: Record<string, any> = {};
            const ef = existing.fields;

            if (!ef.website && parsed.website) updates.website = parsed.website;
            if (!ef.phone && parsed.phone) updates.phone = parsed.phone;
            if (!ef.city && parsed.city) updates.city = parsed.city;
            if (!ef.state && parsed.state) updates.state = parsed.state;
            if (!ef.category && parsed.category) updates.category = parsed.category;
            if (!ef.Normalized_Name) updates.Normalized_Name = normalizedName;
            if (!ef.Normalized_Domain && normalizedDomain) updates.Normalized_Domain = normalizedDomain;
            if (!ef.Dedupe_Key) updates.Dedupe_Key = dedupeKey;
            if (!ef.source_place_id && parsed.place_id) updates.source_place_id = parsed.place_id;
            if (parsed.website && !ef.Normalized_Domain) updates.Normalized_Domain = normalizedDomain;

            if (!ef.Priority_Score || Number(ef.Priority_Score) < score) {
              updates.Priority_Score = score;
            }

            if (Object.keys(updates).length > 0) {
              const table = encodeURIComponent(COMPANIES_TABLE);
              await airtableRequest(`${table}/${existing.id}`, {
                method: "PATCH",
                body: JSON.stringify({ fields: updates }),
              });
              queryUpdated++;
            }
          } else {
            const newFields: Record<string, any> = {
              company_name: parsed.name,
              Normalized_Name: normalizedName,
              Dedupe_Key: dedupeKey,
              source: "Outscraper",
              Source_Query: q.query,
              Lead_Status: "New",
              Priority_Score: score,
              ...(clientId ? { Client_ID: clientId } : {}),
            };

            if (parsed.website) {
              newFields.website = parsed.website;
              newFields.Normalized_Domain = normalizedDomain;
            }
            if (parsed.phone) newFields.phone = parsed.phone;
            if (parsed.city) newFields.city = parsed.city;
            if (parsed.state) newFields.state = parsed.state;
            if (parsed.category) newFields.category = parsed.category;
            if (parsed.place_id) newFields.source_place_id = parsed.place_id;

            const table = encodeURIComponent(COMPANIES_TABLE);
            await airtableRequest(table, {
              method: "POST",
              body: JSON.stringify({ records: [{ fields: newFields }] }),
            });
            queryCreated++;
          }
        } catch (e: any) {
          log(`Error processing result "${raw.name}": ${e.message}`, "lead-feed");
        }

        await new Promise(r => setTimeout(r, 200));
      }

      totalResults += rawResults.length;
      created += queryCreated;
      updated += queryUpdated;

      await setQueryStatus(q.id, "Done", `${rawResults.length} results, ${queryCreated} new, ${queryUpdated} updated`, rawResults.length);
      log(`Query done: "${q.query}" → ${rawResults.length} results, ${queryCreated} new, ${queryUpdated} updated`, "lead-feed");
    } catch (e: any) {
      const errMsg = `Query "${q.query}" failed: ${e.message}`;
      log(errMsg, "lead-feed");
      errors.push(errMsg);
      try {
        await setQueryStatus(q.id, "Error", e.message);
      } catch { }
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  log(`Runner complete: ${queries.length} queries, ${totalResults} results, ${created} created, ${updated} updated`, "lead-feed");
  return { queriesProcessed: queries.length, totalResults, created, updated, errors };
}

async function fetchPage(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadFeedBot/1.0)" },
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

    return text.slice(0, 12000);
  } catch {
    return "";
  }
}

function extractEmailsFromText(text: string): string[] {
  const pattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = text.match(pattern) || [];
  return [...new Set(emails)]
    .filter(e =>
      !e.includes("@sentry") &&
      !e.includes("@example") &&
      !e.includes("@wixpress") &&
      !e.includes("@wordpress") &&
      !e.endsWith(".png") &&
      !e.endsWith(".jpg") &&
      !e.endsWith(".svg")
    )
    .slice(0, 10);
}

function extractLinkedInUrl(text: string, html?: string): string {
  const source = html || text;
  const match = source.match(/https?:\/\/(www\.)?linkedin\.com\/company\/[^\s"'<>]+/i);
  return match ? match[0].replace(/["']/g, "") : "";
}

export async function enrichLeads(limit: number = 10, clientId?: string): Promise<{
  processed: number;
  enriched: number;
  results: Array<{ companyName: string; emails: string[]; linkedinUrl: string; notesSummary: string }>;
}> {
  const table = encodeURIComponent(COMPANIES_TABLE);
  const baseFormula = "AND({website} != '', OR({Lead_Status} = 'New', {Lead_Status} = 'Enriched', {Lead_Status} = BLANK()), OR({enriched_at} = BLANK(), DATETIME_DIFF(NOW(), {enriched_at}, 'days') > 14))";
  const formula = encodeURIComponent(clientId ? scopedFormula(clientId, baseFormula) : baseFormula);

  const data = await airtableRequest(`${table}?filterByFormula=${formula}&pageSize=${limit}`);
  const records = data.records || [];

  log(`Found ${records.length} companies to enrich`, "lead-feed");

  let enriched = 0;
  const results: Array<{ companyName: string; emails: string[]; linkedinUrl: string; notesSummary: string }> = [];

  for (const rec of records) {
    const companyName = rec.fields.company_name || rec.fields.Company_Name || "Unknown";
    const website = rec.fields.website || "";
    if (!website) continue;

    try {
      let domain: string;
      try {
        let url = website.trim();
        if (!url.startsWith("http")) url = `https://${url}`;
        domain = new URL(url).origin;
      } catch {
        domain = `https://${website.replace(/^https?:\/\//i, "")}`;
      }

      let allText = "";
      let allHtml = "";

      const homeText = await fetchPage(domain);
      allText += homeText;

      if (homeText.length < 500) {
        for (const path of ["/services", "/about", "/about-us", "/contact"]) {
          const pageText = await fetchPage(`${domain}${path}`);
          if (pageText.length > 200) {
            allText += " " + pageText;
          }
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        for (const path of ["/contact", "/about"]) {
          const pageText = await fetchPage(`${domain}${path}`);
          if (pageText.length > 200) {
            allText += " " + pageText;
          }
          await new Promise(r => setTimeout(r, 300));
        }
      }

      const emails = extractEmailsFromText(allText);
      const linkedinUrl = extractLinkedInUrl(allText);

      let notesSummary = "";
      if (allText.length > 200) {
        try {
          const summaryResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: "Summarize this industrial contractor's services and industries served in 2-3 concise sentences. Focus on: what services they provide, what industries they serve, and any specializations. If you can't determine this, say 'Unable to determine services from website.'",
              },
              {
                role: "user",
                content: `Company: ${companyName}\nWebsite text:\n${allText.slice(0, 6000)}`,
              },
            ],
            max_tokens: 200,
            temperature: 0.1,
          });
          notesSummary = summaryResponse.choices[0]?.message?.content || "";
        } catch (e: any) {
          log(`GPT summary failed for ${companyName}: ${e.message}`, "lead-feed");
        }
      }

      const updateFields: Record<string, any> = {
        enriched_at: new Date().toISOString(),
      };

      if (emails.length > 0) updateFields.emails_found = emails.join(", ");
      if (linkedinUrl) {
        updateFields.linkedin_url = linkedinUrl;
        updateFields.Social_Media = linkedinUrl;
      }
      if (notesSummary) updateFields.company_summary = notesSummary;

      const currentStatus = rec.fields.Lead_Status || "";
      if (!currentStatus || currentStatus === "New") {
        updateFields.Lead_Status = "Enriched";
      }

      await airtableRequest(`${table}/${rec.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: updateFields }),
      });

      enriched++;
      results.push({ companyName, emails, linkedinUrl, notesSummary: notesSummary.slice(0, 100) });
      log(`Enriched ${companyName}: ${emails.length} emails, LinkedIn: ${linkedinUrl ? "yes" : "no"}`, "lead-feed");
    } catch (e: any) {
      log(`Error enriching ${companyName}: ${e.message}`, "lead-feed");
      results.push({ companyName, emails: [], linkedinUrl: "", notesSummary: `Error: ${e.message}` });
    }

    await new Promise(r => setTimeout(r, 500));
  }

  log(`Enrichment complete: ${enriched}/${records.length} enriched`, "lead-feed");
  return { processed: records.length, enriched, results };
}

export async function runFullPipeline(options: {
  queryCount?: number;
  queryLimit?: number;
  enrichLimit?: number;
  skipGenerate?: boolean;
  skipOutscraper?: boolean;
  skipEnrich?: boolean;
} = {}): Promise<{
  generate?: Awaited<ReturnType<typeof generateQueries>>;
  outscraper?: Awaited<ReturnType<typeof runOutscraper>>;
  enrich?: Awaited<ReturnType<typeof enrichLeads>>;
}> {
  const result: any = {};

  if (!options.skipGenerate) {
    log("=== Stage 1: Query Generation ===", "lead-feed");
    result.generate = await generateQueries(options.queryCount || 15);
  }

  if (!options.skipOutscraper) {
    log("=== Stage 2: Outscraper Runner ===", "lead-feed");
    result.outscraper = await runOutscraper(options.queryLimit || 5);
  }

  if (!options.skipEnrich) {
    log("=== Stage 3: Lead Enrichment ===", "lead-feed");
    result.enrich = await enrichLeads(options.enrichLimit || 10);
  }

  log("=== Lead Feed Pipeline Complete ===", "lead-feed");
  return result;
}

export async function getLeadFeedStats(): Promise<{
  totalQueries: number;
  queuedQueries: number;
  doneQueries: number;
  errorQueries: number;
  totalCompanies: number;
  tierA: number;
  tierB: number;
  tierC: number;
  newLeads: number;
  enrichedLeads: number;
}> {
  const qTable = encodeURIComponent(QUERIES_TABLE);
  const cTable = encodeURIComponent(COMPANIES_TABLE);

  let totalQueries = 0, queuedQueries = 0, doneQueries = 0, errorQueries = 0;

  try {
    let offset: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: "100", "fields[]": "status" });
      if (offset) params.set("offset", offset);
      const data = await airtableRequest(`${qTable}?${params.toString()}`);
      for (const rec of data.records || []) {
        totalQueries++;
        const st = rec.fields.status || "";
        if (st === "Queued") queuedQueries++;
        else if (st === "Done") doneQueries++;
        else if (st === "Error") errorQueries++;
      }
      offset = data.offset;
    } while (offset);
  } catch (e: any) {
    log(`Stats: failed to read Search_Queries: ${e.message}`, "lead-feed");
  }

  let totalCompanies = 0, tierA = 0, tierB = 0, tierC = 0, newLeads = 0, enrichedLeads = 0;

  try {
    let offset: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      params.append("fields[]", "company_name");
      if (offset) params.set("offset", offset);
      const data = await airtableRequest(`${cTable}?${params.toString()}`);
      for (const rec of data.records || []) {
        totalCompanies++;
        const ps = Number(rec.fields.Priority_Score || 0);
        if (ps >= 75) tierA++;
        else if (ps >= 50) tierB++;
        else if (ps > 0) tierC++;
        const ls = rec.fields.Lead_Status || "";
        if (ls === "New") newLeads++;
        else if (ls === "Enriched") enrichedLeads++;
      }
      offset = data.offset;
    } while (offset);
  } catch (e: any) {
    log(`Stats: failed to read Companies: ${e.message}`, "lead-feed");
  }

  return {
    totalQueries, queuedQueries, doneQueries, errorQueries,
    totalCompanies, tierA, tierB, tierC, newLeads, enrichedLeads,
  };
}
