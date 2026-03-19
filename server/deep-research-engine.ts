import { db } from "./db";
import { companyFlows, inferredContacts, outreachPipeline } from "@shared/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { log } from "./logger";
import OpenAI from "openai";
import { generateEmailPatterns } from "./lead-intelligence";

const TAG = "deep-research-engine";

const openAiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const proxyClient = openAiApiKey
  ? new OpenAI({
      apiKey: openAiApiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    })
  : null;

const PRIORITIZED_RESEARCH_PATHS = [
  "/about",
  "/about-us",
  "/team",
  "/our-team",
  "/leadership",
  "/management",
  "/operations",
  "/operations-and-maintenance",
  "/services",
  "/project-management",
  "/projects",
  "/safety",
  "/hse",
  "/ehs",
  "/safety-health",
  "/contact",
  "/contact-us",
  "/locations",
  "/offices",
  "/branches",
  "/who-we-are",
  "/company",
];

const DECISION_ROLES = ["owner", "ops_manager", "project_manager"] as const;
type DecisionRole = (typeof DECISION_ROLES)[number] | "unknown";

interface ExtractedContact {
  full_name: string;
  title: string;
  role: DecisionRole;
  roleConfidenceScore: number; // 0-100
  evidence: string; // short snippet
}

interface PhonePath {
  label: string;
  phone: string;
}

interface EmailSplit {
  named: string[];
  generic: string[];
  all: string[];
}

interface DeepResearchResult {
  flowId: number;
  companyName: string;
  pagesScanned: number;
  extractedContacts: ExtractedContact[];
  phonesFound: PhonePath[];
  observedEmails: EmailSplit;
  inferredEmailCandidates: Array<{
    email: string;
    pattern: string;
    emailConfidenceScore: number;
    matchedObservedEmail: string | null;
    evidence: string | null;
  }>;
  selectedChannel: "email" | "call" | "research_more";
  bestInferredEmail: string | null;
  bestInferredEmailConfidence: number | null;
  bestDecisionRole: DecisionRole | null;
  blockerReasons: string[];
  deepResearchConverted: boolean;
}

function extractDomain(website: string): string | null {
  if (!website) return null;
  try {
    let url = website.trim();
    if (!url.startsWith("http")) url = `https://${url}`;
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    const cleaned = website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    return cleaned || null;
  }
}

