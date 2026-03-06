import { log } from "./logger";
import { scopedFormula } from "./airtable-scoped";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

export interface MachineMetrics {
  companies_total: number | null;
  dms_total: number | null;
  calls_total: number | null;
  wins_total: number | null;
  opportunities_total: number | null;
  computed_at: number;
}

let cachedMetrics: MachineMetrics | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function hasAirtable(): boolean {
  return !!(AIRTABLE_API_KEY() && AIRTABLE_BASE_ID());
}

async function airtableCount(table: string, formula?: string, clientId?: string): Promise<number | null> {
  try {
    const key = AIRTABLE_API_KEY();
    const base = AIRTABLE_BASE_ID();
    if (!key || !base) return null;

    const effectiveFormula = clientId
      ? (formula ? scopedFormula(clientId, formula) : scopedFormula(clientId))
      : formula;

    let count = 0;
    let offset: string | undefined;

    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (effectiveFormula) params.set("filterByFormula", effectiveFormula);
      if (offset) params.set("offset", offset);

      const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?${params}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      count += (data.records || []).length;
      offset = data.offset;
    } while (offset);

    return count;
  } catch (e: any) {
    log(`Airtable count error (${table}): ${e.message}`, "machine-metrics");
    return null;
  }
}

export async function computeMachineMetrics(clientId?: string): Promise<MachineMetrics> {
  if (cachedMetrics && Date.now() < cacheExpiry) {
    return cachedMetrics;
  }

  if (!hasAirtable()) {
    return {
      companies_total: null,
      dms_total: null,
      calls_total: null,
      wins_total: null,
      opportunities_total: null,
      computed_at: Date.now(),
    };
  }

  log("Computing machine metrics from Airtable...", "machine-metrics");

  const [companies, dms, calls, wins, opportunities] = await Promise.all([
    airtableCount("Companies", undefined, clientId),
    airtableCount("Decision_Makers", undefined, clientId),
    airtableCount("Calls", undefined, clientId),
    airtableCount("Companies", "{Win_Flag}=TRUE()", clientId),
    airtableCount("Companies", "OR({Lead_Status}='Working',{Lead_Status}='Won')", clientId),
  ]);

  const metrics: MachineMetrics = {
    companies_total: companies,
    dms_total: dms,
    calls_total: calls,
    wins_total: wins,
    opportunities_total: opportunities,
    computed_at: Date.now(),
  };

  cachedMetrics = metrics;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  log(`Machine metrics: companies=${companies} dms=${dms} calls=${calls} wins=${wins} opps=${opportunities}`, "machine-metrics");

  return metrics;
}
