import { db } from "./db";
import { companyFlows, outreachPipeline } from "@shared/schema";
import { eq, and, or, sql, lt, isNull, inArray } from "drizzle-orm";
import { log } from "./logger";
import { isOutscraperAvailable, searchGoogleMaps } from "./outscraper";

const TAG = "website-finder-engine";

export type WebsiteLookupStatus =
  | "found"
  | "candidate_stored"
  | "low_confidence"
  | "blocked_url"
  | "not_found"
  | "source_unavailable";

const BLOCKED_HOSTS = [
  "facebook.com",
  "linkedin.com",
  "yelp.com",
  "google.com",
  "maps.google",
  "yellowpages",
  "bbb.org",
  "manta.com",
  "thomasnet.com",
  "indeed.com",
  "glassdoor.com",
  "crunchbase.com",
  "zoominfo.com",
];

const SUFFIXES = /\b(llc|inc|ltd|co|company|services|corp|corporation)\b/gi;

function normalizeForBrand(s: string): string {
  return s
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "")
    .replace(SUFFIXES, "")
    .toLowerCase()
    .trim();
}

function extractRootDomain(url: string): string | null {
  try {
    let u = url.trim();
    if (!u.startsWith("http")) u = `https://${u}`;
    const parsed = new URL(u);
    const host = parsed.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".").toLowerCase();
    }
    return host.toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedUrl(site: string): boolean {
  const host = extractRootDomain(site) || site.toLowerCase();
  return BLOCKED_HOSTS.some(b => host.includes(b));
}

