import { log } from "./logger";

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

let apolloExhausted = false;
let apolloExhaustedAt = 0;
const EXHAUSTION_COOLDOWN_MS = 60 * 60 * 1000;

function isApolloExhausted(): boolean {
  if (!apolloExhausted) return false;
  if (Date.now() - apolloExhaustedAt > EXHAUSTION_COOLDOWN_MS) {
    apolloExhausted = false;
    log("Apollo exhaustion cooldown expired, re-enabling API calls", "apollo");
    return false;
  }
  return true;
}

export interface ApolloOrg {
  id: string;
  name: string;
  website_url: string;
  linkedin_url: string;
  phone: string;
  founded_year: number | null;
  estimated_num_employees: number | null;
  industry: string;
  keywords: string[];
  city: string;
  state: string;
  country: string;
  short_description: string;
}

export interface ApolloPerson {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string;
  email_status: string;
  phone: string;
  linkedin_url: string;
  seniority: string;
  departments: string[];
  city: string;
  state: string;
  country: string;
  organization_name: string;
}

const TARGET_TITLES = [
  "VP Operations", "Vice President Operations",
  "VP Plant Services", "Vice President Plant Services",
  "Plant Manager", "Plant Director",
  "Maintenance Manager", "Maintenance Director", "Maintenance Superintendent",
  "Turnaround Manager", "Turnaround Director", "Turnaround Coordinator",
  "Safety Director", "HSE Director", "HSE Manager", "Safety Manager", "EHS Director",
  "Operations Manager", "Operations Director", "Operations Superintendent",
  "Field Services Manager", "Field Services Director",
  "General Manager", "President", "CEO", "Owner",
  "VP Maintenance", "VP Safety",
  "Procurement Manager", "Procurement Director",
  "Project Manager", "Construction Manager",
];

async function apolloRequest(path: string, body: any, retries = 3): Promise<any> {
  if (!APOLLO_API_KEY) throw new Error("APOLLO_API_KEY not configured");

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`https://api.apollo.io/api/v1${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": APOLLO_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const wait = Math.min(10000 * Math.pow(2, attempt - 1), 60000);
      log(`Apollo rate limited (attempt ${attempt}/${retries}) — waiting ${wait / 1000}s`, "apollo");
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      if ((res.status === 422 && text.includes("insufficient credits")) ||
          (res.status === 403 && text.includes("API_INACCESSIBLE"))) {
        apolloExhausted = true;
        apolloExhaustedAt = Date.now();
        log(`Apollo credits exhausted or plan restricted (${res.status}) — disabling for 1 hour`, "apollo");
        return null;
      }
      if (attempt < retries && res.status >= 500) {
        log(`Apollo server error ${res.status} (attempt ${attempt}/${retries}) — retrying`, "apollo");
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`Apollo API (${res.status}): ${text.slice(0, 300)}`);
    }

    return res.json();
  }

  throw new Error("Apollo API: max retries exceeded");
}

export async function enrichOrganization(domain: string): Promise<ApolloOrg | null> {
  if (isApolloExhausted()) {
    log(`Apollo skipped for ${domain} — credits exhausted (cooldown active)`, "apollo");
    return null;
  }
  try {
    const data = await apolloRequest("/organizations/enrich", { domain });
    if (!data) return null;
    const org = data.organization;
    if (!org) return null;

    return {
      id: org.id || "",
      name: org.name || "",
      website_url: org.website_url || "",
      linkedin_url: org.linkedin_url || "",
      phone: org.primary_phone?.number || org.phone || "",
      founded_year: org.founded_year || null,
      estimated_num_employees: org.estimated_num_employees || null,
      industry: org.industry || "",
      keywords: org.keywords || [],
      city: org.city || "",
      state: org.state || "",
      country: org.country || "",
      short_description: org.short_description || "",
    };
  } catch (e: any) {
    log(`Apollo org enrich failed for ${domain}: ${e.message}`, "apollo");
    return null;
  }
}

export async function searchPeopleByDomain(
  domain: string,
  titles?: string[],
  limit = 10
): Promise<ApolloPerson[]> {
  if (isApolloExhausted()) {
    log(`Apollo People Search skipped for ${domain} — credits exhausted (cooldown active)`, "apollo");
    return [];
  }
  const searchTitles = titles && titles.length > 0 ? titles : TARGET_TITLES;

  log(`Apollo People Search: ${domain} (${searchTitles.length} title filters, limit=${limit})`, "apollo");

  try {
    const data = await apolloRequest("/mixed_people/search", {
      q_organization_domains: domain,
      person_titles: searchTitles,
      page: 1,
      per_page: Math.min(limit, 25),
    });

    if (!data) return [];
    const people = data.people || [];
    log(`Apollo People Search returned ${people.length} results for ${domain}`, "apollo");

    return people.map((p: any) => ({
      id: p.id || "",
      first_name: p.first_name || "",
      last_name: p.last_name || "",
      name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
      title: p.title || "",
      email: p.email || "",
      email_status: p.email_status || "",
      phone: p.phone_numbers?.[0]?.sanitized_number || p.organization?.phone || "",
      linkedin_url: p.linkedin_url || "",
      seniority: p.seniority || "",
      departments: p.departments || [],
      city: p.city || "",
      state: p.state || "",
      country: p.country || "",
      organization_name: p.organization?.name || "",
    }));
  } catch (e: any) {
    log(`Apollo People Search failed for ${domain}: ${e.message}`, "apollo");
    return [];
  }
}

export async function enrichPerson(apolloId: string): Promise<ApolloPerson | null> {
  log(`Apollo Person Enrich: ${apolloId}`, "apollo");

  try {
    const data = await apolloRequest("/people/match", { id: apolloId, reveal_personal_emails: false });
    const p = data.person;
    if (!p) return null;

    return {
      id: p.id || "",
      first_name: p.first_name || "",
      last_name: p.last_name || "",
      name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
      title: p.title || "",
      email: p.email || "",
      email_status: p.email_status || "",
      phone: p.phone_numbers?.[0]?.sanitized_number || "",
      linkedin_url: p.linkedin_url || "",
      seniority: p.seniority || "",
      departments: p.departments || [],
      city: p.city || "",
      state: p.state || "",
      country: p.country || "",
      organization_name: p.organization?.name || "",
    };
  } catch (e: any) {
    log(`Apollo Person Enrich failed for ${apolloId}: ${e.message}`, "apollo");
    return null;
  }
}

export function isApolloAvailable(): boolean {
  return !!APOLLO_API_KEY && !isApolloExhausted();
}

export function isPeopleSearchAvailable(): boolean {
  return !!APOLLO_API_KEY && !isApolloExhausted();
}
