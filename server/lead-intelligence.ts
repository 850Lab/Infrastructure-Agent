import { db } from "./db";
import { companyFlows, inferredContacts, outreachPipeline } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { log } from "./logger";

const TAG = "lead-intelligence";

interface CompanyData {
  companyName: string;
  companyId: string;
  clientId: string;
  contactName?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  website?: string | null;
  domain?: string | null;
  city?: string | null;
  state?: string | null;
  industry?: string | null;
  category?: string | null;
  dmStatus?: string | null;
  dmTitle?: string | null;
  flowType?: string;
  hasDirectEmail?: boolean;
  hasPhone?: boolean;
  hasWebsite?: boolean;
  hasDecisionMaker?: boolean;
  apolloHeadcount?: number | null;
  apolloIndustry?: string | null;
  outscraper_categories?: string[] | null;
}

export interface ScoringResult {
  revenuePotentialScore: number;
  reachabilityScore: number;
  heatRelevanceScore: number;
  contactConfidenceScore: number;
  compositeScore: number;
  bestChannel: "email" | "call" | "research_more" | "discard";
  routingReason: string;
  bestContactPath: string;
  scoringSignals: ScoringSignals;
}

interface ScoringSignals {
  revenuePotentialReasons: string[];
  reachabilityReasons: string[];
  heatRelevanceReasons: string[];
  contactConfidenceReasons: string[];
  routingFactors: string[];
  contactPathSteps: string[];
}

const HEAT_KEYWORDS = [
  "refinery", "petrochemical", "lng", "pipeline", "turnaround",
  "shutdown", "scaffolding", "insulation", "industrial", "plant",
  "offshore", "drilling", "fabrication", "construction", "mechanical",
  "electrical", "welding", "blasting", "coatings", "fireproofing",
  "tank", "vessel", "heat exchanger", "boiler", "compressor",
];

const HIGH_VALUE_KEYWORDS = [
  "refinery", "petrochemical", "lng", "offshore", "pipeline",
  "turnaround", "shutdown", "epc", "general contractor",
];

const OUTDOOR_CREW_KEYWORDS = [
  "field", "crew", "outdoor", "site", "yard", "job site",
  "construction", "scaffolding", "insulation", "roofing",
  "paving", "concrete", "excavation", "grading", "highway",
];

const GULF_COAST_STATES = ["TX", "LA", "MS", "AL", "FL"];
const GULF_COAST_CITIES = [
  "houston", "beaumont", "port arthur", "lake charles", "baton rouge",
  "new orleans", "corpus christi", "galveston", "texas city",
  "baytown", "pasadena", "deer park", "la porte", "channel view",
  "nederland", "orange", "groves", "sulphur", "westlake",
  "mobile", "pascagoula", "gulfport", "biloxi", "pensacola",
];

export function scoreRevenuePotential(data: CompanyData): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];

  const text = `${data.companyName} ${data.industry || ""} ${data.category || ""} ${(data.outscraper_categories || []).join(" ")}`.toLowerCase();

  for (const kw of HIGH_VALUE_KEYWORDS) {
    if (text.includes(kw)) {
      score += 12;
      reasons.push(`high-value keyword: ${kw}`);
    }
  }

  if (data.apolloHeadcount) {
    if (data.apolloHeadcount >= 500) {
      score += 15;
      reasons.push(`large company: ${data.apolloHeadcount}+ employees`);
    } else if (data.apolloHeadcount >= 100) {
      score += 10;
      reasons.push(`mid-size company: ${data.apolloHeadcount} employees`);
    } else if (data.apolloHeadcount >= 20) {
      score += 5;
      reasons.push(`small company: ${data.apolloHeadcount} employees`);
    }
  }

  if (data.hasWebsite) {
    score += 5;
    reasons.push("has website (operational indicator)");
  }

  if (text.includes("general contractor") || text.includes("epc")) {
    score += 10;
    reasons.push("GC/EPC — likely manages large crews");
  }

  const outdoorMatches = OUTDOOR_CREW_KEYWORDS.filter(kw => text.includes(kw));
  if (outdoorMatches.length >= 2) {
    score += 10;
    reasons.push(`multiple outdoor crew indicators: ${outdoorMatches.join(", ")}`);
  } else if (outdoorMatches.length === 1) {
    score += 5;
    reasons.push(`outdoor crew indicator: ${outdoorMatches[0]}`);
  }

  if (reasons.length === 0) {
    reasons.push("no strong revenue indicators found — base score");
  }

  return { score: Math.min(100, Math.max(0, score)), reasons };
}

