import { storage } from "./storage";
import { getUsageLimits } from "./airtable-scoped";
import { log } from "./logger";

export interface GuardResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  metricName: string;
}

const METRIC_TO_CONFIG: Record<string, string> = {
  top_companies: "maxTopPerRun",
  dm_enrich: "maxDmEnrichPerRun",
  query_generate: "maxQueryGeneratePerRun",
  playbooks: "maxPlaybooksPerRun",
  lead_feed: "maxLeadFeedPerRun",
};

export async function checkLimit(
  clientId: string,
  metricName: string,
  currentCount: number
): Promise<GuardResult> {
  const limits = await getUsageLimits(clientId);
  const configKey = METRIC_TO_CONFIG[metricName];
  if (!configKey) {
    return { allowed: true, remaining: Infinity, limit: Infinity, metricName };
  }

  const limit = (limits as any)[configKey] as number;
  const remaining = Math.max(0, limit - currentCount);

  return {
    allowed: currentCount < limit,
    remaining,
    limit,
    metricName,
  };
}

export async function logUsageMetric(
  clientId: string,
  runId: string | null,
  step: string,
  metricName: string,
  metricValue: number
): Promise<void> {
  try {
    await storage.logUsage({
      clientId,
      runId: runId || undefined,
      step,
      metricName,
      metricValue,
    });
  } catch (err: any) {
    log(`Usage logging failed: ${err.message}`, "usage-guard");
  }
}

export async function getUsageSummary(clientId: string, since?: Date) {
  const logs = await storage.getUsageLogs(clientId, since);
  const summary: Record<string, number> = {};
  for (const entry of logs) {
    summary[entry.metricName] = (summary[entry.metricName] || 0) + entry.metricValue;
  }
  return { clientId, since: since?.toISOString() || null, metrics: summary, entries: logs.length };
}