function computeConfidence(
  companyName: string,
  site: string,
  result: { full_address?: string | null; category?: string | null; rating?: number | null; reviews?: number | null },
  city?: string | null,
  state?: string | null
): { score: number; reasoning: string[] } {
  const reasons: string[] = [];
  let score = 70;

  const normalizedBrand = normalizeForBrand(companyName);
  const rootDomain = extractRootDomain(site);
  const domainWithoutTld = rootDomain ? rootDomain.split(".")[0] : "";

  if (normalizedBrand && domainWithoutTld && (normalizedBrand.includes(domainWithoutTld) || domainWithoutTld.includes(normalizedBrand))) {
    score += 30;
    reasons.push("exact brand/domain match");
  }

  if (city && result.full_address && result.full_address.toLowerCase().includes((city || "").toLowerCase())) {
    score += 5;
    reasons.push("city match in address");
  }
  if (state && result.full_address && result.full_address.toLowerCase().includes((state || "").toLowerCase())) {
    score += 5;
    reasons.push("state match in address");
  }

  if (result.rating != null && result.reviews != null && result.reviews > 5) {
    score -= 15;
    reasons.push("directory-style result (reviews)");
  }

  if (site.includes("-inc-") || site.includes("-llc-") || (site.match(/\//g) || []).length > 3) {
    score -= 20;
    reasons.push("generic/aggregator pattern");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasoning };
}

export interface WebsiteFinderResult {
  pipelineId: number;
  companyId: string;
  companyName: string;
  status: WebsiteLookupStatus;
  website?: string | null;
  websiteConfidenceScore?: number | null;
  websiteSource?: string | null;
  websiteReasoning?: string | null;
  websiteCandidate?: string | null;
  websiteCandidateConfidence?: number | null;
  websiteCandidateSource?: string | null;
}

async function lookupWebsiteForPipeline(
  pipeline: { id: number; companyId: string; companyName: string; city?: string | null; state?: string | null }
): Promise<WebsiteFinderResult> {
  const base: WebsiteFinderResult = {
    pipelineId: pipeline.id,
    companyId: pipeline.companyId,
    companyName: pipeline.companyName,
    status: "not_found",
  };

  if (!isOutscraperAvailable()) {
    base.status = "source_unavailable";
    base.websiteReasoning = "Outscraper API not configured";
    return base;
  }

  let result;
  try {
    result = await searchGoogleMaps(pipeline.companyName, pipeline.city || undefined, pipeline.state || undefined);
  } catch (e: any) {
    log(`website_finder: ${pipeline.companyName} — source_unavailable: ${e?.message || e}`, TAG);
    base.status = "source_unavailable";
    base.websiteReasoning = `Lookup failed: ${e?.message || "unknown error"}`;
    return base;
  }

  if (!result) {
    log(`website_finder: ${pipeline.companyName} — not_found`, TAG);
    base.status = "not_found";
    base.websiteReasoning = "No Google Maps result";
    return base;
  }

  const rawSite = result.site || null;
  if (!rawSite || typeof rawSite !== "string" || !rawSite.trim()) {
    log(`website_finder: ${pipeline.companyName} — not_found (no site in result)`, TAG);
    base.status = "not_found";
    base.websiteReasoning = "Result had no website field";
    return base;
  }

  let site = rawSite.trim();
  if (!site.startsWith("http")) site = `https://${site}`;

  if (isBlockedUrl(site)) {
    log(`website_finder: ${pipeline.companyName} — blocked_url: ${site}`, TAG);
    base.status = "blocked_url";
    base.websiteConfidenceScore = 0;
    base.websiteReasoning = `Blocked URL: ${extractRootDomain(site)}`;
    return base;
  }

  const { score, reasoning } = computeConfidence(
    pipeline.companyName,
    site,
    result,
    pipeline.city,
    pipeline.state
  );
  const reasoningStr = reasoning.length > 0 ? reasoning.join("; ") : `score ${score}`;

  if (score >= 80) {
    base.status = "found";
    base.website = site;
    base.websiteConfidenceScore = score;
    base.websiteSource = "outscraper_google_maps";
    base.websiteReasoning = reasoningStr;
    log(`website_finder: ${pipeline.companyName} — found: ${site} (${score})`, TAG);
    return base;
  }

  if (score >= 60 && score < 80) {
    base.status = "candidate_stored";
    base.websiteCandidate = site;
    base.websiteCandidateConfidence = score;
    base.websiteCandidateSource = "outscraper_google_maps";
    base.websiteReasoning = reasoningStr;
    log(`website_finder: ${pipeline.companyName} — candidate_stored: ${site} (${score})`, TAG);
    return base;
  }

  base.status = "low_confidence";
  base.websiteReasoning = reasoningStr;
  log(`website_finder: ${pipeline.companyName} — low_confidence: ${site} (${score})`, TAG);
  return base;
}

export async function runWebsiteFinderEngine(clientId: string): Promise<{
  processed: number;
  websitesFound: number;
  stillBlocked: number;
  notFound: number;
  candidateStored: number;
  lowConfidence: number;
  blockedUrl: number;
  sourceUnavailable: number;
  errors: number;
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const flows = await db
    .select({
      companyId: companyFlows.companyId,
      companyName: companyFlows.companyName,
    })
    .from(companyFlows)
    .where(
      and(
        eq(companyFlows.clientId, clientId),
        eq(companyFlows.status, "active"),
        eq(companyFlows.bestChannel, "research_more"),
        sql`${companyFlows.companyName} IS NOT NULL AND ${companyFlows.companyName} != ''`
      )
    );

  const companyIds = [...new Set(flows.map(f => f.companyId))];
  if (companyIds.length === 0) {
    log(`Website finder: no research_more flows for client ${clientId}`, TAG);
    return {
      processed: 0,
      websitesFound: 0,
      stillBlocked: 0,
      notFound: 0,
      candidateStored: 0,
      lowConfidence: 0,
      blockedUrl: 0,
      sourceUnavailable: 0,
      errors: 0,
    };
  }

  const pipelineRows = await db
    .select({
      id: outreachPipeline.id,
      companyId: outreachPipeline.companyId,
      companyName: outreachPipeline.companyName,
      city: outreachPipeline.city,
      state: outreachPipeline.state,
      website: outreachPipeline.website,
      websiteLookupRan: outreachPipeline.websiteLookupRan,
      websiteLookupAt: outreachPipeline.websiteLookupAt,
    })
    .from(outreachPipeline)
    .where(
      and(
        eq(outreachPipeline.clientId, clientId),
        inArray(outreachPipeline.companyId, companyIds),
        or(
          sql`${outreachPipeline.website} IS NULL`,
          sql`${outreachPipeline.website} = ''`
        ),
        or(
          eq(outreachPipeline.websiteLookupRan, false),
          isNull(outreachPipeline.websiteLookupAt),
          lt(outreachPipeline.websiteLookupAt, sevenDaysAgo)
        )
      )
    );

  const byCompany = new Map<string, typeof pipelineRows[0]>();
  for (const p of pipelineRows) {
    if (!byCompany.has(p.companyId)) {
      byCompany.set(p.companyId, p);
    }
  }

  const toProcess = Array.from(byCompany.values());
  log(`Website finder: ${toProcess.length} pipeline rows to process (client: ${clientId})`, TAG);

  const result = {
    processed: 0,
    websitesFound: 0,
    stillBlocked: 0,
    notFound: 0,
    candidateStored: 0,
    lowConfidence: 0,
    blockedUrl: 0,
    sourceUnavailable: 0,
    errors: 0,
  };

  for (const pipeline of toProcess) {
    try {
      const lookup = await lookupWebsiteForPipeline(pipeline);

      const update: Record<string, unknown> = {
        websiteLookupRan: true,
        websiteLookupAt: new Date(),
        websiteLookupStatus: lookup.status,
        websiteReasoning: lookup.websiteReasoning ?? null,
        updatedAt: new Date(),
      };

      if (lookup.status === "found") {
        update.website = lookup.website;
        update.websiteConfidenceScore = lookup.websiteConfidenceScore;
        update.websiteSource = lookup.websiteSource;
        update.websiteCandidate = null;
        update.websiteCandidateConfidence = null;
        update.websiteCandidateSource = null;
        result.websitesFound++;
      } else if (lookup.status === "candidate_stored") {
        update.websiteCandidate = lookup.websiteCandidate;
        update.websiteCandidateConfidence = lookup.websiteCandidateConfidence;
        update.websiteCandidateSource = lookup.websiteCandidateSource;
        update.websiteConfidenceScore = null;
        update.websiteSource = null;
        result.candidateStored++;
      } else if (lookup.status === "blocked_url") {
        update.websiteConfidenceScore = null;
        update.websiteSource = null;
        update.websiteCandidate = null;
        update.websiteCandidateConfidence = null;
        update.websiteCandidateSource = null;
        result.blockedUrl++;
      } else if (lookup.status === "not_found") {
        update.websiteConfidenceScore = null;
        update.websiteSource = null;
        update.websiteCandidate = null;
        update.websiteCandidateConfidence = null;
        update.websiteCandidateSource = null;
        result.notFound++;
      } else if (lookup.status === "low_confidence") {
        update.websiteConfidenceScore = null;
        update.websiteSource = null;
        update.websiteCandidate = null;
        update.websiteCandidateConfidence = null;
        update.websiteCandidateSource = null;
        result.lowConfidence++;
      } else if (lookup.status === "source_unavailable") {
        result.sourceUnavailable++;
      }

      await db.update(outreachPipeline).set(update as any).where(eq(outreachPipeline.id, pipeline.id));
      result.processed++;
    } catch (e: any) {
      log(`Website finder error for ${pipeline.companyName}: ${e?.message || e}`, TAG);
      await db
        .update(outreachPipeline)
        .set({
          websiteLookupRan: true,
          websiteLookupAt: new Date(),
          websiteLookupStatus: "source_unavailable",
          websiteReasoning: `Error: ${e?.message || "unknown"}`,
          updatedAt: new Date(),
        })
        .where(eq(outreachPipeline.id, pipeline.id));
      result.processed++;
      result.sourceUnavailable++;
      result.errors++;
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  result.stillBlocked =
    result.notFound + result.candidateStored + result.lowConfidence + result.blockedUrl + result.sourceUnavailable;

  log(
    `Website finder complete: processed=${result.processed} found=${result.websitesFound} blocked=${result.stillBlocked} (not_found=${result.notFound} candidate=${result.candidateStored} low=${result.lowConfidence} blocked_url=${result.blockedUrl} unavailable=${result.sourceUnavailable})`,
    TAG
  );

  return result;
}