async function fetchPageRaw(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DeepResearchBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmails(html: string): EmailSplit {
  const allEmails = new Set<string>();

  const mailtoMatches = html.match(/mailto:([^"'\s<>?]+)/gi) || [];
  for (const m of mailtoMatches) {
    const email = m.replace(/^mailto:/i, "").split("?")[0].toLowerCase().trim();
    if (email.includes("@") && !email.includes("@sentry") && !email.includes("@example")) {
      allEmails.add(email);
    }
  }

  const textContent = stripHtml(html);
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  const textEmails = textContent.match(emailPattern) || [];
  for (const e of textEmails) {
    const lower = e.toLowerCase();
    if (!lower.includes("@sentry") && !lower.includes("@example")) allEmails.add(lower);
  }

  const genericPrefixes = [
    "info",
    "office",
    "admin",
    "contact",
    "sales",
    "general",
    "hello",
    "support",
    "hr",
    "careers",
    "jobs",
    "billing",
    "accounts",
    "inquiries",
    "mail",
    "reception",
    "dispatch",
  ];

  const named: string[] = [];
  const generic: string[] = [];
  for (const email of allEmails) {
    const prefix = email.split("@")[0];
    if (genericPrefixes.some(g => prefix === g || prefix.startsWith(g + "."))) generic.push(email);
    else named.push(email);
  }

  return { named: [...named], generic: [...generic], all: [...allEmails] };
}

function getPhoneContext(html: string, phone: string): { label: string } {
  const idx = html.indexOf(phone);
  if (idx === -1) return { label: "Office" };
  const surrounding = html.substring(Math.max(0, idx - 220), Math.min(html.length, idx + 220)).toLowerCase();

  if (surrounding.includes("safety") || surrounding.includes("hse") || surrounding.includes("ehs")) return { label: "Safety Office" };
  if (surrounding.includes("dispatch")) return { label: "Dispatch" };
  if (surrounding.includes("reception") || surrounding.includes("front desk")) return { label: "Receptionist" };
  if (surrounding.includes("branch") || surrounding.includes("office")) return { label: "Branch Office" };
  if (surrounding.includes("main") || surrounding.includes("headquarters") || surrounding.includes("hq")) return { label: "Main Office" };
  if (surrounding.includes("direct") || surrounding.includes("mobile")) return { label: "Direct Line" };
  return { label: "Office" };
}

function extractPhones(html: string): PhonePath[] {
  const phones: PhonePath[] = [];
  const seen = new Set<string>();

  const telMatches = html.match(/(?:tel:|href="tel:)([^"'\s<>]+)/gi) || [];
  for (const m of telMatches) {
    const phone = m.replace(/^(?:tel:|href="tel:)/i, "").replace(/["\s]/g, "");
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 10 && !seen.has(digits)) {
      seen.add(digits);
      const ctx = getPhoneContext(html, phone);
      phones.push({ label: ctx.label, phone });
    }
  }

  const textContent = stripHtml(html);
  const phonePattern = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const textPhones = textContent.match(phonePattern) || [];
  for (const p of textPhones) {
    const digits = p.replace(/\D/g, "");
    if (digits.length >= 10 && !seen.has(digits)) {
      seen.add(digits);
      phones.push({ label: "Office", phone: p.trim() });
    }
  }

  return phones;
}

function splitFirstLast(fullName: string): { first: string; last: string } | null {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

function roleFromTitleHeuristic(title: string): DecisionRole {
  const t = (title || "").toLowerCase();
  if (!t) return "unknown";
  if (t.includes("owner") || t.includes("president") || t.includes("ceo") || t.includes("chief executive")) return "owner";
  if (t.includes("operations") || t.includes("ops manager") || t.includes("superintendent") || t.includes("plant manager") || t.includes("facility manager")) {
    return "ops_manager";
  }
  if (t.includes("project manager") || t.includes("project director") || t.includes("project") || t.includes("maintenance") || t.includes("construction")) {
    return "project_manager";
  }
  return "unknown";
}

function phoneAndRoleDecision(phonesFound: PhonePath[], contacts: ExtractedContact[]): {
  selectedChannel: "email" | "call" | "research_more";
  bestDecisionRole: DecisionRole | null;
} {
  const hasPhone = phonesFound.length > 0;
  const roleCandidates = contacts
    .filter(c => c.role !== "unknown")
    .sort((a, b) => (b.roleConfidenceScore || 0) - (a.roleConfidenceScore || 0));

  if (hasPhone && roleCandidates.length > 0 && roleCandidates[0].roleConfidenceScore >= 60) {
    return { selectedChannel: "call", bestDecisionRole: roleCandidates[0].role };
  }
  return { selectedChannel: "research_more", bestDecisionRole: roleCandidates[0]?.role ?? null };
}

function emailConfidenceBase(label: string): number {
  const l = (label || "").toLowerCase().trim();
  if (l === "high") return 85;
  if (l === "medium") return 65;
  if (l === "low") return 45;
  return 40;
}

function isGenericPrefix(email: string): boolean {
  const genericPrefixes = [
    "info",
    "office",
    "admin",
    "contact",
    "sales",
    "general",
    "hello",
    "support",
    "hr",
    "careers",
    "jobs",
    "billing",
    "accounts",
    "inquiries",
    "mail",
    "reception",
    "dispatch",
  ];
  const prefix = email.split("@")[0] || "";
  return genericPrefixes.some(g => prefix === g || prefix.startsWith(g + ".") || prefix.startsWith(g + "_"));
}

function computeEmailConfidence(params: {
  candidateEmail: string;
  contact: ExtractedContact;
  patternConfidenceLabel: string;
  observed: EmailSplit;
  evidenceText: string | null;
}): { score: number; matchedObservedEmail: string | null } {
  const { candidateEmail, contact, patternConfidenceLabel, observed, evidenceText } = params;
  let score = emailConfidenceBase(patternConfidenceLabel);

  const matchedObservedEmail =
    observed.named.includes(candidateEmail) ? candidateEmail :
    observed.all.includes(candidateEmail) ? candidateEmail :
    null;

  if (matchedObservedEmail) {
    score = 95;
    if (isGenericPrefix(candidateEmail)) score = 70;
  } else {
    // Name-pattern convention boost.
    const nameParts = splitFirstLast(contact.full_name);
    const local = candidateEmail.split("@")[0].toLowerCase();
    if (nameParts) {
      const f = nameParts.first.toLowerCase();
      const l = nameParts.last.toLowerCase();
      if (local.includes(f) && local.includes(l)) score += 10;
      else if (local.includes(l)) score += 6;
    }
  }

  // Evidence snippet boost (if the snippet contains an email address).
  if (evidenceText && evidenceText.includes(candidateEmail)) score += 8;

  // Role alignment: small but helpful.
  if (contact.role !== "unknown") score += Math.min(10, Math.round((contact.roleConfidenceScore || 0) / 10));

  // Penalize generic-looking addresses.
  if (isGenericPrefix(candidateEmail)) score -= 10;

  return { score: Math.min(100, Math.max(0, score)), matchedObservedEmail };
}

async function extractContactsWithLLM(params: {
  companyName: string;
  domain: string;
  text: string;
}): Promise<ExtractedContact[]> {
  if (!proxyClient) {
    // Without LLM access, return empty and rely on heuristics upstream.
    return [];
  }

  try {
    const response = await proxyClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a lead research agent for industrial contractors. From the provided website text, extract real decision-maker contacts.\n\nRules:\n- Only include people with a real first AND last name that appears in the text.\n- Identify their title and map to one of roles: owner, ops_manager, project_manager. If no strong fit, use unknown.\n- Provide roleConfidenceScore as an integer 0-100 indicating how certain you are.\n- Provide a short evidence snippet copied from the text (1-2 lines). Evidence must support the extracted name/title/role.\n- Output ONLY a valid JSON array (no markdown, no commentary).\n- Do NOT guess names that are not present in the text.\n",
        },
        {
          role: "user",
          content: `Company: ${params.companyName}\nDomain: ${params.domain}\n\nWebsite text (may include emails/phones/names):\n${params.text}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 1200,
    });

    const raw = response.choices[0]?.message?.content || "";
    const cleaned = raw
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((c: any) => typeof c?.full_name === "string" && c.full_name.includes(" "))
      .map((c: any) => {
        const role: DecisionRole = (DECISION_ROLES as readonly string[]).includes(c?.role) ? c.role : "unknown";
        return {
          full_name: String(c.full_name || "").trim(),
          title: String(c.title || "").trim(),
          role,
          roleConfidenceScore: Math.max(0, Math.min(100, Number(c.roleConfidenceScore || 0))),
          evidence: String(c.evidence || "").trim().slice(0, 4000),
        };
      });
  } catch (e: any) {
    log(`LLM contact extraction failed: ${e?.message || e}`, TAG);
    return [];
  }
}

const NOT_PERSON_WORDS = new Set([
  "the","and","for","our","its","with","from","this","that","are","was","has","have","will","can",
  "may","not","all","but","into","also","been","who","how","any","each","more","much","than",
  "very","most","just","over","only","such","some","other","both","many","well","back","down",
  "even","here","home","work","like","your","about","after","where","would","could","should",
  "their","being","first","last","new","old","high","low","big","top","full","best","next",
  "good","great","real","free","open","long","short","large","small","right","left","early",
  "late","hard","fast","same","main","key","major","minor","general","special","national",
  "industrial","commercial","construction","maintenance","safety","operations","services",
  "project","management","engineering","environmental","mechanical","electrical","thermal",
  "chemical","energy","pipe","fabrication","specialty","executive","corporate","financial",
  "president","vice","director","manager","superintendent","supervisor","coordinator",
  "assistant","associate","senior","junior","lead","chief","head","ship","guards","minutes",
  "decision","confidence","become","aggressive","facility","facilities","discover","modernization",
  "arizona","public","dunbar","crane","ton","area","insulation","equipment","supply","north",
  "south","east","west","central","gulf","coast","marine","field","plant","site","crew","team",
  "group","division","department","section","unit","office","building","put","set","get","let",
  "run","help","need","want","make","take","give","call","meet","keep","hold","turn","move",
]);

function isPlausiblePersonName(name: string): boolean {
  const parts = name.split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;
  for (const p of parts) {
    if (p.length === 1 && !p.match(/^[A-Z]$/)) return false;
    if (NOT_PERSON_WORDS.has(p.toLowerCase())) return false;
    if (p.length > 1 && !p.match(/^[A-Z][a-z]+\.?$/)) return false;
  }
  if (parts[0].length < 2 || parts[parts.length - 1].length < 2) return false;
  return true;
}

function inferContactsWithHeuristics(text: string): ExtractedContact[] {
  const contacts: ExtractedContact[] = [];
  const lines = text.split(/\n|\. |\! |\? /).map(l => l.trim()).filter(Boolean);
  const seen = new Set<string>();

  const titleKeywords = [
    "owner",
    "president",
    "ceo",
    "operations",
    "ops manager",
    "project manager",
    "superintendent",
    "hse",
    "safety",
    "maintenance",
    "director",
    "vp",
  ];

  for (const line of lines) {
    if (!titleKeywords.some(k => line.toLowerCase().includes(k))) continue;
    const m = line.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
    if (!m) continue;
    const fullName = `${m[1]} ${m[2]}`;
    if (!isPlausiblePersonName(fullName)) continue;
    const key = fullName.toLowerCase();
    if (seen.has(key)) continue;

    const title = line.length > 120 ? line.slice(0, 120) : line;
    const role = roleFromTitleHeuristic(title);
    const roleConfidenceScore = role === "unknown" ? 30 : 65;

    contacts.push({ full_name: fullName, title, role, roleConfidenceScore, evidence: line.slice(0, 300) });
    seen.add(key);
    if (contacts.length >= 6) break;
  }
  return contacts;
}

function computeBlockerReasons(params: {
  domain: string | null;
  pagesScanned: number;
  contacts: ExtractedContact[];
  phones: PhonePath[];
  bestEmailConfidence: number | null;
  emailThreshold: number;
  roleThreshold: number;
}) {
  const reasons: string[] = [];
  if (!params.domain) reasons.push("no_usable_domain");
  if (params.pagesScanned === 0) reasons.push("website_unreachable");
  if (params.contacts.length === 0) reasons.push("no_named_contacts");
  if (!params.phones.length) reasons.push("no_phone_paths");
  if (params.bestEmailConfidence === null || params.bestEmailConfidence < params.emailThreshold) reasons.push("email_confidence_below_threshold");
  if (params.bestEmailConfidence !== null && params.bestEmailConfidence < params.emailThreshold) {
    const topRole = params.contacts
      .filter(c => c.role !== "unknown")
      .sort((a, b) => (b.roleConfidenceScore || 0) - (a.roleConfidenceScore || 0))[0];
    if (!topRole || topRole.roleConfidenceScore < params.roleThreshold) reasons.push("decision_role_confidence_below_threshold");
  }
  return [...new Set(reasons)];
}

async function crawlForResearch(domain: string): Promise<{ pagesScanned: number; html: string; phones: PhonePath[]; emails: EmailSplit }> {
  const baseUrl = `https://${domain}`;

  const htmlParts: string[] = [];
  let pagesScanned = 0;

  const visited = new Set<string>();
  const queue: string[] = [];

  // Seed with prioritized paths.
  for (const p of PRIORITIZED_RESEARCH_PATHS) {
    queue.push(`${baseUrl}${p}`);
  }

  // Attempt sitemap first (best effort).
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const sitemap = await fetchPageRaw(sitemapUrl);
  if (sitemap) {
    const locMatches = sitemap.match(/<loc>([^<]+)<\/loc>/gi) || [];
    for (const loc of locMatches) {
      const url = loc.replace(/<\/?loc>/gi, "").trim();
      if (!url.startsWith("http")) continue;
      if (/(about|team|leadership|management|operations|project|safety|hse|contact|people)/i.test(url)) queue.push(url);
    }
  }

  const maxPages = 16;
  while (queue.length > 0 && pagesScanned < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const html = await fetchPageRaw(url);
    if (!html || html.length < 250) continue;

    htmlParts.push(html);
    pagesScanned++;

    // Discover a few additional internal links from the page (bounded).
    const hrefMatches = html.match(/href=["']([^"'#]+)["']/gi) || [];
    let added = 0;
    for (const href of hrefMatches) {
      if (added >= 4) break;
      const raw = href.replace(/href=["']/i, "").replace(/["']/i, "");
      if (!raw.startsWith("/")) continue;
      if (/\\.(png|jpg|jpeg|gif|svg|pdf|doc|docx)$/i.test(raw)) continue;
      if (!/(about|team|leadership|management|operations|project|safety|hse|contact|people)/i.test(raw)) continue;
      const full = `${baseUrl}${raw}`;
      if (!visited.has(full)) {
        queue.push(full);
        added++;
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }

  const combined = htmlParts.join("\n");
  const emails = extractEmails(combined);
  const phones = extractPhones(combined);
  return { pagesScanned, html: combined, phones, emails };
}

async function storeInferredEmailsWithScores(params: {
  clientId: string;
  companyId: string;
  companyName: string;
  domain: string;
  contact: ExtractedContact;
  inferredEmailCandidates: Array<{
    email: string;
    pattern: string;
    emailConfidenceScore: number;
    evidence: string | null;
  }>;
}): Promise<void> {
  const { clientId, companyId, companyName, domain, contact, inferredEmailCandidates } = params;

  const role = contact.role || "unknown";
  const roleConfidenceScore = Math.max(0, Math.min(100, contact.roleConfidenceScore || 0));

  const trimmedEvidenceLen = (v: any): number => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length;
  };

  const isBetterEvidence = (existingEvidence: any, nextEvidence: any): boolean => {
    const existingLen = trimmedEvidenceLen(existingEvidence);
    const nextLen = trimmedEvidenceLen(nextEvidence);
    if (nextLen <= 0) return false;
    if (existingLen <= 0) return true;
    // Require a meaningful increase so we don't overwrite strong evidence with weaker snippets.
    return nextLen > existingLen + 20;
  };

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let insertedLogs = 0;
  let updatedLogs = 0;
  let skippedLogs = 0;
  const LOG_LIMIT = 5;

  for (const c of inferredEmailCandidates) {
    try {
      // De-dupe by (client, company, personName, inferredEmail, pattern).
      const [existing] = await db.select()
        .from(inferredContacts)
        .where(
          and(
            eq(inferredContacts.clientId, clientId),
            eq(inferredContacts.companyId, companyId),
            eq(inferredContacts.personName, contact.full_name),
            eq(inferredContacts.inferredEmail, c.email),
            eq(inferredContacts.pattern, c.pattern),
          )
        )
        .limit(1);

      if (existing) {
        const emailIsHigher = existing.emailConfidenceScore < c.emailConfidenceScore;
        const roleIsHigher = existing.roleConfidenceScore < roleConfidenceScore;
        const evidenceIsBetter = isBetterEvidence(existing.evidence, c.evidence);

        const shouldUpdate = emailIsHigher || roleIsHigher || evidenceIsBetter;
        if (!shouldUpdate) {
          skipped++;
          if (skippedLogs < LOG_LIMIT) {
            log(
              `inferred_contacts skip: client=${clientId} company=${companyId} person="${contact.full_name}" email=${c.email} pattern=${c.pattern} (emailScore=${existing.emailConfidenceScore} roleScore=${existing.roleConfidenceScore})`,
              TAG
            );
            skippedLogs++;
          }
          continue;
        }

        const set: Record<string, any> = {
          source: existing.source ? `${existing.source};deep_research_engine` : "deep_research_engine",
        };

        if (emailIsHigher) {
          set.emailConfidenceScore = c.emailConfidenceScore;
          set.confidence = c.emailConfidenceScore >= 80 ? "medium" : "low";
        }
        if (roleIsHigher) {
          set.decisionMakerRole = role;
          set.roleConfidenceScore = roleConfidenceScore;
          set.personTitle = contact.title || null;
        }
        if (evidenceIsBetter) {
          set.evidence = c.evidence || null;
        }

        await db.update(inferredContacts).set(set).where(eq(inferredContacts.id, existing.id));
        updated++;
        if (updatedLogs < LOG_LIMIT) {
          log(
            `inferred_contacts update: client=${clientId} company=${companyId} person="${contact.full_name}" email=${c.email} pattern=${c.pattern} (emailScore ${existing.emailConfidenceScore}->${emailIsHigher ? c.emailConfidenceScore : existing.emailConfidenceScore}, roleScore ${existing.roleConfidenceScore}->${roleIsHigher ? roleConfidenceScore : existing.roleConfidenceScore})`,
            TAG
          );
          updatedLogs++;
        }
        continue;
      }

      inserted++;
      await db.insert(inferredContacts).values({
        clientId,
        companyId,
        companyName,
        domain,
        inferredEmail: c.email,
        pattern: c.pattern,
        confidence: c.emailConfidenceScore >= 80 ? "medium" : "low",
        emailConfidenceScore: c.emailConfidenceScore,
        decisionMakerRole: role,
        roleConfidenceScore: roleConfidenceScore,
        source: "deep_research_engine",
        personName: contact.full_name,
        personTitle: contact.title || null,
        evidence: c.evidence || null,
      });

      if (insertedLogs < LOG_LIMIT) {
        log(
          `inferred_contacts insert: client=${clientId} company=${companyId} person="${contact.full_name}" email=${c.email} pattern=${c.pattern} (emailScore=${c.emailConfidenceScore} roleScore=${roleConfidenceScore})`,
          TAG
        );
        insertedLogs++;
      }
    } catch (e: any) {
      log(`Failed to store inferred email (${contact.full_name}): ${e?.message || e}`, TAG);
    }
  }

  log(
    `storeInferredEmailsWithScores summary: client=${clientId} company=${companyId} person="${contact.full_name}" inserted=${inserted} updated=${updated} skipped=${skipped}`,
    TAG
  );
}

export async function deepResearchFlow(flowId: number): Promise<DeepResearchResult | null> {
  const [flow] = await db.select().from(companyFlows).where(eq(companyFlows.id, flowId));
  if (!flow) return null;

  const [pipeline] = await db.select().from(outreachPipeline).where(
    and(eq(outreachPipeline.clientId, flow.clientId), eq(outreachPipeline.companyId, flow.companyId))
  );

  const domain = pipeline?.website ? extractDomain(pipeline.website) : null;
  const blockerReasons: string[] = [];
  const companyName = flow.companyName;

  let pagesScanned = 0;
  let discoveredPhones: PhonePath[] = [];
  let observedEmails: EmailSplit = { named: [], generic: [], all: [] };
  let inferredEmailCandidates: DeepResearchResult["inferredEmailCandidates"] = [];
  let extractedContacts: ExtractedContact[] = [];

  if (!domain) {
    blockerReasons.push("no_usable_domain");
  } else {
    try {
      const crawl = await crawlForResearch(domain);
      pagesScanned = crawl.pagesScanned;
      observedEmails = crawl.emails;
      discoveredPhones = crawl.phones;

      const combinedText = stripHtml(crawl.html);
      const truncatedText = combinedText.slice(0, 22000);

      // LLM extraction for decision-makers.
      extractedContacts = await extractContactsWithLLM({
        companyName,
        domain,
        text: truncatedText,
      });

      // Heuristic fallback if LLM returns nothing.
      if (!extractedContacts.length) {
        extractedContacts = inferContactsWithHeuristics(truncatedText);
        extractedContacts = extractedContacts.map(c => ({ ...c, role: c.role || roleFromTitleHeuristic(c.title) }));
      }

      // Generate inferred email candidates for each extracted contact.
      const localInferred: DeepResearchResult["inferredEmailCandidates"] = [];

      for (const contact of extractedContacts) {
        const nameParts = splitFirstLast(contact.full_name);
        if (!nameParts) continue;

        const patterns = generateEmailPatterns(nameParts.first, nameParts.last, domain);
        for (const p of patterns) {
          const { score, matchedObservedEmail } = computeEmailConfidence({
            candidateEmail: p.email,
            contact,
            patternConfidenceLabel: p.confidence,
            observed: observedEmails,
            evidenceText: contact.evidence || null,
          });

          localInferred.push({
            email: p.email,
            pattern: p.pattern,
            emailConfidenceScore: score,
            matchedObservedEmail,
            evidence: contact.evidence || null,
          });
        }
      }

      // Prefer per-contact candidates; then dedupe by email+pattern highest score.
      const map = new Map<string, DeepResearchResult["inferredEmailCandidates"][number]>();
      for (const cand of localInferred) {
        const key = `${cand.email}::${cand.pattern}`;
        const prev = map.get(key);
        if (!prev || prev.emailConfidenceScore < cand.emailConfidenceScore) map.set(key, cand);
      }
      inferredEmailCandidates = [...map.values()].sort((a, b) => b.emailConfidenceScore - a.emailConfidenceScore);
    } catch (e: any) {
      blockerReasons.push(`crawl_failed:${e?.message || e}`);
      log(`Deep research crawl failed for flow #${flowId}: ${e?.message || e}`, TAG);
    }
  }

  const emailThreshold = 80;
  const roleThreshold = 60;

  const bestEmail = inferredEmailCandidates[0] || null;
  const bestEmailConfidence = bestEmail ? bestEmail.emailConfidenceScore : null;

  const roleDecision = phoneAndRoleDecision(discoveredPhones, extractedContacts);

  let selectedChannel: DeepResearchResult["selectedChannel"] = "research_more";
  let bestDecisionRole: DecisionRole | null = roleDecision.bestDecisionRole;
  if (bestEmail && bestEmailConfidence !== null && bestEmailConfidence >= emailThreshold) {
    selectedChannel = "email";
    // Prefer the role attached to the contact that could plausibly own this inferred email.
    const inferredDomain = domain || "";
    const bestEmailOwner = extractedContacts
      .map(c => {
        const parts = splitFirstLast(c.full_name);
        if (!parts) return null;
        const patterns = generateEmailPatterns(parts.first, parts.last, inferredDomain);
        return patterns.some(p => p.email === bestEmail.email) ? c : null;
      })
      .filter(Boolean)[0] as ExtractedContact | undefined;
    bestDecisionRole = bestEmailOwner?.role ?? bestDecisionRole ?? extractedContacts.find(c => c.role !== "unknown")?.role ?? null;
  } else if (roleDecision.selectedChannel === "call") {
    selectedChannel = "call";
  }

  const deepResearchConverted = selectedChannel !== "research_more";

  if (!deepResearchConverted) {
    const topRole = extractedContacts
      .filter(c => c.role !== "unknown")
      .sort((a, b) => (b.roleConfidenceScore || 0) - (a.roleConfidenceScore || 0))[0];

    blockerReasons.push(
      ...(computeBlockerReasons({
        domain,
        pagesScanned,
        contacts: extractedContacts,
        phones: discoveredPhones,
        bestEmailConfidence,
        emailThreshold,
        roleThreshold,
      }))
    );

    // De-dupe blockers.
    const deduped = [...new Set(blockerReasons)];
    blockerReasons.splice(0, blockerReasons.length, ...deduped);
  }

  log(
    `Flow #${flowId} deep research: pages=${pagesScanned} contacts=${extractedContacts.length} phones=${discoveredPhones.length} bestEmail=${bestEmail?.email || "none"} (${bestEmailConfidence ?? "n/a"}) -> ${selectedChannel}`,
    TAG
  );

  if (bestEmail) {
    const topRole = extractedContacts
      .filter(c => c.role !== "unknown")
      .sort((a, b) => (b.roleConfidenceScore || 0) - (a.roleConfidenceScore || 0))[0];
    log(
      `Decision details: bestEmailConfidence=${bestEmailConfidence} (threshold=${emailThreshold}) topRole=${topRole?.role || "unknown"} (${topRole?.roleConfidenceScore ?? 0}, threshold=${roleThreshold}) phones=${discoveredPhones.length}`,
      TAG
    );
  }

  // Store inferred email patterns + numeric confidence for audit.
  if (domain && extractedContacts.length && inferredEmailCandidates.length) {
    // Limit stored candidates to top N to avoid DB growth.
    const top = inferredEmailCandidates.slice(0, 18);

    // Group candidates by matching contact first/last tokens (simple heuristic).
    for (const contact of extractedContacts) {
      const nameParts = splitFirstLast(contact.full_name);
      if (!nameParts) continue;

      const perContact = top.filter(c => {
        const local = c.email.split("@")[0].toLowerCase();
        const f = nameParts.first.toLowerCase();
        const l = nameParts.last.toLowerCase();
        return local.includes(l) && (local.includes(f) || c.pattern.includes("first.last") || c.pattern.includes("firstlast"));
      });

      if (!perContact.length) continue;

      await storeInferredEmailsWithScores({
        clientId: flow.clientId,
        companyId: flow.companyId,
        companyName: flow.companyName,
        domain,
        contact,
        inferredEmailCandidates: perContact.map(c => ({
          email: c.email,
          pattern: c.pattern,
          emailConfidenceScore: c.emailConfidenceScore,
          evidence: c.evidence,
        })),
      });
    }
  }

  const updateData: Record<string, any> = {
    deepResearchRan: true,
    deepResearchSignals: JSON.stringify({
      pagesScanned,
      extractedContacts,
      observedEmails,
      inferredEmailCandidates: inferredEmailCandidates.slice(0, 12),
      selectedChannel,
      bestEmail,
    }),
    deepResearchBlockerReasons: blockerReasons.length ? JSON.stringify(blockerReasons) : null,
    updatedAt: new Date(),
  };

  if (selectedChannel === "email" && bestEmail) {
    updateData.bestChannel = "email";
    updateData.deepResearchBestInferredEmail = bestEmail.email;
    updateData.deepResearchBestInferredEmailConfidence = bestEmail.emailConfidenceScore;
    updateData.deepResearchSelectedRole = bestDecisionRole;

    updateData.routingReason = `Deep research inferred ${bestEmail.email} via email-pattern confidence ${bestEmail.emailConfidenceScore}/100`;
    updateData.bestContactPath = `email ${bestEmail.email} -> follow-up call if no reply`;
    updateData.enrichmentStatus = "deep_enriched";

    // Update outreach pipeline so email touches can be sent.
    if (pipeline) {
      const inferredDomain = domain || "";
      const matchingContacts = extractedContacts
        .map(c => {
          const parts = splitFirstLast(c.full_name);
          if (!parts) return null;
          const patterns = generateEmailPatterns(parts.first, parts.last, inferredDomain);
          return patterns.some(p => p.email === bestEmail.email) ? c : null;
        })
        .filter(Boolean) as ExtractedContact[];

      const bestContact =
        matchingContacts[0]
        || extractedContacts
          .slice()
          .sort((a, b) => (b.roleConfidenceScore || 0) - (a.roleConfidenceScore || 0))[0];

      updateData.researchConvertedFrom = "research_more";
      await db.update(outreachPipeline).set({
        contactEmail: bestEmail.email,
        contactName: bestContact?.full_name || pipeline.contactName || null,
        title: bestContact?.title || pipeline.title || null,
        phone: pipeline.phone, // unchanged
        source: "deep_research_engine",
        updatedAt: new Date(),
      }).where(eq(outreachPipeline.id, pipeline.id));
    }
  } else if (selectedChannel === "call" && discoveredPhones.length) {
    updateData.bestChannel = "call";
    updateData.deepResearchSelectedRole = bestDecisionRole;
    updateData.deepResearchBestInferredEmail = null;
    updateData.deepResearchBestInferredEmailConfidence = null;

    const bestPhone = discoveredPhones[0];
    const bestRoleContact = extractedContacts
      .filter(c => c.role !== "unknown")
      .sort((a, b) => (b.roleConfidenceScore || 0) - (a.roleConfidenceScore || 0))[0];

    updateData.routingReason = `Deep research selected call-first: role confidence ${(bestRoleContact?.roleConfidenceScore ?? 0)}/100 + phone available`;
    updateData.bestContactPath = `call ${bestPhone.label} (${bestPhone.phone}) -> ask for ${bestRoleContact?.full_name || "decision maker"} -> get direct email`;
    updateData.enrichmentStatus = "deep_enriched";
    updateData.researchConvertedFrom = "research_more";

    if (pipeline) {
      await db.update(outreachPipeline).set({
        contactName: bestRoleContact?.full_name || pipeline.contactName || null,
        title: bestRoleContact?.title || pipeline.title || null,
        phone: bestPhone.phone,
        source: "deep_research_engine",
        updatedAt: new Date(),
      }).where(eq(outreachPipeline.id, pipeline.id));
    }
  } else {
    // Keep bestChannel as research_more; just record blockers.
    updateData.enrichmentStatus = "research_blocked";
  }

  await db.update(companyFlows).set(updateData).where(eq(companyFlows.id, flowId));

  const result: DeepResearchResult = {
    flowId,
    companyName,
    pagesScanned,
    extractedContacts,
    phonesFound: discoveredPhones,
    observedEmails,
    inferredEmailCandidates,
    selectedChannel,
    bestInferredEmail: selectedChannel === "email" ? bestEmail?.email || null : null,
    bestInferredEmailConfidence: selectedChannel === "email" ? (bestEmail?.emailConfidenceScore ?? null) : null,
    bestDecisionRole,
    blockerReasons,
    deepResearchConverted,
  };

  return result;
}

export async function runDeepResearchEngine(clientId: string): Promise<{ totalProcessed: number; convertedToEmail: number; convertedToCall: number; remainingResearch: number; errors: number }> {
  const flows = await db.select({ id: companyFlows.id, companyName: companyFlows.companyName }).from(companyFlows).where(
    and(
      eq(companyFlows.clientId, clientId),
      eq(companyFlows.status, "active"),
      eq(companyFlows.bestChannel, "research_more"),
      eq(companyFlows.deepEnrichmentRan, true),
      and(
        or(eq(companyFlows.deepResearchRan, false), isNull(companyFlows.deepResearchRan)),
      )
    )
  );

  log(`Starting deep research engine for ${flows.length} remaining research_more flows (client: ${clientId})`, TAG);

  const result = {
    totalProcessed: 0,
    convertedToEmail: 0,
    convertedToCall: 0,
    remainingResearch: 0,
    errors: 0,
  };

  for (const flow of flows) {
    try {
      const res = await deepResearchFlow(flow.id);
      if (!res) {
        result.errors++;
        continue;
      }

      result.totalProcessed++;
      if (res.deepResearchConverted) {
        if (res.selectedChannel === "email") result.convertedToEmail++;
        if (res.selectedChannel === "call") result.convertedToCall++;
      } else {
        result.remainingResearch++;
      }
    } catch (e: any) {
      log(`Deep research failed for flow #${flow.id} (${flow.companyName}): ${e?.message || e}`, TAG);
      result.errors++;
    }
  }

  log(
    `Deep research engine complete: processed=${result.totalProcessed} email=${result.convertedToEmail} call=${result.convertedToCall} remaining=${result.remainingResearch} errors=${result.errors}`,
    TAG
  );

  return result;
}

