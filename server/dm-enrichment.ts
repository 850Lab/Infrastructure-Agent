import { log } from "./index";
import OpenAI from "openai";
import { enrichOrganization, searchPeopleByDomain, isApolloAvailable } from "./apollo";
import type { ApolloPerson } from "./apollo";

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

function extractContactSignals(html: string): string {
  const signals: string[] = [];

  const emailMatches = html.match(/mailto:([^"'\s<>]+)/gi) || [];
  for (const m of emailMatches) {
    const email = m.replace(/^mailto:/i, "").split("?")[0];
    if (email.includes("@")) signals.push(`[EMAIL: ${email}]`);
  }

  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const textEmails = html.replace(/<[^>]+>/g, " ").match(emailPattern) || [];
  for (const e of textEmails) {
    if (!e.includes("@sentry") && !e.includes("@example") && !e.includes(".png") && !e.includes(".jpg")) {
      signals.push(`[EMAIL: ${e}]`);
    }
  }

  const linkedinMatches = html.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^\s"'<>]+/gi) || [];
  for (const l of linkedinMatches) {
    signals.push(`[LINKEDIN: ${l.replace(/["']/g, "")}]`);
  }

  const phoneMatches = html.match(/(?:tel:|href="tel:)([^"'\s<>]+)/gi) || [];
  for (const p of phoneMatches) {
    const phone = p.replace(/^(?:tel:|href="tel:)/i, "").replace(/"/g, "");
    if (phone.length >= 10) signals.push(`[PHONE: ${phone}]`);
  }

  return [...new Set(signals)].join("\n");
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

    const contactSignals = extractContactSignals(html);

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 11000);

    return contactSignals ? `${contactSignals}\n${text}` : text;
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

The content includes extracted contact signals marked as [EMAIL: ...], [LINKEDIN: ...], [PHONE: ...]. Match these to the people you find.

Return a JSON array of people found. For each person include:
{
  "full_name": "First Last",
  "title": "Their actual title from the website",
  "email": "their email if found or can be matched from [EMAIL:] signals, empty string if not",
  "phone": "their direct phone if found or matched from [PHONE:] signals, empty string if not",
  "linkedin_url": "their LinkedIn URL if found or matched from [LINKEDIN:] signals, empty string if not",
  "seniority": "c_suite|vp|director|manager|other",
  "department": "operations|safety|maintenance|executive|sales|other"
}

Rules:
- Only include people with real first AND last names (not generic titles)
- Only include people whose names actually appear on the website
- Do NOT make up names or guess
- If no real names are found, return an empty array []
- Match [EMAIL:] signals to people by name pattern (e.g. john.smith@ matches John Smith)
- Match [LINKEDIN:] URLs to people by name in the URL slug
- If the company domain is known, generate probable emails as firstname.lastname@domain for people without explicit emails
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

function mapApolloSeniority(seniority: string): string {
  const s = (seniority || "").toLowerCase();
  if (s.includes("c_suite") || s === "founder" || s === "owner") return "c_suite";
  if (s.includes("vp") || s.includes("vice")) return "vp";
  if (s.includes("director")) return "director";
  if (s.includes("manager") || s.includes("senior")) return "manager";
  return "other";
}

function mapApolloDepartment(departments: string[], title: string): string {
  const all = [...departments.map(d => d.toLowerCase()), title.toLowerCase()].join(" ");
  if (all.includes("operations") || all.includes("plant")) return "operations";
  if (all.includes("maintenance") || all.includes("turnaround")) return "maintenance";
  if (all.includes("safety") || all.includes("hse") || all.includes("ehs") || all.includes("health")) return "safety";
  if (all.includes("executive") || all.includes("c_suite") || all.includes("owner") || all.includes("president") || all.includes("ceo")) return "executive";
  if (all.includes("sales") || all.includes("business development")) return "sales";
  if (all.includes("finance") || all.includes("accounting")) return "finance";
  return "other";
}

function apolloPeopleToDecisionMakers(people: ApolloPerson[], domain: string): DecisionMaker[] {
  return people
    .filter(p => p.name && p.name.includes(" "))
    .map(p => {
      let email = p.email || "";
      let source = "apollo";
      if (!email && p.name.includes(" ") && domain && domain.includes(".")) {
        const generated = generateProbableEmail(p.name, domain);
        if (generated) {
          email = generated;
          source = "apollo+email_generated";
        }
      }

      return {
        full_name: p.name,
        title: p.title,
        email,
        phone: p.phone || "",
        linkedin_url: p.linkedin_url || "",
        seniority: mapApolloSeniority(p.seniority),
        department: mapApolloDepartment(p.departments, p.title),
        source,
      };
    });
}

function generateProbableEmail(fullName: string, domain: string): string | null {
  if (!domain || !domain.includes(".")) return null;
  const cleaned = fullName.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z\s-]/g, "")
    .trim();
  const parts = cleaned.split(/\s+/).filter(p => p.length >= 2);
  if (parts.length < 2) return null;
  const first = parts[0].replace(/-/g, "");
  const last = parts[parts.length - 1].replace(/-/g, "");
  if (!first || !last) return null;
  return `${first}.${last}@${domain}`;
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

  let decisionMakers: DecisionMaker[] = [];
  let pagesScanned = 0;

  if (isApolloAvailable()) {
    try {
      const apolloPeople = await searchPeopleByDomain(domain);
      if (apolloPeople.length > 0) {
        decisionMakers = apolloPeopleToDecisionMakers(apolloPeople, domain);
        log(`Apollo People Search: ${decisionMakers.length} DMs for ${companyName}`, "dm-enrich");
      }
    } catch (e: any) {
      log(`Apollo People Search failed for ${companyName}: ${e.message}`, "dm-enrich");
    }
  }

  if (decisionMakers.length === 0) {
    log(`Falling back to website crawl for ${companyName}`, "dm-enrich");
    const crawlResult = await crawlForTeamPages(domain);
    pagesScanned = crawlResult.pagesScanned;
    const crawledDMs = await extractDMsWithGPT(crawlResult.content, companyName, domain);

    for (const dm of crawledDMs) {
      if (!dm.email && dm.full_name.includes(" ") && domain && domain.includes(".")) {
        const generated = generateProbableEmail(dm.full_name, domain);
        if (generated) {
          dm.email = generated;
          if (!dm.source.includes("email_generated")) {
            dm.source = dm.source ? `${dm.source}+email_generated` : "email_generated";
          }
        }
      }
    }

    decisionMakers = crawledDMs;
  } else {
    const apolloNames = new Set(decisionMakers.map(d => d.full_name.toLowerCase()));
    try {
      const crawlResult = await crawlForTeamPages(domain);
      pagesScanned = crawlResult.pagesScanned;
      if (crawlResult.content.length > 200) {
        const crawledDMs = await extractDMsWithGPT(crawlResult.content, companyName, domain);
        for (const dm of crawledDMs) {
          if (!apolloNames.has(dm.full_name.toLowerCase())) {
            if (!dm.email && dm.full_name.includes(" ") && domain.includes(".")) {
              const generated = generateProbableEmail(dm.full_name, domain);
              if (generated) {
                dm.email = generated;
                dm.source = dm.source ? `${dm.source}+email_generated` : "email_generated";
              }
            }
            dm.source = dm.source ? `${dm.source}+website_supplement` : "website_supplement";
            decisionMakers.push(dm);
          }
        }
      }
    } catch (e: any) {
      log(`Supplemental website crawl failed for ${companyName}: ${e.message}`, "dm-enrich");
    }
  }

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

  const updateFields: Record<string, any> = {
    enrichment_status: "done",
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
    let eOffset: string | undefined;
    do {
      const params = eOffset ? `&offset=${eOffset}` : "";
      const data = await airtableRequest(`${encoded}?filterByFormula=${formula}&pageSize=100&fields[]=company_name${params}`);
      enrichedCompanies += (data.records || []).length;
      eOffset = data.offset;
    } while (eOffset);
  } catch { }

  let unenrichedWithWebsite = 0;
  try {
    const formula = encodeURIComponent("AND({website} != '', {enrichment_status} != 'done')");
    let uOffset: string | undefined;
    do {
      const params = uOffset ? `&offset=${uOffset}` : "";
      const data = await airtableRequest(`${encoded}?filterByFormula=${formula}&pageSize=100&fields[]=company_name${params}`);
      unenrichedWithWebsite += (data.records || []).length;
      uOffset = data.offset;
    } while (uOffset);
  } catch { }

  let totalDMs = 0;
  try {
    const dmEncoded = encodeURIComponent("Decision_Makers");
    let dmOffset: string | undefined;
    do {
      const params = dmOffset ? `&offset=${dmOffset}` : "";
      const data = await airtableRequest(`${dmEncoded}?pageSize=100&fields[]=full_name${params}`);
      totalDMs += (data.records || []).length;
      dmOffset = data.offset;
    } while (dmOffset);
  } catch { }

  return {
    totalCompanies,
    enrichedCompanies,
    unenrichedWithWebsite,
    totalDMs,
    coveragePercent: totalCompanies > 0 ? Math.round((enrichedCompanies / totalCompanies) * 100) : 0,
  };
}

export async function backfillDMContacts(limit = 50): Promise<{
  processed: number;
  updated: number;
  results: Array<{ companyName: string; dmsUpdated: number; dmsTotal: number }>;
}> {
  const dmTable = encodeURIComponent("Decision_Makers");
  const compTable = encodeURIComponent("Companies");

  const formula = encodeURIComponent("AND({company_name_text} != '', OR({email} = BLANK(), {email} = ''))");
  const dmData = await airtableRequest(`${dmTable}?filterByFormula=${formula}&pageSize=${limit}`);
  const records = dmData.records || [];

  const byCompany = new Map<string, Array<{ id: string; full_name: string; title: string }>>();
  for (const rec of records) {
    const comp = rec.fields.company_name_text || "";
    if (!comp) continue;
    if (!byCompany.has(comp)) byCompany.set(comp, []);
    byCompany.get(comp)!.push({
      id: rec.id,
      full_name: rec.fields.full_name || "",
      title: rec.fields.title || "",
    });
  }

  let totalUpdated = 0;
  const results: Array<{ companyName: string; dmsUpdated: number; dmsTotal: number }> = [];

  for (const [companyName, dms] of byCompany) {
    const compFormula = encodeURIComponent(`{company_name} = '${companyName.replace(/'/g, "\\'")}'`);
    let domain = "";
    try {
      const compData = await airtableRequest(`${compTable}?filterByFormula=${compFormula}&pageSize=1&fields[]=website`);
      const website = compData.records?.[0]?.fields?.website || "";
      if (website) {
        domain = extractDomain(website);
      }
    } catch { }

    if (!domain) {
      results.push({ companyName, dmsUpdated: 0, dmsTotal: dms.length });
      continue;
    }

    let companyUpdated = 0;
    for (const dm of dms) {
      const updateFields: Record<string, string> = {};

      const generated = generateProbableEmail(dm.full_name, domain);
      if (generated) {
        updateFields.email = generated;
      }

      if (Object.keys(updateFields).length > 0) {
        try {
          await airtableRequest(`${dmTable}/${dm.id}`, {
            method: "PATCH",
            body: JSON.stringify({ fields: { ...updateFields, source: "website_crawl+email_generated" } }),
          });
          companyUpdated++;
          totalUpdated++;
        } catch (e: any) {
          log(`Failed to update DM ${dm.full_name}: ${e.message}`, "dm-enrich");
        }
      }
    }

    results.push({ companyName, dmsUpdated: companyUpdated, dmsTotal: dms.length });
    await new Promise(r => setTimeout(r, 300));
  }

  log(`Backfill complete: ${totalUpdated}/${records.length} DMs updated`, "dm-enrich");
  return { processed: records.length, updated: totalUpdated, results };
}