export function scoreReachability(data: CompanyData): { score: number; reasons: string[] } {
  let score = 20;
  const reasons: string[] = [];

  if (data.hasDirectEmail && data.contactEmail) {
    score += 35;
    reasons.push(`direct email available: ${data.contactEmail}`);
  }

  if (data.hasPhone && data.phone) {
    score += 20;
    reasons.push("phone number available");
  }

  if (data.hasWebsite) {
    score += 10;
    reasons.push("website available for research");
  }

  if (data.hasDecisionMaker) {
    score += 15;
    reasons.push(`identified decision maker: ${data.contactName || "name on file"}`);
  }

  if (data.dmStatus === "DM_READY") {
    score += 10;
    reasons.push("DM status: ready");
  } else if (data.dmStatus === "DM_WEAK") {
    score += 5;
    reasons.push("DM status: weak — partial info");
  } else if (data.dmStatus === "NO_DM") {
    reasons.push("no decision maker identified");
  }

  if (!data.hasDirectEmail && !data.hasPhone) {
    reasons.push("no direct contact channels — low reachability");
  }

  return { score: Math.min(100, Math.max(0, score)), reasons };
}

export function scoreHeatRelevance(data: CompanyData): { score: number; reasons: string[] } {
  let score = 30;
  const reasons: string[] = [];

  const text = `${data.companyName} ${data.industry || ""} ${data.category || ""} ${(data.outscraper_categories || []).join(" ")}`.toLowerCase();

  const heatMatches = HEAT_KEYWORDS.filter(kw => text.includes(kw));
  if (heatMatches.length >= 3) {
    score += 30;
    reasons.push(`strong heat relevance: ${heatMatches.slice(0, 5).join(", ")}`);
  } else if (heatMatches.length >= 1) {
    score += 15 * heatMatches.length;
    reasons.push(`heat relevance keywords: ${heatMatches.join(", ")}`);
  }

  const stateUpper = (data.state || "").toUpperCase().trim();
  if (GULF_COAST_STATES.includes(stateUpper)) {
    score += 15;
    reasons.push(`Gulf Coast state: ${stateUpper}`);
  }

  const cityLower = (data.city || "").toLowerCase().trim();
  if (GULF_COAST_CITIES.some(gc => cityLower.includes(gc))) {
    score += 10;
    reasons.push(`Gulf Coast city: ${data.city}`);
  }

  const outdoorMatches = OUTDOOR_CREW_KEYWORDS.filter(kw => text.includes(kw));
  if (outdoorMatches.length > 0) {
    score += 10;
    reasons.push(`outdoor crew evidence: ${outdoorMatches.join(", ")}`);
  }

  if (heatMatches.length === 0 && outdoorMatches.length === 0) {
    reasons.push("no heat or outdoor relevance signals — base score");
  }

  return { score: Math.min(100, Math.max(0, score)), reasons };
}

export function scoreContactConfidence(data: CompanyData): { score: number; reasons: string[] } {
  let score = 10;
  const reasons: string[] = [];

  if (data.hasDirectEmail && data.contactEmail && !data.contactEmail.includes("info@") && !data.contactEmail.includes("office@") && !data.contactEmail.includes("admin@")) {
    score += 40;
    reasons.push("verified direct email (not generic)");
  } else if (data.hasDirectEmail && data.contactEmail) {
    score += 20;
    reasons.push("email on file (may be generic)");
  }

  if (data.hasDecisionMaker && data.contactName) {
    score += 20;
    reasons.push(`named decision maker: ${data.contactName}`);
  }

  if (data.dmTitle) {
    const titleLower = data.dmTitle.toLowerCase();
    if (titleLower.includes("owner") || titleLower.includes("president") || titleLower.includes("ceo") || titleLower.includes("vp") || titleLower.includes("director")) {
      score += 15;
      reasons.push(`high-authority title: ${data.dmTitle}`);
    } else if (titleLower.includes("manager") || titleLower.includes("superintendent") || titleLower.includes("supervisor")) {
      score += 10;
      reasons.push(`operational title: ${data.dmTitle}`);
    }
  }

  if (data.hasPhone) {
    score += 10;
    reasons.push("phone available as backup channel");
  }

  if (score <= 20) {
    reasons.push("low contact confidence — limited verified data");
  }

  return { score: Math.min(100, Math.max(0, score)), reasons };
}

