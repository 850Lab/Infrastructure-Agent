import { log } from "./index";

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

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

export async function enrichOrganization(domain: string): Promise<ApolloOrg | null> {
  if (!APOLLO_API_KEY) throw new Error("APOLLO_API_KEY not configured");

  const res = await fetch("https://api.apollo.io/api/v1/organizations/enrich", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": APOLLO_API_KEY,
    },
    body: JSON.stringify({ domain }),
  });

  if (res.status === 429) {
    log(`Apollo rate limited — waiting 10s`, "apollo");
    await new Promise(r => setTimeout(r, 10000));
    return enrichOrganization(domain);
  }

  if (!res.ok) {
    const text = await res.text();
    log(`Apollo org enrich failed (${res.status}): ${text.slice(0, 200)}`, "apollo");
    return null;
  }

  const data = await res.json();
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
}

export function isApolloAvailable(): boolean {
  return !!APOLLO_API_KEY;
}
