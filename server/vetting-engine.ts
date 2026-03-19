import { db } from "./db";
import { companyFlows, outreachPipeline } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getClientAirtableConfig } from "./airtable-scoped";
import { ensureOutreachPipelineRow } from "./outreach-pipeline-helper";
import { scoreAndUpdateFlow } from "./lead-intelligence";
import { deepEnrichFlow } from "./research-engine";

const TAG = "vetting-engine";

function log(msg: string) {
  console.log(`[${TAG}] ${msg}`);
}

interface AirtableCompanyRecord {
  id: string;
  fields: {
    company_name?: string;
    phone?: string;
    website?: string;
    city?: string;
    state?: string;
    category?: string;
    Bucket?: string;
    Today_Call_List?: boolean;
  };
}

let cachedCompanies: AirtableCompanyRecord[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchAirtableCompaniesPage(
  cfg: { apiKey: string; baseId: string },
  offset?: string
): Promise<{ records: AirtableCompanyRecord[]; offset?: string }> {
  const table = encodeURIComponent("Companies");
  const fields = [
    "company_name", "phone", "website", "city", "state",
    "category", "Bucket", "Today_Call_List"
  ];
  const fieldParams = fields.map(f => `fields%5B%5D=${encodeURIComponent(f)}`).join("&");
  let url = `https://api.airtable.com/v0/${cfg.baseId}/${table}?pageSize=100&${fieldParams}`;
  if (offset) url += `&offset=${encodeURIComponent(offset)}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (res.status === 429) {
      const waitSec = Math.pow(2, attempt + 1) + Math.random() * 2;
      log(`Airtable rate limited, waiting ${waitSec.toFixed(1)}s before retry ${attempt + 1}/3`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return { records: data.records || [], offset: data.offset };
  }
  throw new Error("Airtable rate limit exceeded after 3 retries");
}

async function fetchAllAirtableCompanies(cfg: { apiKey: string; baseId: string }, forceRefresh = false): Promise<AirtableCompanyRecord[]> {
  if (!forceRefresh && cachedCompanies && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedCompanies;
  }

  const all: AirtableCompanyRecord[] = [];
  let offset: string | undefined;
  do {
    const page = await fetchAirtableCompaniesPage(cfg, offset);
    all.push(...page.records);
    offset = page.offset;
    if (offset) await new Promise(r => setTimeout(r, 250));
  } while (offset);

  cachedCompanies = all;
  cacheTimestamp = Date.now();
  return all;
}

export interface VettingProgress {
  totalAirtable: number;
  alreadyVetted: number;
  remaining: number;
  percentComplete: number;
  channelBreakdown: Record<string, number>;
  running: boolean;
}

let vettingInProgress = false;

export function isVettingRunning(): boolean {
  return vettingInProgress;
}

export async function getVettingProgress(clientId: string): Promise<VettingProgress> {
  const cfg = await getClientAirtableConfig(clientId);
  const allCompanies = await fetchAllAirtableCompanies(cfg);

  const existingFlows = await db
    .select({ companyId: companyFlows.companyId, bestChannel: companyFlows.bestChannel })
    .from(companyFlows)
    .where(eq(companyFlows.clientId, clientId));

  const flowSet = new Set(existingFlows.map(f => f.companyId));
  const vetted = allCompanies.filter(c => flowSet.has(c.id)).length;
  const remaining = allCompanies.length - vetted;

  const channelBreakdown: Record<string, number> = {};
  for (const f of existingFlows) {
    const ch = f.bestChannel || "unscored";
    channelBreakdown[ch] = (channelBreakdown[ch] || 0) + 1;
  }

  return {
    totalAirtable: allCompanies.length,
    alreadyVetted: vetted,
    remaining,
    percentComplete: allCompanies.length > 0 ? Math.round((vetted / allCompanies.length) * 100) : 0,
    channelBreakdown,
    running: vettingInProgress,
  };
}

export interface VettingBatchResult {
  batchProcessed: number;
  flowsCreated: number;
  pipelineRowsCreated: number;
  scored: number;
  researchRan: number;
  researchConverted: number;
  errors: string[];
  remaining: number;
  totalAirtable: number;
  percentComplete: number;
}

async function processVettingBatch(
  clientId: string,
  companies: AirtableCompanyRecord[],
): Promise<VettingBatchResult> {
  const result: VettingBatchResult = {
    batchProcessed: 0,
    flowsCreated: 0,
    pipelineRowsCreated: 0,
    scored: 0,
    researchRan: 0,
    researchConverted: 0,
    errors: [],
    remaining: 0,
    totalAirtable: 0,
    percentComplete: 0,
  };

  for (const rec of companies) {
    const f = rec.fields;
    const companyName = f.company_name || "Unknown";
    const phone = f.phone || null;
    const website = f.website || null;
    const city = f.city || null;
    const state = f.state || null;

    try {
      log(`Vetting: ${companyName} (${rec.id})`);

      const [existingFlow] = await db
        .select({ id: companyFlows.id })
        .from(companyFlows)
        .where(
          and(
            eq(companyFlows.clientId, clientId),
            eq(companyFlows.companyId, rec.id),
          )
        )
        .limit(1);

      let flowId: number;

      if (existingFlow) {
        flowId = existingFlow.id;
      } else {
        const [newFlow] = await db.insert(companyFlows).values({
          clientId,
          companyId: rec.id,
          companyName,
          contactId: null,
          contactName: null,
          flowType: "gatekeeper",
          status: "active",
          stage: 1,
          attemptCount: 0,
          maxAttempts: 6,
          nextAction: "Pending vetting — auto-score and research",
          nextDueAt: new Date(),
          priority: 30,
          notes: "Created by vetting engine — not on Today_Call_List",
        }).returning();
        flowId = newFlow.id;
        result.flowsCreated++;
      }

      const pipelineResult = await ensureOutreachPipelineRow({
        clientId,
        companyId: rec.id,
        companyName,
        phone,
        website,
        city,
        state,
      });
      if (pipelineResult.created) result.pipelineRowsCreated++;

      try {
        await scoreAndUpdateFlow(flowId);
        result.scored++;
      } catch (err: any) {
        result.errors.push(`Score error (${companyName}): ${err.message}`);
      }

      const [updatedFlow] = await db
        .select({ bestChannel: companyFlows.bestChannel })
        .from(companyFlows)
        .where(eq(companyFlows.id, flowId))
        .limit(1);

      if (updatedFlow?.bestChannel === "research_more" && website) {
        try {
          const enrichResult = await deepEnrichFlow(flowId);
          if (enrichResult) {
            result.researchRan++;
            if (enrichResult.converted) result.researchConverted++;
          }
        } catch (err: any) {
          result.errors.push(`Research error (${companyName}): ${err.message}`);
        }
      }

      result.batchProcessed++;
    } catch (err: any) {
      result.errors.push(`${companyName}: ${err.message}`);
    }
  }

  return result;
}

export async function runVettingBatch(
  clientId: string,
  batchSize: number = 10
): Promise<VettingBatchResult> {
  if (vettingInProgress) {
    return {
      batchProcessed: 0, flowsCreated: 0, pipelineRowsCreated: 0,
      scored: 0, researchRan: 0, researchConverted: 0,
      errors: ["Vetting batch already in progress"],
      remaining: 0, totalAirtable: 0, percentComplete: 0,
    };
  }

  vettingInProgress = true;
  try {
    const cfg = await getClientAirtableConfig(clientId);
    const allCompanies = await fetchAllAirtableCompanies(cfg);
    log(`Fetched ${allCompanies.length} total companies from Airtable (cached)`);

    const existingFlows = await db
      .select({ companyId: companyFlows.companyId })
      .from(companyFlows)
      .where(eq(companyFlows.clientId, clientId));
    const flowSet = new Set(existingFlows.map(f => f.companyId));

    const unvetted = allCompanies.filter(c => !flowSet.has(c.id));
    log(`${unvetted.length} companies not yet vetted, processing batch of ${Math.min(batchSize, unvetted.length)}`);

    const batch = unvetted.slice(0, batchSize);
    const result = await processVettingBatch(clientId, batch);

    const newTotal = existingFlows.length + result.flowsCreated;
    result.totalAirtable = allCompanies.length;
    result.remaining = allCompanies.length - newTotal;
    result.percentComplete = Math.round((newTotal / allCompanies.length) * 100);

    log(`Batch complete: processed=${result.batchProcessed} flows=${result.flowsCreated} scored=${result.scored} research=${result.researchRan} converted=${result.researchConverted} remaining=${result.remaining}`);
    return result;
  } finally {
    vettingInProgress = false;
  }
}

export async function runFullVetting(
  clientId: string,
  batchSize: number = 10,
  onBatchComplete?: (result: VettingBatchResult, batchNumber: number) => void
): Promise<{ totalProcessed: number; totalBatches: number; finalProgress: VettingProgress }> {
  if (vettingInProgress) {
    throw new Error("Vetting already in progress");
  }

  vettingInProgress = true;
  let totalProcessed = 0;
  let batchNumber = 0;

  try {
    const cfg = await getClientAirtableConfig(clientId);
    const allCompanies = await fetchAllAirtableCompanies(cfg, true);
    log(`Full vetting: ${allCompanies.length} total companies in Airtable`);

    while (true) {
      batchNumber++;

      const existingFlows = await db
        .select({ companyId: companyFlows.companyId })
        .from(companyFlows)
        .where(eq(companyFlows.clientId, clientId));
      const flowSet = new Set(existingFlows.map(f => f.companyId));

      const unvetted = allCompanies.filter(c => !flowSet.has(c.id));
      if (unvetted.length === 0) {
        log(`Full vetting complete — no more unvetted companies`);
        break;
      }

      const batch = unvetted.slice(0, batchSize);
      const batchResult = await processVettingBatch(clientId, batch);

      batchResult.totalAirtable = allCompanies.length;
      batchResult.remaining = unvetted.length - batchResult.batchProcessed;
      batchResult.percentComplete = Math.round(((existingFlows.length + batchResult.flowsCreated) / allCompanies.length) * 100);

      totalProcessed += batchResult.batchProcessed;
      onBatchComplete?.(batchResult, batchNumber);

      if (batchResult.batchProcessed === 0) {
        log(`Batch #${batchNumber} processed 0 companies (all errored) — stopping`);
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally {
    vettingInProgress = false;
  }

  const finalProgress = await getVettingProgress(clientId);
  return { totalProcessed, totalBatches: batchNumber, finalProgress };
}
