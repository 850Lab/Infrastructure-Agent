import { fetchAllDecisionMakers, type DMCandidate } from "./dm-resolver";
import { log } from "./logger";
import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";
import { getDMAuthorityAdjustments, type DMAuthorityAdjustment } from "./dm-authority-learning";
import { getPlatformDMBoost } from "./platform-insights";
const FIT_THRESHOLD = 45;

interface FitCompany {
  id: string;
  companyName: string;
  primaryDMName: string;
  primaryDMTitle: string;
  primaryDMEmail: string;
  primaryDMPhone: string;
  gatekeeperName: string;
  notes: string;
  existingOfferDMName: string;
  existingOfferDMFitScore: number;
  existingOfferDMEmail: string;
  existingOfferDMPhone: string;
}

interface FitResult {
  fitScore: number;
  reason: string;
  fitTier: "strong" | "moderate" | "weak" | "none";
}

interface OfferDMCandidate {
  name: string;
  title: string;
  email: string;
  phone: string;
  fitScore: number;
  reason: string;
  source: string;
}

export interface DMFitSummary {
  totalCompanies: number;
  offerDMSelected: number;
  noFitCount: number;
  avgFitScore: number;
  updated: number;
  skipped: number;
}

function logFit(message: string) {
  log(message, "dm-fit");
}

