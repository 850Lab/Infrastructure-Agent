import { log } from "./logger";
import { storage } from "./storage";
import { computeTitleEffectiveness } from "./dm-authority-learning";

function logAlert(message: string) {
  log(message, "machine-alerts");
}

interface AlertCandidate {
  alertType: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

async function detectTitlePerformanceChanges(clientId: string): Promise<AlertCandidate[]> {
  const alerts: AlertCandidate[] = [];
  const trends = await storage.getAuthorityTrends(clientId);

  if (trends.length === 0) return alerts;

  const dates = [...new Set(trends.map(t => new Date(t.snapshotDate).toISOString().slice(0, 10)))].sort();
  if (dates.length < 2) return alerts;

  const latestDate = dates[dates.length - 1];
  const prevDate = dates[dates.length - 2];

  const titleMap = new Map<string, { current: number; previous: number; sample: number }>();

  for (const t of trends) {
    const dateStr = new Date(t.snapshotDate).toISOString().slice(0, 10);
    if (dateStr !== latestDate && dateStr !== prevDate) continue;

    if (!titleMap.has(t.title)) {
      titleMap.set(t.title, { current: -1, previous: -1, sample: 0 });
    }
    const entry = titleMap.get(t.title)!;
    if (dateStr === latestDate) {
      entry.current = t.conversionRate;
      entry.sample = t.sampleSize;
    }
    if (dateStr === prevDate) {
      entry.previous = t.conversionRate;
    }
  }

  for (const [title, data] of titleMap.entries()) {
    if (data.current < 0 || data.previous < 0 || data.sample < 3) continue;

    const ratio = data.previous > 0 ? data.current / data.previous : 0;
    const diff = data.current - data.previous;

    if (ratio >= 2.0 && diff >= 10) {
      alerts.push({
        alertType: "title_performance_change",
        message: `${title} conversions increased ${ratio.toFixed(1)}x (${data.previous}% to ${data.current}%).`,
        severity: "info",
      });
    }

    if (ratio <= 0.5 && diff <= -10) {
      alerts.push({
        alertType: "title_decline",
        message: `${title} response rate dropped from ${data.previous}% to ${data.current}%.`,
        severity: "warning",
      });
    } else if (diff <= -15) {
      alerts.push({
        alertType: "title_decline",
        message: `${title} effectiveness declined ${Math.abs(diff)} points (${data.previous}% to ${data.current}%).`,
        severity: "warning",
      });
    }
  }

  return alerts;
}

async function detectAuthorityMismatch(clientId: string): Promise<AlertCandidate[]> {
  const alerts: AlertCandidate[] = [];

  try {
    const report = await computeTitleEffectiveness(clientId);
    if (report.total_contacts_analyzed < 5) return alerts;

    const totalContacts = report.title_rankings.reduce((s, r) => s + r.total_contacts, 0);
    const wrongPerson = report.title_rankings.reduce((s, r) => s + r.wrong_person, 0);
    const noAuthority = report.title_rankings.reduce((s, r) => s + r.no_authority, 0);

    const missRate = totalContacts > 0 ? Math.round(((wrongPerson + noAuthority) / totalContacts) * 100) : 0;

    if (missRate >= 40) {
      alerts.push({
        alertType: "authority_mismatch_spike",
        message: `Authority miss rate at ${missRate}% (${Math.round(wrongPerson + noAuthority)} of ${Math.round(totalContacts)} contacts).`,
        severity: "critical",
      });
    } else if (missRate >= 25) {
      alerts.push({
        alertType: "authority_mismatch_spike",
        message: `Authority miss rate elevated at ${missRate}%.`,
        severity: "warning",
      });
    }
  } catch (e: any) {
    logAlert(`Authority mismatch detection failed: ${e.message}`);
  }

  return alerts;
}

async function detectQueryPerformanceShift(clientId: string): Promise<AlertCandidate[]> {
  const alerts: AlertCandidate[] = [];

  try {
    const { getClientAirtableConfig, scopedFormula } = await import("./airtable-scoped");
    const atConfig = await getClientAirtableConfig(clientId);
    if (!atConfig.apiKey || !atConfig.baseId) return alerts;

    const formula = scopedFormula(clientId, "{Generation_Mode}!=''");
    const fields = ["Generation_Mode", "Offer_DM_Outcome", "Last_Outcome"]
      .map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

    const params = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
    const resp = await fetch(
      `https://api.airtable.com/v0/${atConfig.baseId}/Companies?${params}&${fields}`,
      { headers: { Authorization: `Bearer ${atConfig.apiKey}` } }
    );
    if (!resp.ok) return alerts;

    const data = await resp.json();
    const records = data.records || [];

    const modeStats = new Map<string, { total: number; positive: number }>();
    for (const rec of records) {
      const mode = String(rec.fields.Generation_Mode || "").trim();
      if (!mode) continue;

      if (!modeStats.has(mode)) modeStats.set(mode, { total: 0, positive: 0 });
      const stats = modeStats.get(mode)!;
      stats.total++;

      const outcome = String(rec.fields.Offer_DM_Outcome || rec.fields.Last_Outcome || "").toLowerCase();
      if (outcome === "converted" || outcome === "reached_dm" || outcome === "interested") {
        stats.positive++;
      }
    }

    const modes = [...modeStats.entries()]
      .filter(([, s]) => s.total >= 5)
      .map(([mode, s]) => ({ mode, rate: s.total > 0 ? s.positive / s.total : 0, total: s.total }))
      .sort((a, b) => b.rate - a.rate);

    if (modes.length >= 2) {
      const best = modes[0];
      const worst = modes[modes.length - 1];
      if (worst.rate > 0 && best.rate / worst.rate >= 2.5) {
        alerts.push({
          alertType: "query_performance_shift",
          message: `${best.mode} queries outperforming ${worst.mode} by ${(best.rate / worst.rate).toFixed(1)}x (${Math.round(best.rate * 100)}% vs ${Math.round(worst.rate * 100)}%).`,
          severity: "info",
        });
      }
    }
  } catch (e: any) {
    logAlert(`Query performance detection failed: ${e.message}`);
  }

  return alerts;
}

function isDuplicate(existing: { alertType: string; message: string }[], candidate: AlertCandidate): boolean {
  return existing.some(e => e.alertType === candidate.alertType && e.message === candidate.message);
}

export async function runAlertDetection(clientId: string): Promise<{ alertsCreated: number }> {
  logAlert("Starting alert detection...");

  const recentAlerts = await storage.getMachineAlerts(clientId, false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todaysAlerts = recentAlerts.filter(a =>
    new Date(a.createdAt).toISOString().slice(0, 10) === todayStr
  );

  const [titleAlerts, mismatchAlerts, queryAlerts] = await Promise.all([
    detectTitlePerformanceChanges(clientId),
    detectAuthorityMismatch(clientId),
    detectQueryPerformanceShift(clientId),
  ]);

  const allCandidates = [...titleAlerts, ...mismatchAlerts, ...queryAlerts];
  let created = 0;

  for (const candidate of allCandidates) {
    if (isDuplicate(todaysAlerts, candidate)) continue;

    await storage.createMachineAlert(clientId, candidate.alertType, candidate.message, candidate.severity);
    logAlert(`Alert created: [${candidate.severity}] ${candidate.message}`);
    created++;
  }

  logAlert(`Alert detection complete: ${created} new alerts from ${allCandidates.length} candidates`);
  return { alertsCreated: created };
}
