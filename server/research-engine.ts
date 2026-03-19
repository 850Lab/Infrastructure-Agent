import { db } from "./db";
import { companyFlows, inferredContacts, outreachPipeline } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { log } from "./logger";
import { scoreAndUpdateFlow, storeInferredContacts } from "./lead-intelligence";

const TAG = "research-engine";

const DEEP_CRAWL_PATHS = [
  "/contact", "/contact-us", "/contact-us/",
  "/about", "/about-us", "/about-us/",
  "/team", "/our-team", "/leadership", "/management",
  "/safety", "/hse", "/ehs", "/safety-health",
  "/operations", "/services",
  "/project-management", "/projects",
  "/careers", "/jobs", "/employment",
  "/locations", "/branches", "/offices",
  "/staff", "/our-people", "/who-we-are",
  "/company",
];

const TARGET_TITLES = [
  "safety manager", "safety director", "hse manager", "ehs manager", "hse director",
  "operations manager", "director of operations", "vp operations", "vp of operations",
  "project manager", "senior project manager", "project director",
  "superintendent", "general superintendent", "area superintendent",
  "maintenance manager", "maintenance director", "maintenance superintendent",
  "construction manager", "construction superintendent",
  "field operations", "field manager", "field supervisor",
  "plant manager", "facility manager", "site manager",
  "general manager", "branch manager", "regional manager",
  "owner", "president", "ceo", "vice president", "vp",
  "estimator", "chief estimator", "business development",
];

interface DiscoveredContact {
  name: string;
  title: string;
  email: string | null;
  phone: string | null;
  source: string;
  isTargetTitle: boolean;
}

interface PhonePath {
  label: string;
  phone: string;
  type: "main_office" | "receptionist" | "safety_office" | "branch" | "direct" | "dispatch" | "generic";
}

interface DeepEnrichResult {
  flowId: number;
  companyName: string;
  domain: string | null;
  pagesScanned: number;
  contactsFound: DiscoveredContact[];
  phonePaths: PhonePath[];
  emailsFound: string[];
  genericEmails: string[];
  namedEmails: string[];
  hasContactForm: boolean;
  blockerReasons: string[];
  previousChannel: string | null;
  newChannel: string | null;
  converted: boolean;
  inferredContactsStored: number;
}

async function fetchPageRaw(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadResearchBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return "";
    const html = await res.text();
    return html;
  } catch {
    return "";
  }
}

