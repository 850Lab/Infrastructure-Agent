import { log } from "./index";
import OpenAI from "openai";
import { enrichOrganization } from "./apollo";

const proxyClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

export interface DecisionMaker {
  full_name: string;
  title: string;
  email: string;
  phone: string;
  linkedin_url: string;
  seniority: string;
  department: string;
  source: string;
}

export interface EnrichmentResult {
  companyRecordId: string;
  companyName: string;
  domain: string;
  decisionMakers: DecisionMaker[];
  apolloData: {
    estimated_employees: number | null;
    industry: string;
    linkedin_url: string;
    short_description: string;
  } | null;
  pagesScanned: number;
  error?: string;
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

function extractDomain(website: string): string {
  try {
    let url = website.trim();
    if (!url.startsWith("http")) url = `https://${url}`;
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

async function fetchPage(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DMEnrichBot/1.0)" },
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

const TEAM_PAGE_PATHS = [
  "/about", "/about-us", "/about-us/", "/about/",
  "/team", "/our-team", "/team/", "/our-team/",
  "/leadership", "/leadership-team", "/leadership/",
  "/management", "/management-team",
  "/staff", "/our-staff",
  "/people", "/our-people",
  "/company", "/company/about",
  "/who-we-are",
  "/contact", "/contact-us",
];

async function crawlForTeamPages(domain: string): Promise<{ content: string; pagesScanned: number }> {
  const baseUrl = `https://${domain}`;
  let combinedContent = "";
  let pagesScanned = 0;

  const homePage = await fetchPage(baseUrl);
  if (homePage) {
    combinedContent += `\n--- Homepage ---\n${homePage}`;
    pagesScanned++;
  }

  const foundPaths: string[] = [];
  for (const path of TEAM_PAGE_PATHS) {
    const lcHome = homePage.toLowerCase();
    if (lcHome.includes(`href="${path}"`) || lcHome.includes(`href="/${path.replace(/^\//, "")}"`)) {
      foundPaths.push(path);
    }
  }

  const pathsToTry = [...new Set([...foundPaths, "/about", "/about-us", "/team", "/our-team", "/leadership", "/contact"])];

  for (const path of pathsToTry.slice(0, 6)) {
    const pageContent = await fetchPage(`${baseUrl}${path}`);
    if (pageContent && pageContent.length > 200) {
      const lcContent = pageContent.toLowerCase();
      const hasNames = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(pageContent);
      const hasRoles = ["president", "vice president", "director", "manager", "ceo", "cfo", "coo", "vp", "superintendent", "foreman"]
        .some(r => lcContent.includes(r));

      if (hasNames || hasRoles || lcContent.includes("team") || lcContent.includes("leadership")) {
        combinedContent += `\n--- ${path} ---\n${pageContent}`;
        pagesScanned++;
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }

  return { content: combinedContent.slice(0, 30000), pagesScanned };
}

async function extractDMsWithGPT(content: string, companyName: string, domain: string): Promise<DecisionMaker[]> {
  if (!content || content.length < 100) return [];

  const response = await proxyClient.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an industrial contractor analyst. Extract real decision makers from company website content. Focus on people who would make decisions about:
- Turnaround/shutdown work
- Plant maintenance
- Field services / crew deployment
- Safety / HSE
- Operations

Return a JSON array of people found. For each person include:
{
  "full_name": "First Last",
  "title": "Their actual title from the website",
  "email": "email if found, empty string if not",
  "phone": "direct phone if found, empty string if not",
  "linkedin_url": "LinkedIn URL if found, empty string if not",
  "seniority": "c_suite|vp|director|manager|other",
  "department": "operations|safety|maintenance|executive|sales|other"
}

Rules:
- Only include people with real first AND last names (not generic titles)
- Only include people whose names actually appear on the website
- Do NOT make up names or guess
- If no real names are found, return an empty array []
- Prioritize: President/CEO, VP Operations, Safety Director, Maintenance Manager, Plant Manager

Return ONLY the JSON array, no other text.`,
      },
      {
        role: "user",
        content: `Company: ${companyName}\nDomain: ${domain}\n\nWebsite content:\n${content}`,
      },
    ],
    max_tokens: 2000,
    temperature: 0.1,
  });

  const raw = response.choices[0]?.message?.content || "";
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((p: any) => p.full_name && p.full_name.includes(" "))
      .map((p: any) => ({
        full_name: String(p.full_name || ""),
        title: String(p.title || ""),
        email: String(p.email || ""),
        phone: String(p.phone || ""),
        linkedin_url: String(p.linkedin_url || ""),
        seniority: String(p.seniority || "other"),
        department: String(p.department || "other"),
        source: "website_crawl",
      }));
  } catch {
    log(`Failed to parse GPT DM response: ${raw.slice(0, 200)}`, "dm-enrich");
    return [];
  }
}

export async function enrichCompany(recordId: string): Promise<EnrichmentResult> {
  const encoded = encodeURIComponent("Companies");
  const record = await airtableRequest(`${encoded}/${recordId}`);
  const fields = record.fields;

  const companyName = fields.company_name || "Unknown";
  const website = fields.website || "";

  if (!website) {
    return {
      companyRecordId: recordId,
      companyName,
      domain: "",
      decisionMakers: [],
      apolloData: null,
      pagesScanned: 0,
      error: "No website URL",
    };
  }

  const domain = extractDomain(website);
  log(`Enriching ${companyName} (${domain})`, "dm-enrich");

  let apolloData: EnrichmentResult["apolloData"] = null;
  try {
    const org = await enrichOrganization(domain);
    if (org) {
      apolloData = {
        estimated_employees: org.estimated_num_employees,
        industry: org.industry,
        linkedin_url: org.linkedin_url,
        short_description: org.short_description,
      };
      log(`Apollo: ${companyName} — ${org.estimated_num_employees || "?"} employees, ${org.industry || "unknown industry"}`, "dm-enrich");
    }
  } catch (e: any) {
    log(`Apollo enrichment failed for ${domain}: ${e.message}`, "dm-enrich");
  }

  const { content, pagesScanned } = await crawlForTeamPages(domain);
  const decisionMakers = await extractDMsWithGPT(content, companyName, domain);

  log(`Found ${decisionMakers.length} decision makers for ${companyName} (scanned ${pagesScanned} pages)`, "dm-enrich");

  return {
    companyRecordId: recordId,
    companyName,
    domain,
    decisionMakers,
    apolloData,
    pagesScanned,
  };
}

export async function writeDMsToAirtable(result: EnrichmentResult): Promise<number> {
  const dmTable = encodeURIComponent("Decision_Makers");
  const compTable = encodeURIComponent("Companies");
  let written = 0;

  if (result.decisionMakers.length > 0) {
    const existingNames = new Set<string>();
    try {
      const formula = encodeURIComponent(`{company_name_text} = '${result.companyName.replace(/'/g, "\\'")}'`);
      const existing = await airtableRequest(`${dmTable}?filterByFormula=${formula}&fields[]=full_name`);
      for (const rec of existing.records || []) {
        existingNames.add(String(rec.fields.full_name || "").trim().toLowerCase());
      }
    } catch (e: any) {
      log(`Failed to check existing DMs: ${e.message}`, "dm-enrich");
    }

    const newDMs = result.decisionMakers.filter(
      dm => !existingNames.has(dm.full_name.trim().toLowerCase())
    );

    if (newDMs.length < result.decisionMakers.length) {
      log(`Skipping ${result.decisionMakers.length - newDMs.length} duplicate DMs for ${result.companyName}`, "dm-enrich");
    }

    const batchSize = 10;
    for (let i = 0; i < newDMs.length; i += batchSize) {
      const batch = newDMs.slice(i, i + batchSize);
      const records = batch.map(dm => ({
        fields: {
          full_name: dm.full_name,
          title: dm.title,
          email: dm.email || undefined,
          phone: dm.phone || undefined,
          linkedin_url: dm.linkedin_url || undefined,
          seniority: dm.seniority,
          department: dm.department,
          source: dm.source,
          company_name_text: result.companyName,
          enriched_at: new Date().toISOString(),
        },
      }));

      try {
        await airtableRequest(dmTable, {
          method: "POST",
          body: JSON.stringify({ records }),
        });
        written += batch.length;
      } catch (e: any) {
        log(`Failed to write DMs batch: ${e.message}`, "dm-enrich");
      }
    }
  }

  const hasDMs = written > 0 || result.decisionMakers.length > 0;
  const updateFields: Record<string, any> = {
    enrichment_status: hasDMs ? "done" : "pending",
  };

  if (result.apolloData) {
    if (result.apolloData.linkedin_url) {
      updateFields.linkedin_url = result.apolloData.linkedin_url;
    }
  }

  if (result.apolloData?.short_description) {
    updateFields.company_summary = result.apolloData.short_description;
  }

  try {
    await airtableRequest(`${compTable}/${result.companyRecordId}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: updateFields }),
    });
  } catch (e: any) {
    log(`Failed to update company record with enrichment_status: ${e.message}`, "dm-enrich");
    try {
      await airtableRequest(`${compTable}/${result.companyRecordId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { enrich: true } }),
      });
    } catch { }
  }

  return written;
}

