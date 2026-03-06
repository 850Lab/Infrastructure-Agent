import { storage } from "./storage";
import { log } from "./logger";

let clientIdFieldKnownMissing = false;

export function scopedFormula(clientId: string, existingFormula?: string): string {
  if (clientIdFieldKnownMissing) {
    return existingFormula || "";
  }
  const clientFilter = `{Client_ID}='${clientId}'`;
  if (!existingFormula || existingFormula.trim() === "") {
    return clientFilter;
  }
  return `AND(${clientFilter}, ${existingFormula})`;
}

export function markClientIdMissing(): void {
  if (!clientIdFieldKnownMissing) {
    clientIdFieldKnownMissing = true;
    log("Client_ID field not found in Airtable — all subsequent queries will skip scope filter", "airtable-scoped");
  }
}

export function isClientIdFieldAvailable(): boolean {
  return !clientIdFieldKnownMissing;
}

export async function getClientAirtableConfig(clientId: string): Promise<{ apiKey: string; baseId: string }> {
  const client = await storage.getClient(clientId);
  const apiKey = process.env.AIRTABLE_API_KEY || "";
  const baseId = client?.airtableBaseId || process.env.AIRTABLE_BASE_ID || "";
  return { apiKey, baseId };
}

export interface UsageLimits {
  maxTopPerRun: number;
  maxDmEnrichPerRun: number;
  maxQueryGeneratePerRun: number;
  maxPlaybooksPerRun: number;
  maxLeadFeedPerRun: number;
}

const PLATFORM_DEFAULTS: UsageLimits = {
  maxTopPerRun: 25,
  maxDmEnrichPerRun: 25,
  maxQueryGeneratePerRun: 20,
  maxPlaybooksPerRun: 25,
  maxLeadFeedPerRun: 5,
};

export async function getUsageLimits(clientId: string): Promise<UsageLimits> {
  const config = await storage.getClientConfig(clientId);
  if (!config) return { ...PLATFORM_DEFAULTS };
  return {
    maxTopPerRun: config.maxTopPerRun,
    maxDmEnrichPerRun: config.maxDmEnrichPerRun,
    maxQueryGeneratePerRun: config.maxQueryGeneratePerRun,
    maxPlaybooksPerRun: config.maxPlaybooksPerRun,
    maxLeadFeedPerRun: config.maxLeadFeedPerRun,
  };
}