function extractEmails(html: string): { named: string[]; generic: string[]; all: string[] } {
  const allEmails = new Set<string>();

  const mailtoMatches = html.match(/mailto:([^"'\s<>?]+)/gi) || [];
  for (const m of mailtoMatches) {
    const email = m.replace(/^mailto:/i, "").split("?")[0].toLowerCase().trim();
    if (email.includes("@") && !email.includes("@sentry") && !email.includes("@example") && !email.includes(".png")) {
      allEmails.add(email);
    }
  }

  const textContent = html.replace(/<[^>]+>/g, " ");
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const textEmails = textContent.match(emailPattern) || [];
  for (const e of textEmails) {
    const lower = e.toLowerCase();
    if (!lower.includes("@sentry") && !lower.includes("@example") && !lower.includes(".png") && !lower.includes(".jpg") && !lower.includes("@wix") && !lower.includes("@wordpress")) {
      allEmails.add(lower);
    }
  }

  const GENERIC_PREFIXES = ["info", "office", "admin", "contact", "sales", "general", "hello", "support", "hr", "careers", "jobs", "billing", "accounts", "inquiries", "mail", "reception", "dispatch"];

  const named: string[] = [];
  const generic: string[] = [];
  for (const email of allEmails) {
    const prefix = email.split("@")[0];
    if (GENERIC_PREFIXES.some(g => prefix === g || prefix.startsWith(g + "."))) {
      generic.push(email);
    } else {
      named.push(email);
    }
  }

  return { named, generic, all: [...allEmails] };
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
      const context = getPhoneContext(html, phone);
      phones.push({ label: context.label, phone, type: context.type });
    }
  }

  const textContent = html.replace(/<[^>]+>/g, " ");
  const phonePattern = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const textPhones = textContent.match(phonePattern) || [];
  for (const p of textPhones) {
    const digits = p.replace(/\D/g, "");
    if (digits.length >= 10 && !seen.has(digits)) {
      seen.add(digits);
      phones.push({ label: "Office", phone: p.trim(), type: "generic" });
    }
  }

  return phones;
}

function getPhoneContext(html: string, phone: string): { label: string; type: PhonePath["type"] } {
  const idx = html.indexOf(phone);
  if (idx === -1) return { label: "Office", type: "generic" };

  const surrounding = html.substring(Math.max(0, idx - 200), Math.min(html.length, idx + 200)).toLowerCase();

  if (surrounding.includes("safety") || surrounding.includes("hse") || surrounding.includes("ehs")) return { label: "Safety Office", type: "safety_office" };
  if (surrounding.includes("dispatch")) return { label: "Dispatch", type: "dispatch" };
  if (surrounding.includes("reception") || surrounding.includes("front desk")) return { label: "Receptionist", type: "receptionist" };
  if (surrounding.includes("branch") || surrounding.includes("office")) return { label: "Branch Office", type: "branch" };
  if (surrounding.includes("main") || surrounding.includes("headquarters") || surrounding.includes("hq") || surrounding.includes("corporate")) return { label: "Main Office", type: "main_office" };
  if (surrounding.includes("direct") || surrounding.includes("cell") || surrounding.includes("mobile")) return { label: "Direct Line", type: "direct" };

  return { label: "Office", type: "generic" };
}

const NOT_PERSON_NAMES = new Set([
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
    if (NOT_PERSON_NAMES.has(p.toLowerCase())) return false;
    if (p.length > 1 && !p.match(/^[A-Z][a-z]+\.?$/)) return false;
  }
  if (parts[0].length < 2 || parts[parts.length - 1].length < 2) return false;
  return true;
}

function extractNamesAndTitles(html: string): DiscoveredContact[] {
  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\s+/g, " ");

  const contacts: DiscoveredContact[] = [];
  const seen = new Set<string>();

  for (const title of TARGET_TITLES) {
    const titleRegex = new RegExp(`([A-Z][a-z]+(?:\\s+[A-Z]\\.?)?\\s+[A-Z][a-z]+)\\s*[-–,|]?\\s*(?:${escapeRegex(title)})`, "gi");
    const matches = textContent.matchAll(titleRegex);
    for (const match of matches) {
      const name = match[1].trim();
      if (name.length > 4 && name.length < 50 && !seen.has(name.toLowerCase()) && isPlausiblePersonName(name)) {
        seen.add(name.toLowerCase());
        contacts.push({
          name,
          title: capitalizeTitle(title),
          email: null,
          phone: null,
          source: "website_extraction",
          isTargetTitle: true,
        });
      }
    }

    const reversedRegex = new RegExp(`(?:${escapeRegex(title)})\\s*[-–,|:]?\\s*([A-Z][a-z]+(?:\\s+[A-Z]\\.?)?\\s+[A-Z][a-z]+)`, "gi");
    const reversedMatches = textContent.matchAll(reversedRegex);
    for (const match of reversedMatches) {
      const name = match[1].trim();
      if (name.length > 4 && name.length < 50 && !seen.has(name.toLowerCase()) && isPlausiblePersonName(name)) {
        seen.add(name.toLowerCase());
        contacts.push({
          name,
          title: capitalizeTitle(title),
          email: null,
          phone: null,
          source: "website_extraction",
          isTargetTitle: true,
        });
      }
    }
  }

  return contacts;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalizeTitle(title: string): string {
  return title.replace(/\b\w/g, c => c.toUpperCase());
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

function detectContactForm(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes('type="submit"') && (lower.includes("contact") || lower.includes("inquiry") || lower.includes("message"));
}

function computeBlockerReasons(result: {
  domain: string | null;
  website: string | null;
  pagesScanned: number;
  contactsFound: number;
  emailsFound: number;
  phonesFound: number;
  hasContactForm: boolean;
  genericOnly: boolean;
}): string[] {
  const reasons: string[] = [];

  if (!result.website) reasons.push("no_website");
  else if (!result.domain) reasons.push("no_usable_domain");

  if (result.pagesScanned === 0 && result.website) reasons.push("website_unreachable");
  if (result.contactsFound === 0) reasons.push("no_named_contacts");
  if (result.emailsFound === 0 && result.phonesFound === 0) reasons.push("no_contact_info_found");
  if (result.emailsFound === 0 && result.phonesFound > 0) reasons.push("phone_only_no_email");
  if (result.genericOnly && result.emailsFound > 0) reasons.push("generic_email_only");
  if (result.hasContactForm && result.emailsFound === 0) reasons.push("contact_form_only");
  if (result.pagesScanned > 0 && result.contactsFound === 0 && result.emailsFound === 0) reasons.push("weak_operational_evidence");

  return reasons;
}

export async function deepEnrichFlow(flowId: number): Promise<DeepEnrichResult | null> {
  const [flow] = await db.select().from(companyFlows).where(eq(companyFlows.id, flowId));
  if (!flow) return null;

  const [pipeline] = await db.select().from(outreachPipeline).where(
    and(eq(outreachPipeline.clientId, flow.clientId), eq(outreachPipeline.companyId, flow.companyId))
  );

  const website = pipeline?.website || null;
  const domain = website ? extractDomain(website) : null;
  const previousChannel = flow.bestChannel;

  const result: DeepEnrichResult = {
    flowId,
    companyName: flow.companyName,
    domain,
    pagesScanned: 0,
    contactsFound: [],
    phonePaths: [],
    emailsFound: [],
    genericEmails: [],
    namedEmails: [],
    hasContactForm: false,
    blockerReasons: [],
    previousChannel,
    newChannel: null,
    converted: false,
    inferredContactsStored: 0,
  };

  if (!domain) {
    result.blockerReasons = computeBlockerReasons({
      domain: null, website, pagesScanned: 0, contactsFound: 0,
      emailsFound: 0, phonesFound: 0, hasContactForm: false, genericOnly: false,
    });

    await db.update(companyFlows).set({
      deepEnrichmentRan: true,
      researchBlockerReasons: JSON.stringify(result.blockerReasons),
      enrichmentStatus: "research_blocked",
      updatedAt: new Date(),
    }).where(eq(companyFlows.id, flowId));

    log(`[BLOCKED] ${flow.companyName}: no domain`, TAG);
    return result;
  }

  const baseUrl = `https://${domain}`;
  const allHtml: string[] = [];
  let pagesScanned = 0;

  const homePage = await fetchPageRaw(baseUrl);
  if (homePage) {
    allHtml.push(homePage);
    pagesScanned++;
  }

  const discoveredPaths: string[] = [];
  if (homePage) {
    const lower = homePage.toLowerCase();
    for (const path of DEEP_CRAWL_PATHS) {
      if (lower.includes(`href="${path}"`) || lower.includes(`href="/${path.replace(/^\//, "")}"`)) {
        discoveredPaths.push(path);
      }
    }
  }

  const pathsToScan = [...new Set([...discoveredPaths, ...DEEP_CRAWL_PATHS])].slice(0, 12);

  for (const path of pathsToScan) {
    const html = await fetchPageRaw(`${baseUrl}${path}`);
    if (html && html.length > 300) {
      allHtml.push(html);
      pagesScanned++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  result.pagesScanned = pagesScanned;
  const combinedHtml = allHtml.join("\n");

  const emails = extractEmails(combinedHtml);
  result.emailsFound = emails.all;
  result.genericEmails = emails.generic;
  result.namedEmails = emails.named;

  result.phonePaths = extractPhones(combinedHtml);
  result.contactsFound = extractNamesAndTitles(combinedHtml);
  result.hasContactForm = detectContactForm(combinedHtml);

  for (const contact of result.contactsFound) {
    const matchEmail = emails.named.find(e => {
      const prefix = e.split("@")[0].toLowerCase();
      const nameParts = contact.name.toLowerCase().split(/\s+/);
      return nameParts.some(p => prefix.includes(p));
    });
    if (matchEmail) {
      contact.email = matchEmail;
    }
  }

  let inferredCount = 0;
  for (const contact of result.contactsFound) {
    if (contact.isTargetTitle) {
      const stored = await storeInferredContacts({
        clientId: flow.clientId,
        companyId: flow.companyId,
        companyName: flow.companyName,
        domain,
        personName: contact.name,
        personTitle: contact.title,
      });
      inferredCount += stored;
    }
  }
  result.inferredContactsStored = inferredCount;

  const hasNamedEmail = emails.named.length > 0;
  const hasTargetContact = result.contactsFound.some(c => c.isTargetTitle);
  const hasPhone = result.phonePaths.length > 0;
  const hasNamedContactWithEmail = result.contactsFound.some(c => c.email);

  let newChannel: string | null = null;
  let newRoutingReason = "";
  let newContactPath = "";

  if (hasNamedContactWithEmail) {
    newChannel = "email";
    const c = result.contactsFound.find(c2 => c2.email)!;
    newRoutingReason = `Deep enrichment found ${c.name} (${c.title}) with email ${c.email}`;
    newContactPath = `email ${c.email} -> follow-up call if no reply`;
  } else if (hasNamedEmail) {
    newChannel = "email";
    newRoutingReason = `Deep enrichment found named email: ${emails.named[0]}`;
    newContactPath = `email ${emails.named[0]} -> verify contact via call`;
  } else if (hasTargetContact && hasPhone) {
    newChannel = "call";
    const bestContact = result.contactsFound.find(c => c.isTargetTitle)!;
    const bestPhone = result.phonePaths[0];
    newRoutingReason = `Found target contact ${bestContact.name} (${bestContact.title}) but no email — call ${bestPhone.label}`;
    newContactPath = `call ${bestPhone.label} (${bestPhone.phone}) -> ask for ${bestContact.name} -> get direct email`;
  } else if (hasPhone && !hasTargetContact && emails.generic.length > 0) {
    newChannel = "call";
    newRoutingReason = `Generic email only (${emails.generic[0]}) + phone available — call-first`;
    newContactPath = `call ${result.phonePaths[0].label} (${result.phonePaths[0].phone}) -> ask for operations/safety manager -> get direct email`;
  } else if (hasPhone) {
    newChannel = "call";
    newRoutingReason = `No email found but phone available — call to establish contact`;
    const bestPhone = result.phonePaths[0];
    newContactPath = `call ${bestPhone.label} (${bestPhone.phone}) -> ask for decision maker -> get email`;
  }

  result.newChannel = newChannel;
  result.converted = newChannel !== null && newChannel !== "research_more";

  result.blockerReasons = result.converted ? [] : computeBlockerReasons({
    domain,
    website,
    pagesScanned,
    contactsFound: result.contactsFound.length,
    emailsFound: emails.all.length,
    phonesFound: result.phonePaths.length,
    hasContactForm: result.hasContactForm,
    genericOnly: emails.named.length === 0 && emails.generic.length > 0,
  });

  const updateData: Record<string, any> = {
    deepEnrichmentRan: true,
    discoveredContacts: JSON.stringify(result.contactsFound),
    phonePaths: JSON.stringify(result.phonePaths),
    researchBlockerReasons: result.blockerReasons.length > 0 ? JSON.stringify(result.blockerReasons) : null,
    updatedAt: new Date(),
  };

  if (result.converted && newChannel) {
    updateData.bestChannel = newChannel;
    updateData.routingReason = newRoutingReason;
    updateData.bestContactPath = newContactPath;
    updateData.researchConvertedFrom = "research_more";
    updateData.enrichmentStatus = "deep_enriched";
  } else {
    updateData.enrichmentStatus = result.blockerReasons.length > 0 ? "research_blocked" : "deep_enriched";
  }

  await db.update(companyFlows).set(updateData).where(eq(companyFlows.id, flowId));

  if (!result.converted) {
    await scoreAndUpdateFlow(flowId);
  }

  const status = result.converted ? `CONVERTED -> ${newChannel}` : `BLOCKED (${result.blockerReasons.join(", ")})`;
  log(`${flow.companyName}: ${status} | pages=${pagesScanned} contacts=${result.contactsFound.length} emails=${emails.all.length} phones=${result.phonePaths.length}`, TAG);

  return result;
}

export interface ResearchRunResult {
  totalProcessed: number;
  convertedToEmail: number;
  convertedToCall: number;
  remainingResearch: number;
  blockerBreakdown: Record<string, number>;
  errors: number;
}

export async function runResearchEngine(clientId: string): Promise<ResearchRunResult> {
  const flows = await db.select({ id: companyFlows.id, companyName: companyFlows.companyName })
    .from(companyFlows)
    .where(
      and(
        eq(companyFlows.clientId, clientId),
        eq(companyFlows.status, "active"),
        eq(companyFlows.bestChannel, "research_more"),
      )
    );

  log(`Starting research engine for ${flows.length} research_more flows (client: ${clientId})`, TAG);

  const result: ResearchRunResult = {
    totalProcessed: 0,
    convertedToEmail: 0,
    convertedToCall: 0,
    remainingResearch: 0,
    blockerBreakdown: {},
    errors: 0,
  };

  for (const flow of flows) {
    try {
      const enrichResult = await deepEnrichFlow(flow.id);
      if (!enrichResult) {
        result.errors++;
        continue;
      }

      result.totalProcessed++;

      if (enrichResult.converted) {
        if (enrichResult.newChannel === "email") result.convertedToEmail++;
        else if (enrichResult.newChannel === "call") result.convertedToCall++;
      } else {
        result.remainingResearch++;
        for (const reason of enrichResult.blockerReasons) {
          result.blockerBreakdown[reason] = (result.blockerBreakdown[reason] || 0) + 1;
        }
      }
    } catch (err: any) {
      log(`Error enriching flow #${flow.id} (${flow.companyName}): ${err.message}`, TAG);
      result.errors++;
    }
  }

  log(`Research engine complete: processed=${result.totalProcessed} email=${result.convertedToEmail} call=${result.convertedToCall} remaining=${result.remainingResearch} errors=${result.errors}`, TAG);
  return result;
}