export async function fetchCompaniesForEnrichment(limit = 10): Promise<Array<{ id: string; name: string; website: string }>> {
  const encoded = encodeURIComponent("Companies");
  const formula = encodeURIComponent("AND({website} != '', {enrichment_status} != 'done')");
  const data = await airtableRequest(`${encoded}?filterByFormula=${formula}&pageSize=${limit}`);

  return (data.records || []).map((r: any) => ({
    id: r.id,
    name: r.fields.company_name || "",
    website: r.fields.website || "",
  })).filter((c: any) => c.website);
}

export async function batchEnrich(limit = 10): Promise<{
  results: EnrichmentResult[];
  totalDMs: number;
  companiesProcessed: number;
}> {
  const companies = await fetchCompaniesForEnrichment(limit);
  log(`Batch enriching ${companies.length} companies`, "dm-enrich");

  const results: EnrichmentResult[] = [];
  let totalDMs = 0;

  for (const company of companies) {
    try {
      const result = await enrichCompany(company.id);
      const written = await writeDMsToAirtable(result);
      totalDMs += written;
      results.push(result);
      log(`Enriched ${company.name}: ${result.decisionMakers.length} DMs found`, "dm-enrich");
    } catch (e: any) {
      log(`Failed to enrich ${company.name}: ${e.message}`, "dm-enrich");
      results.push({
        companyRecordId: company.id,
        companyName: company.name,
        domain: "",
        decisionMakers: [],
        apolloData: null,
        pagesScanned: 0,
        error: e.message,
      });
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return { results, totalDMs, companiesProcessed: results.length };
}

export async function getEnrichmentStats(): Promise<{
  totalCompanies: number;
  enrichedCompanies: number;
  unenrichedWithWebsite: number;
  totalDMs: number;
  coveragePercent: number;
}> {
  const encoded = encodeURIComponent("Companies");

  let totalCompanies = 0;
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100", "fields[]": "company_name" });
    if (offset) params.set("offset", offset);
    const data = await airtableRequest(`${encoded}?${params.toString()}`);
    totalCompanies += (data.records || []).length;
    offset = data.offset;
  } while (offset);

  let enrichedCompanies = 0;
  try {
    const formula = encodeURIComponent("{enrichment_status} = 'done'");
    const data = await airtableRequest(`${encoded}?filterByFormula=${formula}&pageSize=100&fields[]=company_name`);
    enrichedCompanies = (data.records || []).length;
  } catch { }

  let unenrichedWithWebsite = 0;
  try {
    const formula = encodeURIComponent("AND({website} != '', {enrichment_status} != 'done')");
    const data = await airtableRequest(`${encoded}?filterByFormula=${formula}&pageSize=100&fields[]=company_name`);
    unenrichedWithWebsite = (data.records || []).length;
  } catch { }

  let totalDMs = 0;
  try {
    const dmEncoded = encodeURIComponent("Decision_Makers");
    const data = await airtableRequest(`${dmEncoded}?pageSize=100&fields[]=full_name`);
    totalDMs = (data.records || []).length;
  } catch { }

  return {
    totalCompanies,
    enrichedCompanies,
    unenrichedWithWebsite,
    totalDMs,
    coveragePercent: totalCompanies > 0 ? Math.round((enrichedCompanies / totalCompanies) * 100) : 0,
  };
}
