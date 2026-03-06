import { enrichCompany, writeDMsToAirtable } from "./dm-enrichment";
import { fetchAllDecisionMakers, resolveAndWriteDMs, type DMResolutionSummary } from "./dm-resolver";
import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";

function logDC(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [dm-coverage] ${message}`);
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
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

interface CallListCompany {
  id: string;
  companyName: string;
  website: string;
  normalizedDomain: string | null;
  dmCoverageStatus: string;
  dmLastEnriched: string | null;
  dmCount: number;
  finalPriority: number;
  bucket: string;
  primaryDMName: string;
  primaryDMTitle: string;
  primaryDMEmail: string;
  primaryDMPhone: string;
  primaryDMConfidence: number;
}

async function fetchCallListCompanies(top: number, clientId?: string, atConfig?: { apiKey: string; baseId: string }): Promise<CallListCompany[]> {
  const table = encodeURIComponent("Companies");
  const baseFormula = "{Today_Call_List}=TRUE()";
  const formula = encodeURIComponent(clientId ? scopedFormula(clientId, baseFormula) : baseFormula);
  const companies: CallListCompany[] = [];
  let offset: string | undefined;

  do {
    const params = `?filterByFormula=${formula}&pageSize=100${offset ? `&offset=${offset}` : ""}`;
    const data = await airtableRequest(`${table}${params}`, {}, atConfig);

    for (const rec of data.records || []) {
      const f = rec.fields;
      companies.push({
        id: rec.id,
        companyName: String(f.company_name || "").trim(),
        website: String(f.website || "").trim(),
        normalizedDomain: f.Normalized_Domain || null,
        dmCoverageStatus: String(f.DM_Coverage_Status || "").trim(),
        dmLastEnriched: f.DM_Last_Enriched || null,
        dmCount: parseInt(f.DM_Count || "0", 10) || 0,
        finalPriority: parseInt(f.Final_Priority || "0", 10) || 0,
        bucket: String(f.Bucket || "").trim(),
        primaryDMName: String(f.Primary_DM_Name || "").trim(),
        primaryDMTitle: String(f.Primary_DM_Title || "").trim(),
        primaryDMEmail: String(f.Primary_DM_Email || "").trim(),
        primaryDMPhone: String(f.Primary_DM_Phone || "").trim(),
        primaryDMConfidence: parseInt(f.Primary_DM_Confidence || "0", 10) || 0,
      });
    }
    offset = data.offset;
  } while (offset);

  companies.sort((a, b) => b.finalPriority - a.finalPriority);
  return companies.slice(0, top);
}

function needsEnrichment(c: CallListCompany): boolean {
  if (!c.dmLastEnriched) return true;
  if (c.dmCount === 0) {
    const daysSince = (Date.now() - new Date(c.dmLastEnriched).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 1) return true;
    return false;
  }
  const daysSince = (Date.now() - new Date(c.dmLastEnriched).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > 14) return true;
  return false;
}

async function countDMsForCompany(companyName: string, normalizedDomain: string | null, allDMs: Array<{ companyNameText: string; email: string }>): Promise<number> {
  const companyLower = companyName.toLowerCase().trim();
  const domainLower = normalizedDomain?.toLowerCase().trim() || null;

  return allDMs.filter(dm => {
    const dmCompany = dm.companyNameText.toLowerCase().trim();
    if (dmCompany && (dmCompany === companyLower || companyLower.includes(dmCompany) || dmCompany.includes(companyLower))) {
      return true;
    }
    if (domainLower && dm.email) {
      const at = dm.email.indexOf("@");
      if (at >= 0) {
        const emailDomain = dm.email.slice(at + 1).toLowerCase().trim();
        if (emailDomain === domainLower) return true;
      }
    }
    return false;
  }).length;
}

async function updateCompanyField(recordId: string, fields: Record<string, any>, atConfig?: { apiKey: string; baseId: string }): Promise<void> {
  const table = encodeURIComponent("Companies");
  await airtableRequest(`${table}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  }, atConfig);
}

export interface CoverageConfig {
  top: number;
  limit: number;
}

export interface CoverageResult {
  companiesOnList: number;
  companiesNeedingEnrichment: number;
  companiesEnriched: number;
  companiesReady: number;
  companiesMissing: number;
  companiesErrored: number;
  dmResolution: DMResolutionSummary | null;
  callList: Array<{
    companyName: string;
    finalPriority: number;
    bucket: string;
    primaryDMName: string;
    primaryDMTitle: string;
    primaryDMEmail: string;
    primaryDMPhone: string;
  }>;
}