export function determineChannel(data: CompanyData, reachabilityScore: number, contactConfidenceScore: number): { channel: "email" | "call" | "research_more" | "discard"; reason: string; contactPath: string; pathSteps: string[] } {
  const pathSteps: string[] = [];

  if (data.hasDirectEmail && contactConfidenceScore >= 50) {
    pathSteps.push("direct DM email");
    if (data.hasPhone) pathSteps.push("follow-up call if no reply");
    return {
      channel: "email",
      reason: `Direct email with ${contactConfidenceScore}% contact confidence — email-first outreach`,
      contactPath: pathSteps.join(" → "),
      pathSteps,
    };
  }

  if (data.hasDirectEmail && contactConfidenceScore < 50) {
    pathSteps.push("email (generic/uncertain)");
    pathSteps.push("follow-up call to verify contact");
    return {
      channel: "email",
      reason: `Email available but contact confidence only ${contactConfidenceScore}% — email then verify via call`,
      contactPath: pathSteps.join(" → "),
      pathSteps,
    };
  }

  if (data.hasPhone && !data.hasDirectEmail) {
    pathSteps.push("call office/main line");
    if (data.hasDecisionMaker) {
      pathSteps.push(`ask for ${data.contactName || "decision maker"}`);
    } else {
      pathSteps.push("ask for operations/safety/facilities manager");
    }
    pathSteps.push("get direct email during call");
    return {
      channel: "call",
      reason: `No direct email but phone available — call-first to establish contact`,
      contactPath: pathSteps.join(" → "),
      pathSteps,
    };
  }

  if (data.hasWebsite && reachabilityScore >= 30) {
    pathSteps.push("scrape website for contact info");
    pathSteps.push("check contact/about/safety pages");
    pathSteps.push("generate inferred email if domain known");
    return {
      channel: "research_more",
      reason: `No direct contact channels but website exists — needs deeper research`,
      contactPath: pathSteps.join(" → "),
      pathSteps,
    };
  }

  if (reachabilityScore < 20) {
    return {
      channel: "discard",
      reason: `Reachability score ${reachabilityScore}% — no viable contact path`,
      contactPath: "no viable path",
      pathSteps: ["no contact channels found"],
    };
  }

  pathSteps.push("attempt web search for contact info");
  pathSteps.push("check industry directories");
  return {
    channel: "research_more",
    reason: `Limited data (reachability: ${reachabilityScore}%) — needs research before outreach`,
    contactPath: pathSteps.join(" → "),
    pathSteps,
  };
}

export function computeCompositeScore(revenue: number, reachability: number, heat: number, confidence: number): number {
  return Math.round(
    revenue * 0.30 +
    heat * 0.30 +
    reachability * 0.25 +
    confidence * 0.15
  );
}

export function scoreCompany(data: CompanyData): ScoringResult {
  const revenue = scoreRevenuePotential(data);
  const reachability = scoreReachability(data);
  const heat = scoreHeatRelevance(data);
  const confidence = scoreContactConfidence(data);
  const composite = computeCompositeScore(revenue.score, reachability.score, heat.score, confidence.score);
  const routing = determineChannel(data, reachability.score, confidence.score);

  return {
    revenuePotentialScore: revenue.score,
    reachabilityScore: reachability.score,
    heatRelevanceScore: heat.score,
    contactConfidenceScore: confidence.score,
    compositeScore: composite,
    bestChannel: routing.channel,
    routingReason: routing.reason,
    bestContactPath: routing.contactPath,
    scoringSignals: {
      revenuePotentialReasons: revenue.reasons,
      reachabilityReasons: reachability.reasons,
      heatRelevanceReasons: heat.reasons,
      contactConfidenceReasons: confidence.reasons,
      routingFactors: [routing.reason],
      contactPathSteps: routing.pathSteps,
    },
  };
}