async function airtableRequest(path: string, options: RequestInit = {}, config?: { apiKey: string; baseId: string }): Promise<any> {
  const apiKey = config?.apiKey || process.env.AIRTABLE_API_KEY;
  const baseId = config?.baseId || process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) throw new Error("Airtable credentials not configured");
  const url = `https://api.airtable.com/v0/${baseId}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export function scoreDMFit(title: string, email: string, phone: string, department: string, enrichedAt: string | null, authorityAdjustments?: DMAuthorityAdjustment[], platformBoost?: number): FitResult {
  let fitScore = 0;
  const reasons: string[] = [];
  const titleLower = (title || "").toLowerCase();
  const deptLower = (department || "").toLowerCase();

  if (/safety|hse|ehs|safety\s*manager|safety\s*director/.test(titleLower)) {
    fitScore += 45;
    reasons.push(`Safety-related title (+45)`);
  } else if (/superintendent|site\s*manager|field\s*supervisor/.test(titleLower)) {
    fitScore += 35;
    reasons.push(`Site/field ops title (+35)`);
  } else if (/project\s*manager|turnaround\s*manager|shutdown\s*manager/.test(titleLower)) {
    fitScore += 30;
    reasons.push(`Project/turnaround title (+30)`);
  } else if (/operations\s*manager|maintenance\s*manager/.test(titleLower)) {
    fitScore += 25;
    reasons.push(`Operations/maintenance title (+25)`);
  }

  if (/\b(ceo|cfo|coo|president|founder|owner|chairman)\b/.test(titleLower)) {
    fitScore -= 25;
    reasons.push(`Executive title penalty (-25)`);
  }
  if (/\b(hr|recruiting|talent|marketing|accounting)\b/.test(titleLower)) {
    fitScore -= 15;
    reasons.push(`Non-operational department penalty (-15)`);
  }

  if (/safety|operations|projects|maintenance/.test(deptLower)) {
    fitScore += 15;
    reasons.push(`Relevant department (+15)`);
  } else if (/finance|hr|marketing/.test(deptLower)) {
    fitScore -= 10;
    reasons.push(`Non-relevant department (-10)`);
  }

  if (email && email.includes("@")) {
    fitScore += 8;
    reasons.push(`Has direct email (+8)`);
  }
  if (phone && phone.length > 5) {
    fitScore += 6;
    reasons.push(`Has direct phone (+6)`);
  }

  if (enrichedAt) {
    const daysSince = (Date.now() - new Date(enrichedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 30) {
      fitScore += 6;
      reasons.push(`Recently updated (+6)`);
    }
  }

  if (authorityAdjustments && authorityAdjustments.length > 0) {
    for (const adj of authorityAdjustments) {
      if (adj.titlePattern.test(titleLower)) {
        fitScore += adj.adjustment;
        reasons.push(`${adj.reason} (${adj.adjustment > 0 ? "+" : ""}${adj.adjustment})`);
        break;
      }
    }
  }

  if (platformBoost && platformBoost !== 0) {
    fitScore += platformBoost;
    reasons.push(`Cross-client insight (${platformBoost > 0 ? "+" : ""}${platformBoost})`);
  }

  fitScore = Math.max(0, Math.min(fitScore, 100));

  let fitTier: FitResult["fitTier"];
  if (fitScore >= 60) fitTier = "strong";
  else if (fitScore >= 45) fitTier = "moderate";
  else if (fitScore > 0) fitTier = "weak";
  else fitTier = "none";

  return { fitScore, reason: reasons.join("; "), fitTier };
}

async function selectOfferDM(
  companyName: string,
  allDMs: DMCandidate[],
  primaryDM: { name: string; title: string; email: string; phone: string } | null,
  notes: string,
  authorityAdjustments?: DMAuthorityAdjustment[],
  industry?: string
): OfferDMCandidate | null {
  const companyDMs = allDMs.filter(
    dm => dm.companyNameText.toLowerCase() === companyName.toLowerCase()
  );

  const candidates: Array<OfferDMCandidate & { _fit: FitResult }> = [];

  for (const dm of companyDMs) {
    let boost = 0;
    try { boost = industry ? await getPlatformDMBoost(dm.title, industry) : 0; } catch (_) {}
    const fit = scoreDMFit(dm.title, dm.email, dm.phone, dm.department, dm.enrichedAt, authorityAdjustments, boost);
    candidates.push({
      name: dm.fullName,
      title: dm.title,
      email: dm.email,
      phone: dm.phone,
      fitScore: fit.fitScore,
      reason: fit.reason,
      source: `Decision_Makers (${dm.source || "enrichment"})`,
      _fit: fit,
    });
  }

  if (primaryDM && primaryDM.name) {
    const alreadyInList = candidates.some(
      c => c.name.toLowerCase() === primaryDM.name.toLowerCase()
    );
    if (!alreadyInList) {
      let boost = 0;
      try { boost = industry ? await getPlatformDMBoost(primaryDM.title, industry) : 0; } catch (_) {}
      const fit = scoreDMFit(primaryDM.title, primaryDM.email, primaryDM.phone, "", null, authorityAdjustments, boost);
      candidates.push({
        name: primaryDM.name,
        title: primaryDM.title,
        email: primaryDM.email,
        phone: primaryDM.phone,
        fitScore: fit.fitScore,
        reason: fit.reason,
        source: "Primary_DM fallback",
        _fit: fit,
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.fitScore - a.fitScore);
  const best = candidates[0];

  if (best.fitScore < FIT_THRESHOLD) return null;

  return {
    name: best.name,
    title: best.title,
    email: best.email,
    phone: best.phone,
    fitScore: best.fitScore,
    reason: best.reason,
    source: best.source,
  };
}

async function fetchTodayListForFit(clientId?: string, atConfig?: { apiKey: string; baseId: string }): Promise<FitCompany[]> {
  const table = encodeURIComponent("Companies");
  const baseFormula = `{Today_Call_List}=TRUE()`;
  const companies: FitCompany[] = [];

  const fetchPages = async (useScope: boolean) => {
    companies.length = 0;
    const formula = encodeURIComponent(useScope && clientId ? scopedFormula(clientId, baseFormula) : baseFormula);
    let offset: string | undefined;
    do {
      let params = `?pageSize=100&filterByFormula=${formula}`;
      if (offset) params += `&offset=${offset}`;
      const data = await airtableRequest(`${table}${params}`, {}, atConfig);
      for (const rec of data.records || []) {
        const f = rec.fields;
        companies.push({
          id: rec.id,
          companyName: String(f.company_name || f.Company_Name || "").trim(),
          primaryDMName: String(f.Primary_DM_Name || "").trim(),
          primaryDMTitle: String(f.Primary_DM_Title || "").trim(),
          primaryDMEmail: String(f.Primary_DM_Email || "").trim(),
          primaryDMPhone: String(f.Primary_DM_Phone || "").trim(),
          gatekeeperName: String(f.Gatekeeper_Name || "").trim(),
          notes: String(f.Notes || f.Opportunity_Notes || "").trim(),
          existingOfferDMName: String(f.Offer_DM_Name || "").trim(),
          existingOfferDMFitScore: parseInt(f.Offer_DM_FitScore || "0", 10) || 0,
          existingOfferDMEmail: String(f.Offer_DM_Email || "").trim(),
          existingOfferDMPhone: String(f.Offer_DM_Phone || "").trim(),
        });
      }
      offset = data.offset;
    } while (offset);
  };

  try {
    await fetchPages(!!clientId);
  } catch (e: any) {
    if (clientId && (e.message.includes("INVALID_FILTER") || e.message.includes("UNKNOWN_FIELD") || e.message.includes("Unknown field"))) {
      const { markClientIdMissing } = await import("./airtable-scoped");
      markClientIdMissing();
      await fetchPages(false);
    } else {
      throw e;
    }
  }

  return companies;
}

function shouldUpdate(existing: FitCompany, candidate: OfferDMCandidate | null): boolean {
  if (!candidate) {
    return !existing.existingOfferDMName && existing.existingOfferDMFitScore === 0;
  }

  if (!existing.existingOfferDMName) return true;

  if (candidate.fitScore > existing.existingOfferDMFitScore) return true;

  if (candidate.fitScore === existing.existingOfferDMFitScore) {
    if (candidate.email && !existing.existingOfferDMEmail) return true;
    if (candidate.phone && !existing.existingOfferDMPhone) return true;
  }

  return false;
}

export async function runDMFit(clientId?: string): Promise<DMFitSummary> {
  logFit("Fetching Today_Call_List companies and Decision_Makers...");

  const atConfig = clientId ? await getClientAirtableConfig(clientId) : undefined;

  let industry: string | undefined;
  if (clientId) {
    const client = await import("./storage").then(m => m.storage.getClient(clientId));
    industry = client?.industryConfig || undefined;
  }

  let authorityAdjustments: DMAuthorityAdjustment[] = [];
  try {
    authorityAdjustments = await getDMAuthorityAdjustments(clientId);
    if (authorityAdjustments.length > 0) {
      logFit(`Authority learning active: ${authorityAdjustments.length} adjustments loaded`);
    } else {
      logFit("No authority learning data yet — using baseline scores");
    }
  } catch (e: any) {
    logFit(`Authority learning fetch failed (non-blocking): ${e.message}`);
  }

  const [companies, allDMs] = await Promise.all([
    fetchTodayListForFit(clientId, atConfig),
    fetchAllDecisionMakers(),
  ]);

  logFit(`Loaded ${companies.length} today-list companies, ${allDMs.length} decision makers`);

  const table = encodeURIComponent("Companies");
  let offerDMSelected = 0;
  let noFitCount = 0;
  let totalFitScore = 0;
  let updated = 0;
  let skipped = 0;

  const batchSize = 10;
  const updates: Array<{ id: string; fields: Record<string, any> }> = [];

  for (const c of companies) {
    const primaryDM = c.primaryDMName
      ? { name: c.primaryDMName, title: c.primaryDMTitle, email: c.primaryDMEmail, phone: c.primaryDMPhone }
      : null;

    const candidate = await selectOfferDM(c.companyName, allDMs, primaryDM, c.notes, authorityAdjustments, industry);

    if (candidate) {
      offerDMSelected++;
      totalFitScore += candidate.fitScore;

      if (shouldUpdate(c, candidate)) {
        updates.push({
          id: c.id,
          fields: {
            Offer_DM_Name: candidate.name,
            Offer_DM_Title: candidate.title,
            Offer_DM_Email: candidate.email || null,
            Offer_DM_Phone: candidate.phone || null,
            Offer_DM_FitScore: candidate.fitScore,
            Offer_DM_Reason: candidate.reason,
            Offer_DM_Source: candidate.source,
            Offer_DM_Last_Selected: new Date().toISOString(),
          },
        });
        logFit(`Selected: ${c.companyName} → ${candidate.name} (${candidate.title}) fit=${candidate.fitScore}`);
      } else {
        skipped++;
        logFit(`Skipped: ${c.companyName} (existing Offer DM is same or better)`);
      }
    } else {
      noFitCount++;
      const noFitReason = "No strong-fit DM found; ask gatekeeper for Safety Manager / Site Superintendent.";
      if (!c.existingOfferDMName && c.existingOfferDMFitScore === 0) {
        updates.push({
          id: c.id,
          fields: {
            Offer_DM_Name: null,
            Offer_DM_Title: null,
            Offer_DM_Email: null,
            Offer_DM_Phone: null,
            Offer_DM_FitScore: 0,
            Offer_DM_Reason: noFitReason,
            Offer_DM_Source: null,
            Offer_DM_Last_Selected: new Date().toISOString(),
          },
        });
      } else {
        skipped++;
      }
      logFit(`No fit: ${c.companyName} — no DM meets threshold (${FIT_THRESHOLD})`);
    }
  }

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    try {
      await airtableRequest(table, {
        method: "PATCH",
        body: JSON.stringify({ records: batch }),
      }, atConfig);
      updated += batch.length;
    } catch (e: any) {
      logFit(`Batch update error: ${e.message}`);
    }
  }

  const avgFit = offerDMSelected > 0 ? Math.round(totalFitScore / offerDMSelected) : 0;
  logFit(`DM Fit complete: ${offerDMSelected}/${companies.length} selected, avg fit=${avgFit}, no-fit=${noFitCount}, updated=${updated}, skipped=${skipped}`);

  return {
    totalCompanies: companies.length,
    offerDMSelected,
    noFitCount,
    avgFitScore: avgFit,
    updated,
    skipped,
  };
}