export async function runDMCoverage(config: CoverageConfig, clientId?: string): Promise<CoverageResult> {
  logDC("Fetching Today_Call_List companies...");
  const atConfig = clientId ? await getClientAirtableConfig(clientId) : undefined;
  const companies = await fetchCallListCompanies(config.top, clientId, atConfig);
  logDC(`Found ${companies.length} companies on Today_Call_List`);

  let allDMs = await fetchAllDecisionMakers();
  logDC(`Loaded ${allDMs.length} decision makers for coverage check`);

  for (const c of companies) {
    c.dmCount = await countDMsForCompany(c.companyName, c.normalizedDomain, allDMs);
  }

  const queued = companies.filter(c => needsEnrichment(c) && c.website);
  const limited = queued.slice(0, config.limit);

  logDC(`Coverage gaps: ${queued.length} companies need enrichment, processing ${limited.length} (limit=${config.limit})`);

  const table = encodeURIComponent("Companies");
  if (limited.length > 0) {
    const batchSize = 10;
    for (let i = 0; i < limited.length; i += batchSize) {
      const batch = limited.slice(i, i + batchSize);
      const records = batch.map(c => ({
        id: c.id,
        fields: { DM_Coverage_Status: "Queued" },
      }));
      await airtableRequest(table, {
        method: "PATCH",
        body: JSON.stringify({ records }),
      }, atConfig);
    }
  }

  let enriched = 0;
  let errored = 0;

  for (const c of limited) {
    logDC(`Enriching: ${c.companyName} (${c.website})`);

    try {
      await updateCompanyField(c.id, { DM_Coverage_Status: "Enriching" }, atConfig);

      const result = await enrichCompany(c.id);
      const written = await writeDMsToAirtable(result);

      await updateCompanyField(c.id, {
        DM_Coverage_Status: "Enriching",
        DM_Last_Enriched: new Date().toISOString(),
      }, atConfig);

      enriched++;
      logDC(`  → ${result.decisionMakers.length} DMs found (${written} new written)`);
    } catch (e: any) {
      logDC(`  → ERROR: ${e.message}`);
      try {
        await updateCompanyField(c.id, {
          DM_Coverage_Status: "Error",
          DM_Last_Enriched: new Date().toISOString(),
        }, atConfig);
      } catch {}
      c.dmCoverageStatus = "Error";
      errored++;
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  if (enriched > 0) {
    logDC("Recomputing DM_Count for enriched companies...");
    allDMs = await fetchAllDecisionMakers();

    const countUpdates: Array<{ id: string; fields: Record<string, any> }> = [];
    for (const c of limited) {
      if (c.dmCoverageStatus === "Error") continue;
      const actualCount = await countDMsForCompany(c.companyName, c.normalizedDomain, allDMs);
      const status = actualCount > 0 ? "Ready" : "Missing";
      c.dmCount = actualCount;
      c.dmCoverageStatus = status;
      countUpdates.push({
        id: c.id,
        fields: { DM_Count: actualCount, DM_Coverage_Status: status },
      });
    }

    const batchSize2 = 10;
    for (let i = 0; i < countUpdates.length; i += batchSize2) {
      const batch = countUpdates.slice(i, i + batchSize2);
      try {
        await airtableRequest(table, {
          method: "PATCH",
          body: JSON.stringify({ records: batch }),
        }, atConfig);
      } catch (e: any) {
        logDC(`DM_Count update error: ${e.message}`);
      }
    }
  }

  logDC("Re-running DM resolver for all call-list companies...");
  allDMs = await fetchAllDecisionMakers();

  const companyInputs = companies.map(c => ({
    id: c.id,
    companyName: c.companyName,
    normalizedDomain: c.normalizedDomain,
    existingDM: c.primaryDMName ? {
      name: c.primaryDMName,
      email: c.primaryDMEmail,
      phone: c.primaryDMPhone,
      confidence: c.primaryDMConfidence,
    } : undefined,
  }));

  let dmResolution: DMResolutionSummary | null = null;
  try {
    dmResolution = await resolveAndWriteDMs(companyInputs);
  } catch (e: any) {
    logDC(`DM resolution failed: ${e.message}`);
  }

  const refreshed = await fetchCallListCompanies(config.top, clientId, atConfig);
  const refreshMap = new Map(refreshed.map(c => [c.id, c]));

  const callList = companies.map(c => {
    const fresh = refreshMap.get(c.id);
    return {
      companyName: c.companyName,
      finalPriority: c.finalPriority,
      bucket: c.bucket,
      primaryDMName: fresh?.primaryDMName || c.primaryDMName,
      primaryDMTitle: fresh?.primaryDMTitle || c.primaryDMTitle,
      primaryDMEmail: fresh?.primaryDMEmail || c.primaryDMEmail,
      primaryDMPhone: fresh?.primaryDMPhone || c.primaryDMPhone,
    };
  });

  const dmResolved = dmResolution?.companiesWithDM || 0;
  const ready = Math.max(
    companies.filter(c => c.dmCount > 0 || c.dmCoverageStatus === "Ready").length,
    dmResolved
  );
  const missing = companies.length - ready - errored;

  return {
    companiesOnList: companies.length,
    companiesNeedingEnrichment: queued.length,
    companiesEnriched: enriched,
    companiesReady: ready,
    companiesMissing: missing,
    companiesErrored: errored,
    dmResolution,
    callList,
  };
}