export function generateEmailPatterns(firstName: string, lastName: string, domain: string): Array<{ email: string; pattern: string; confidence: string }> {
  const f = firstName.toLowerCase().trim();
  const l = lastName.toLowerCase().trim();
  if (!f || !l || !domain) return [];

  return [
    { email: `${f}.${l}@${domain}`, pattern: "first.last", confidence: "medium" },
    { email: `${f}${l}@${domain}`, pattern: "firstlast", confidence: "medium" },
    { email: `${f[0]}${l}@${domain}`, pattern: "flast", confidence: "medium" },
    { email: `${f}@${domain}`, pattern: "first", confidence: "low" },
    { email: `${f[0]}.${l}@${domain}`, pattern: "f.last", confidence: "low" },
    { email: `${f}_${l}@${domain}`, pattern: "first_last", confidence: "low" },
  ];
}

export async function scoreAndUpdateFlow(flowId: number): Promise<ScoringResult | null> {
  const [flow] = await db.select().from(companyFlows).where(eq(companyFlows.id, flowId));
  if (!flow) return null;

  const [pipeline] = await db.select().from(outreachPipeline).where(
    and(
      eq(outreachPipeline.clientId, flow.clientId),
      eq(outreachPipeline.companyId, flow.companyId),
    )
  );

  const data: CompanyData = {
    companyName: flow.companyName,
    companyId: flow.companyId,
    clientId: flow.clientId,
    contactName: flow.contactName || pipeline?.contactName,
    contactEmail: pipeline?.contactEmail,
    phone: pipeline?.phone,
    website: pipeline?.website,
    city: pipeline?.city,
    state: pipeline?.state,
    industry: pipeline?.industry,
    dmStatus: null,
    dmTitle: pipeline?.title,
    flowType: flow.flowType,
    hasDirectEmail: !!(pipeline?.contactEmail),
    hasPhone: !!(pipeline?.phone),
    hasWebsite: !!(pipeline?.website),
    hasDecisionMaker: !!(flow.contactName || pipeline?.contactName),
  };

  const result = scoreCompany(data);

  await db.update(companyFlows).set({
    revenuePotentialScore: result.revenuePotentialScore,
    reachabilityScore: result.reachabilityScore,
    heatRelevanceScore: result.heatRelevanceScore,
    contactConfidenceScore: result.contactConfidenceScore,
    compositeScore: result.compositeScore,
    bestChannel: result.bestChannel,
    routingReason: result.routingReason,
    bestContactPath: result.bestContactPath,
    scoringSignals: JSON.stringify(result.scoringSignals),
    enrichmentStatus: "scored",
    lastEnrichedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(companyFlows.id, flowId));

  log(`Scored flow #${flowId} (${flow.companyName}): composite=${result.compositeScore}, channel=${result.bestChannel}`, TAG);
  return result;
}

export async function scoreAllFlowsForClient(clientId: string): Promise<{ scored: number; errors: number }> {
  const flows = await db.select({ id: companyFlows.id, companyName: companyFlows.companyName })
    .from(companyFlows)
    .where(
      and(
        eq(companyFlows.clientId, clientId),
        eq(companyFlows.status, "active"),
      )
    );

  let scored = 0;
  let errors = 0;

  for (const flow of flows) {
    try {
      await scoreAndUpdateFlow(flow.id);
      scored++;
    } catch (err: any) {
      log(`Error scoring flow #${flow.id} (${flow.companyName}): ${err.message}`, TAG);
      errors++;
    }
  }

  log(`Scored ${scored} flows for client ${clientId} (${errors} errors)`, TAG);
  return { scored, errors };
}

export async function storeInferredContacts(params: {
  clientId: string;
  companyId: string;
  companyName: string;
  domain: string;
  personName: string;
  personTitle?: string;
}): Promise<number> {
  const parts = params.personName.trim().split(/\s+/);
  if (parts.length < 2) return 0;

  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const patterns = generateEmailPatterns(firstName, lastName, params.domain);

  let stored = 0;
  for (const p of patterns) {
    try {
      await db.insert(inferredContacts).values({
        clientId: params.clientId,
        companyId: params.companyId,
        companyName: params.companyName,
        domain: params.domain,
        inferredEmail: p.email,
        pattern: p.pattern,
        confidence: p.confidence,
        source: "pattern_generation",
        personName: params.personName,
        personTitle: params.personTitle || null,
      });
      stored++;
    } catch {
      // duplicate or constraint violation — skip
    }
  }

  return stored;
}
