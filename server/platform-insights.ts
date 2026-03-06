import { log } from "./logger";
import { storage } from "./storage";
import { getClientAirtableConfig, scopedFormula } from "./airtable-scoped";
import { getTimeWeight } from "./time-weight";
import type { PlatformInsight } from "@shared/schema";

function logPI(message: string) {
  log(message, "platform-insights");
}

const TITLE_BUCKETS: Record<string, RegExp> = {
  "Safety Manager": /safety|hse|ehs/i,
  "Superintendent": /superintendent|site\s*manager|field\s*supervisor/i,
  "Project Manager": /project\s*manager|turnaround\s*manager|shutdown\s*manager/i,
  "Operations Manager": /operations\s*manager|maintenance\s*manager/i,
  "VP / Director": /\b(vp|vice\s*president|director)\b/i,
  "Executive / Owner": /\b(ceo|cfo|coo|president|founder|owner|chairman)\b/i,
  "General Manager": /general\s*manager/i,
};

function bucketTitle(title: string): string {
  const lower = title.toLowerCase().trim();
  for (const [bucket, pattern] of Object.entries(TITLE_BUCKETS)) {
    if (pattern.test(lower)) return bucket;
  }
  return "Other";
}

interface ClientOutcomeData {
  industry: string;
  title: string;
  outcome: string;
  contactDate: string | null;
}

async function fetchClientOutcomes(clientId: string): Promise<ClientOutcomeData[]> {
  const client = await storage.getClient(clientId);
  if (!client) return [];

  const industry = client.industryConfig || "industrial";
  const atConfig = await getClientAirtableConfig(clientId);
  const apiKey = atConfig.apiKey;
  const baseId = atConfig.baseId;

  if (!apiKey || !baseId) return [];

  const formula = scopedFormula(clientId, "{Offer_DM_Outcome}!=''");
  const fields = ["Offer_DM_Title_At_Contact", "Offer_DM_Title", "Offer_DM_Outcome", "Offer_DM_Last_Selected"]
    .map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

  const results: ClientOutcomeData[] = [];
  let offset: string | undefined;

  try {
    do {
      const params = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
      if (offset) params.set("offset", offset);

      const resp = await fetch(
        `https://api.airtable.com/v0/${baseId}/Companies?${params}&${fields}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (!resp.ok) break;

      const data = await resp.json();
      for (const rec of (data.records || [])) {
        const f = rec.fields;
        const rawTitle = String(f.Offer_DM_Title_At_Contact || f.Offer_DM_Title || "").trim();
        if (!rawTitle) continue;

        results.push({
          industry,
          title: bucketTitle(rawTitle),
          outcome: String(f.Offer_DM_Outcome || "").trim(),
          contactDate: f.Offer_DM_Last_Selected || null,
        });
      }
      offset = data.offset;
    } while (offset);
  } catch (e: any) {
    logPI(`Error fetching outcomes for client ${clientId}: ${e.message}`);
  }

  return results;
}

export async function aggregatePlatformInsights(): Promise<{ titlesUpdated: number; clientsScanned: number }> {
  logPI("Starting cross-client insight aggregation...");

  const allClients = await storage.getAllClients();
  const activeClients = allClients.filter(c => c.status === "active");

  if (activeClients.length === 0) {
    logPI("No active clients found");
    return { titlesUpdated: 0, clientsScanned: 0 };
  }

  const aggregated = new Map<string, {
    totalWeightedContacts: number;
    weightedConverted: number;
    weightedReachedDM: number;
  }>();

  let clientsScanned = 0;

  for (const client of activeClients) {
    try {
      const outcomes = await fetchClientOutcomes(client.id);
      if (outcomes.length === 0) continue;
      clientsScanned++;

      for (const o of outcomes) {
        const key = `${o.industry}|||${o.title}`;
        const weight = getTimeWeight(o.contactDate);

        if (!aggregated.has(key)) {
          aggregated.set(key, { totalWeightedContacts: 0, weightedConverted: 0, weightedReachedDM: 0 });
        }

        const entry = aggregated.get(key)!;
        entry.totalWeightedContacts += weight;
        if (o.outcome === "converted") entry.weightedConverted += weight;
        if (o.outcome === "reached_dm") entry.weightedReachedDM += weight;
      }
    } catch (e: any) {
      logPI(`Error processing client ${client.id}: ${e.message}`);
    }
  }

  let titlesUpdated = 0;
  const MIN_SAMPLE_SIZE = 3;

  for (const [key, data] of aggregated.entries()) {
    const [industry, title] = key.split("|||");
    if (data.totalWeightedContacts < MIN_SAMPLE_SIZE) continue;

    const rawConversion = ((data.weightedConverted * 3 + data.weightedReachedDM) / data.totalWeightedContacts) * 100;
    const conversionRate = Math.min(100, Math.max(0, Math.round(rawConversion)));
    const rawReachRate = (data.weightedReachedDM / data.totalWeightedContacts) * 100;
    const reachedDmRate = Math.min(100, Math.max(0, Math.round(rawReachRate)));
    const sampleSize = Math.round(data.totalWeightedContacts);

    await storage.upsertPlatformInsight(industry, title, conversionRate, sampleSize, reachedDmRate);
    titlesUpdated++;
  }

  logPI(`Aggregation complete: ${titlesUpdated} title insights from ${clientsScanned} clients`);
  return { titlesUpdated, clientsScanned };
}

export async function getPlatformInsightsForIndustry(industry: string): Promise<PlatformInsight[]> {
  return storage.getPlatformInsights(industry);
}

export async function getPlatformDMBoost(title: string, industry: string): Promise<number> {
  const insights = await storage.getPlatformInsights(industry);
  if (insights.length === 0) return 0;

  const bucket = bucketTitle(title);
  const match = insights.find(i => i.title === bucket);
  if (!match || match.sampleSize < 3) return 0;

  const avgRate = insights.reduce((sum, i) => sum + i.conversionRate, 0) / insights.length;
  const deviation = match.conversionRate - avgRate;

  return Math.max(-15, Math.min(15, Math.round(deviation * 0.2)));
}
