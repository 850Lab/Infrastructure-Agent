import { log } from "./index";

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

export interface OutscraperResult {
  name: string;
  site: string | null;
  phone: string | null;
  full_address: string | null;
  category: string | null;
  rating: number | null;
  reviews: number | null;
}

export function isOutscraperAvailable(): boolean {
  return !!OUTSCRAPER_API_KEY;
}

export async function searchGoogleMaps(
  companyName: string,
  city?: string,
  state?: string
): Promise<OutscraperResult | null> {
  if (!OUTSCRAPER_API_KEY) throw new Error("OUTSCRAPER_API_KEY not configured");

  const parts = [companyName];
  if (city) parts.push(city);
  if (state) parts.push(state);
  const query = parts.join(" ");

  log(`Outscraper search: "${query}"`, "outscraper");

  const params = new URLSearchParams({
    query,
    limit: "1",
    async: "false",
  });

  const res = await fetch(`https://api.outscraper.com/maps/search-v3?${params}`, {
    headers: { "X-API-KEY": OUTSCRAPER_API_KEY },
  });

  if (res.status === 429) {
    log("Outscraper rate limited — waiting 10s", "outscraper");
    await new Promise(r => setTimeout(r, 10000));
    const retryRes = await fetch(`https://api.outscraper.com/maps/search-v3?${params}`, {
      headers: { "X-API-KEY": OUTSCRAPER_API_KEY },
    });
    if (!retryRes.ok) {
      log(`Outscraper retry also failed (${retryRes.status})`, "outscraper");
      return null;
    }
    const retryData = await retryRes.json();
    if (retryData.status !== "Success" || !retryData.data?.[0]?.[0]) return null;
    const rr = retryData.data[0][0];
    return { name: rr.name || "", site: rr.site || rr.website || null, phone: rr.phone || null, full_address: rr.full_address || null, category: rr.category || null, rating: rr.rating || null, reviews: rr.reviews || null };
  }

  if (!res.ok) {
    const text = await res.text();
    log(`Outscraper error (${res.status}): ${text.slice(0, 200)}`, "outscraper");
    return null;
  }

  const data = await res.json();
  if (data.status !== "Success" || !data.data?.[0]?.[0]) {
    log(`Outscraper: no results for "${query}"`, "outscraper");
    return null;
  }

  const r = data.data[0][0];
  return {
    name: r.name || "",
    site: r.site || r.website || null,
    phone: r.phone || null,
    full_address: r.full_address || null,
    category: r.category || null,
    rating: r.rating || null,
    reviews: r.reviews || null,
  };
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

export async function fetchCompaniesWithoutWebsite(): Promise<Array<{ recordId: string; companyName: string; city: string; state: string }>> {
  const encoded = encodeURIComponent("Companies");
  const formula = encodeURIComponent('OR({website} = BLANK(), {website} = "")');
  const companies: Array<{ recordId: string; companyName: string; city: string; state: string }> = [];

  let offset: string | undefined;
  do {
    const url = offset
      ? `${encoded}?filterByFormula=${formula}&pageSize=100&offset=${offset}&fields[]=company_name&fields[]=city&fields[]=state`
      : `${encoded}?filterByFormula=${formula}&pageSize=100&fields[]=company_name&fields[]=city&fields[]=state`;
    const data = await airtableRequest(url);

    for (const rec of data.records || []) {
      const name = rec.fields.company_name || "";
      if (name && name !== "Test Company") {
        companies.push({
          recordId: rec.id,
          companyName: name,
          city: rec.fields.city || "",
          state: rec.fields.state || "",
        });
      }
    }
    offset = data.offset;
  } while (offset);

  return companies;
}

export interface OutscraperBatchResult {
  recordId: string;
  companyName: string;
  websiteFound: string | null;
  phoneFound: string | null;
  updated: boolean;
  error?: string;
}

export async function lookupAndUpdateWebsite(
  recordId: string,
  companyName: string,
  city: string,
  state: string
): Promise<OutscraperBatchResult> {
  try {
    const result = await searchGoogleMaps(companyName, city, state);

    if (!result) {
      return { recordId, companyName, websiteFound: null, phoneFound: null, updated: false, error: "No Google Maps result" };
    }

    const updateFields: Record<string, any> = {};
    let websiteFound: string | null = null;
    let phoneFound: string | null = null;

    if (result.site) {
      let site = result.site.trim();
      if (!site.startsWith("http")) site = `https://${site}`;
      updateFields.website = site;
      websiteFound = site;
      log(`Found website for ${companyName}: ${site}`, "outscraper");
    }

    if (result.phone) {
      phoneFound = result.phone;
    }

    if (Object.keys(updateFields).length > 0) {
      const encoded = encodeURIComponent("Companies");
      await airtableRequest(`${encoded}/${recordId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: updateFields }),
      });
      log(`Updated Airtable record for ${companyName}`, "outscraper");
    }

    return { recordId, companyName, websiteFound, phoneFound, updated: Object.keys(updateFields).length > 0 };
  } catch (e: any) {
    log(`Error looking up ${companyName}: ${e.message}`, "outscraper");
    return { recordId, companyName, websiteFound: null, phoneFound: null, updated: false, error: e.message };
  }
}

export async function batchLookupWebsites(limit: number = 10): Promise<{
  processed: number;
  websitesFound: number;
  results: OutscraperBatchResult[];
}> {
  const companies = await fetchCompaniesWithoutWebsite();
  log(`Found ${companies.length} companies without website`, "outscraper");

  const toProcess = companies.slice(0, limit);
  const results: OutscraperBatchResult[] = [];
  let websitesFound = 0;

  for (const comp of toProcess) {
    const result = await lookupAndUpdateWebsite(comp.recordId, comp.companyName, comp.city, comp.state);
    results.push(result);
    if (result.websiteFound) websitesFound++;
    await new Promise(r => setTimeout(r, 1000));
  }

  log(`Batch complete: ${websitesFound}/${toProcess.length} websites found`, "outscraper");

  return { processed: toProcess.length, websitesFound, results };
}
