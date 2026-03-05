import { getIndustryConfig } from "./config";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

export interface DMCandidate {
  id: string;
  fullName: string;
  title: string;
  email: string;
  phone: string;
  seniority: string;
  department: string;
  source: string;
  enrichedAt: string | null;
  companyNameText: string;
}

export interface PrimaryDMResult {
  name: string;
  title: string;
  email: string;
  phone: string;
  seniority: string;
  source: string;
  confidence: number;
}

function logDM(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [dm-resolver] ${message}`);
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
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function fetchAllDecisionMakers(): Promise<DMCandidate[]> {
  const table = encodeURIComponent("Decision_Makers");
  const dms: DMCandidate[] = [];
  let offset: string | undefined;

  do {
    const params = offset ? `?pageSize=100&offset=${offset}` : "?pageSize=100";
    const data = await airtableRequest(`${table}${params}`);

    for (const rec of data.records || []) {
      const f = rec.fields;
      dms.push({
        id: rec.id,
        fullName: String(f.full_name || f.name || f.Full_Name || "").trim(),
        title: String(f.title || f.role || f.Title || "").trim(),
        email: String(f.email || f.email_address || f.Email || "").trim(),
        phone: String(f.phone || f.phone_number || f.Phone || "").trim(),
        seniority: String(f.seniority || f.Seniority || "").trim().toLowerCase(),
        department: String(f.department || f.Department || "").trim().toLowerCase(),
        source: String(f.source || f.Source || "").trim(),
        enrichedAt: f.enriched_at || f.updated_at || null,
        companyNameText: String(f.company_name_text || f.company || f.company_name || f.Company || "").trim(),
      });
    }
    offset = data.offset;
  } while (offset);

  return dms;
}

function buildTitleTiers(): Array<{ tier: number; patterns: RegExp[] }> {
  const cfg = getIndustryConfig().decision_maker_titles_tiers;
  function titlesToPatterns(titles: string[]): RegExp[] {
    return titles.map(t => new RegExp(t.replace(/\s+/g, "\\s*"), "i"));
  }
  return [
    { tier: 1, patterns: titlesToPatterns(cfg.tier1) },
    { tier: 2, patterns: titlesToPatterns(cfg.tier2) },
    { tier: 3, patterns: titlesToPatterns(cfg.tier3) },
    { tier: 4, patterns: titlesToPatterns(cfg.tier4) },
  ];
}

function getTitleTier(title: string): number {
  const tiers = buildTitleTiers();
  for (const t of tiers) {
    for (const p of t.patterns) {
      if (p.test(title)) return t.tier;
    }
  }
  return 5;
}

function getSeniorityBonus(seniority: string): number {
  const s = seniority.toLowerCase();
  if (/c[_-]?suite|c-level|ceo|cfo|coo|cto|chief/i.test(s) || /director/i.test(s) || /vp|vice\s*president/i.test(s)) {
    return 15;
  }
  if (/manager/i.test(s)) {
    return 10;
  }
  return 0;
}

function scoreDMCandidate(dm: DMCandidate): number {
  let score = 0;

  const titleTier = getTitleTier(dm.title);
  score += (5 - titleTier) * 10;

  const hasEmail = dm.email.length > 0 && dm.email.includes("@");
  const hasPhone = dm.phone.length > 3;
  if (hasEmail) score += 30;
  if (hasPhone) score += 20;
  if (hasEmail && hasPhone) score += 10;

  score += getSeniorityBonus(dm.seniority);

  if (dm.enrichedAt) {
    const enrichedDate = new Date(dm.enrichedAt);
    const daysSinceUpdate = (Date.now() - enrichedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate <= 30) score += 10;
  }

  return score;
}

function computeConfidence(dm: DMCandidate, score: number): number {
  const maxPossible = 40 + 60 + 15 + 10;
  const raw = Math.round((score / maxPossible) * 100);
  return Math.max(0, Math.min(100, raw));
}

function extractDomainFromEmail(email: string): string | null {
  const at = email.indexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim();
}

export function resolvePrimaryDM(
  companyName: string,
  normalizedDomain: string | null,
  allDMs: DMCandidate[]
): PrimaryDMResult | null {
  const companyLower = companyName.toLowerCase().trim();
  const domainLower = normalizedDomain?.toLowerCase().trim() || null;

  const candidates = allDMs.filter(dm => {
    const dmCompany = dm.companyNameText.toLowerCase().trim();
    if (dmCompany && (dmCompany === companyLower || companyLower.includes(dmCompany) || dmCompany.includes(companyLower))) {
      return true;
    }
    if (domainLower && dm.email) {
      const emailDomain = extractDomainFromEmail(dm.email);
      if (emailDomain && emailDomain === domainLower) return true;
    }
    return false;
  });

  if (candidates.length === 0) return null;

  const scored = candidates.map(dm => ({
    dm,
    titleTier: getTitleTier(dm.title),
    bonusScore: scoreDMCandidate(dm),
  }));

  scored.sort((a, b) => {
    if (a.titleTier !== b.titleTier) return a.titleTier - b.titleTier;
    return b.bonusScore - a.bonusScore;
  });

  const best = scored[0];
  const confidence = computeConfidence(best.dm, best.bonusScore);

  return {
    name: best.dm.fullName,
    title: best.dm.title,
    email: best.dm.email.includes("@") ? best.dm.email : "",
    phone: best.dm.phone.length > 3 ? best.dm.phone : "",
    seniority: best.dm.seniority,
    source: best.dm.source,
    confidence,
  };
}

export interface DMResolutionSummary {
  companiesOnList: number;
  companiesWithDM: number;
  companiesMissingDM: number;
  avgConfidence: number;
  updates: Array<{ companyId: string; companyName: string; dmName: string; dmTitle: string; confidence: number }>;
}

export async function resolveAndWriteDMs(
  selectedCompanies: Array<{
    id: string;
    companyName: string;
    normalizedDomain?: string | null;
    existingDM?: {
      name: string;
      email: string;
      phone: string;
      confidence: number;
    };
  }>
): Promise<DMResolutionSummary> {
  logDM(`Fetching Decision_Makers table...`);
  let allDMs: DMCandidate[];
  try {
    allDMs = await fetchAllDecisionMakers();
  } catch (e: any) {
    logDM(`Decision_Makers table not found or empty: ${e.message}`);
    allDMs = [];
  }
  logDM(`Found ${allDMs.length} decision makers across all companies`);

  const updates: Array<{ companyId: string; companyName: string; dmName: string; dmTitle: string; confidence: number }> = [];
  let totalConfidence = 0;
  let dmFoundCount = 0;

  const compTable = encodeURIComponent("Companies");
  const batchSize = 10;
  const pendingUpdates: Array<{ id: string; fields: Record<string, any> }> = [];

  for (const comp of selectedCompanies) {
    const result = resolvePrimaryDM(comp.companyName, comp.normalizedDomain || null, allDMs);

    if (!result) continue;

    let shouldUpdate = false;

    if (!comp.existingDM || !comp.existingDM.name) {
      shouldUpdate = true;
    } else if (result.confidence > (comp.existingDM.confidence || 0)) {
      shouldUpdate = true;
    } else if (
      (!comp.existingDM.email && result.email) ||
      (!comp.existingDM.phone && result.phone)
    ) {
      shouldUpdate = true;
    }

    if (shouldUpdate) {
      pendingUpdates.push({
        id: comp.id,
        fields: {
          Primary_DM_Name: result.name,
          Primary_DM_Title: result.title,
          Primary_DM_Email: result.email || null,
          Primary_DM_Phone: result.phone || null,
          Primary_DM_Seniority: result.seniority || null,
          Primary_DM_Source: result.source || null,
          Primary_DM_Confidence: result.confidence,
        },
      });

      updates.push({
        companyId: comp.id,
        companyName: comp.companyName,
        dmName: result.name,
        dmTitle: result.title,
        confidence: result.confidence,
      });
    }

    dmFoundCount++;
    totalConfidence += result.confidence;
  }

  for (let i = 0; i < pendingUpdates.length; i += batchSize) {
    const batch = pendingUpdates.slice(i, i + batchSize);
    try {
      await airtableRequest(compTable, {
        method: "PATCH",
        body: JSON.stringify({ records: batch }),
      });
    } catch (e: any) {
      logDM(`Batch DM update error: ${e.message}`);
    }
  }

  const summary: DMResolutionSummary = {
    companiesOnList: selectedCompanies.length,
    companiesWithDM: dmFoundCount,
    companiesMissingDM: selectedCompanies.length - dmFoundCount,
    avgConfidence: dmFoundCount > 0 ? Math.round(totalConfidence / dmFoundCount) : 0,
    updates,
  };

  logDM(`DM resolution complete: ${dmFoundCount}/${selectedCompanies.length} found, avg confidence=${summary.avgConfidence}`);
  return summary;
}
