import { Express, Request, Response } from "express";
import OpenAI from "openai";
import { db } from "./db";
import { lngProjects, lngContacts, lngIntel, lngOperatorCards } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [lng-projects] ${msg}`);
}

async function searchGoogle(query: string): Promise<Array<{ title: string; link: string; snippet: string }>> {
  if (!OUTSCRAPER_API_KEY) {
    log("No OUTSCRAPER_API_KEY — using OpenAI-only mode");
    return [];
  }

  try {
    const params = new URLSearchParams({
      query,
      num: "10",
      async: "false",
    });
    const resp = await fetch(`https://api.outscraper.com/google-search-v3?${params}`, {
      headers: { "X-API-KEY": OUTSCRAPER_API_KEY },
    });
    if (!resp.ok) {
      const errText = await resp.text();
      log(`Outscraper error (${resp.status}): ${errText}`);
      return [];
    }
    const data = await resp.json();
    const results = data?.data?.[0]?.organic_results || data?.data?.[0]?.results || [];
    return results.slice(0, 10).map((r: any) => ({
      title: r.title || "",
      link: r.link || r.url || "",
      snippet: r.snippet || r.description || "",
    }));
  } catch (err: any) {
    log(`Google search error: ${err.message}`);
    return [];
  }
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("172.") || host.endsWith(".local") || host.endsWith(".internal")) return false;
    return true;
  } catch { return false; }
}

async function fetchPage(url: string): Promise<string> {
  if (!isSafeUrl(url)) return "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; IntelBot/1.0)" },
      redirect: "manual",
    });
    clearTimeout(timeout);
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 15000);
  } catch {
    return "";
  }
}

interface OperatorCard {
  companyName: string;
  industryType: string;
  region: string;
  priorityPeople: Array<{
    name: string;
    title: string;
    score: number;
    roleCategory: string;
    whyTheyMatter: string;
    publicSourceUrl: string;
  }>;
  whatTheyCareAbout: string[];
  professionalEnvironments: Array<{
    name: string;
    type: string;
    organizer: string;
    location: string;
    date: string;
    score: number;
    publicUrl: string;
    whyItMatters: string;
  }>;
  bestConnectors: Array<{
    type: string;
    name: string;
    organization: string;
    reason: string;
    score: number;
  }>;
  bestNextRoom: string;
  bestConnector: string;
  bestAction: string;
  backupAction: string;
  talkingAngle: string;
  whyThisPathMakesSense: string;
  confidence: number;
}

async function gatherIntel(query: string): Promise<{ searchContext: string; pageContents: string }> {
  const googleResults = await searchGoogle(query);
  log(`  "${query}" → ${googleResults.length} results`);

  const crawlPromises = googleResults.slice(0, 5).map(async (r) => {
    if (!r.link) return "";
    const content = await fetchPage(r.link);
    return content ? `\n--- Source: ${r.title} (${r.link}) ---\n${content.slice(0, 5000)}\n` : "";
  });
  const crawled = await Promise.all(crawlPromises);

  return {
    searchContext: googleResults.map(r => `- ${r.title}: ${r.snippet} (${r.link})`).join("\n"),
    pageContents: crawled.join(""),
  };
}

async function buildOperatorCards(query: string): Promise<OperatorCard[]> {
  log(`Building operator cards for: "${query}"`);

  const searchAngles = [
    query,
    `${query} operations manager maintenance superintendent site supervisor`,
    `${query} procurement manager vendor contractor supply chain`,
    `${query} safety council trade association contractor networking Gulf Coast`,
    `${query} conference expo trade show industrial 2025 2026`,
    `${query} contractor luncheon breakfast networking mixer industrial`,
  ];

  let allSearchContext = "";
  let allPageContents = "";

  for (const angle of searchAngles) {
    const { searchContext, pageContents } = await gatherIntel(angle);
    allSearchContext += searchContext + "\n";
    allPageContents += pageContents;
  }

  const prompt = `You are a Relationship Intelligence Engine for Texas Cool Down Trailers, a company that provides mobile cooling trailer solutions to industrial contractors during extreme heat work.

Your mission is to identify PUBLIC, PROFESSIONAL, LAWFUL relationship paths that help get warm introductions and booked presentations with contractor decision-makers involved in LNG, refinery, petrochemical, turnaround, shutdown, and industrial maintenance work across the Gulf Coast.

SEARCH QUERY: "${query}"

SEARCH RESULTS:
${allSearchContext}

WEB PAGE CONTENT:
${allPageContents.slice(0, 30000)}

ETHICAL RULES:
- ONLY use public professional information (company websites, public profiles, association memberships, conference pages, trade event listings, speaker rosters, sponsor lists, vendor events, business directories, industry calendars)
- NEVER collect, infer, or include: spouse/family details, private social routines, private clubs, home addresses, churches, gyms, restaurants, or any private-life targeting
- ONLY include real people whose names actually appear in the source material — NEVER fabricate names
- If data is weak, say confidence is low. Prefer fewer high-quality recommendations over many weak ones.

TARGET TITLES TO FIND (priority order):
- Operations Manager, Field Operations Manager, Construction Manager, Maintenance Manager, Turnaround Manager
- Site Superintendent, General Superintendent, Project Manager
- HSE Manager, Safety Manager, Procurement Manager
- Branch Manager, Regional Manager, Area Manager, Division Manager
- Plant Services Manager, Business Development Manager
- Coordinators, field engineers, planners, estimators, vendor managers
- CEOs only if very small company

WHAT EACH PERSON LIKELY CARES ABOUT PROFESSIONALLY:
Worker heat exposure, crew performance, mobilization logistics, field uptime, safety compliance, turnaround support, contractor productivity, morale/rest conditions, operational continuity

PROFESSIONAL ENVIRONMENTS TO FIND:
- Associated Builders and Contractors chapter events
- Safety council public events
- Industrial expos, LNG/downstream conferences
- Sponsor lists, exhibitor lists
- Customer appreciation events from industrial vendors (e.g. United Rentals, Sunbelt)
- Trade breakfasts, contractor luncheons
- Gulf Coast workforce/craft-industry events
- Rental equipment open houses, industrial safety conferences

CONNECTOR TYPES TO IDENTIFY:
- Equipment rental reps (United Rentals, Sunbelt, etc.)
- Safety product reps
- Staffing reps serving industrial contractors
- Association organizers
- Subcontractor PMs
- Training center contacts
- Mutual business connections shown publicly

For each company found in the search results, produce a structured operator card. Return a JSON object with a "cards" array. Each card must have:

{
  "companyName": "string",
  "industryType": "string (LNG/refinery/petrochemical/industrial maintenance/etc)",
  "region": "string (city/area)",
  "priorityPeople": [
    {
      "name": "string (REAL name from sources only)",
      "title": "string",
      "score": number (0-100 based on relevance to field operations/heat/crew support),
      "roleCategory": "string (decision_maker/influencer/connector)",
      "whyTheyMatter": "string (1 sentence)",
      "publicSourceUrl": "string (URL where found)"
    }
  ],
  "whatTheyCareAbout": ["string array of professional concerns"],
  "professionalEnvironments": [
    {
      "name": "string",
      "type": "string (trade_association/safety_council/conference/vendor_event/networking/training)",
      "organizer": "string",
      "location": "string",
      "date": "string (if known)",
      "score": number (0-100),
      "publicUrl": "string",
      "whyItMatters": "string (1 sentence)"
    }
  ],
  "bestConnectors": [
    {
      "type": "string (rental_rep/safety_rep/staffing_rep/association_organizer/subcontractor_pm/vendor_rep)",
      "name": "string (if public, otherwise generic type)",
      "organization": "string",
      "reason": "string (why this connector helps)",
      "score": number (0-100)
    }
  ],
  "bestNextRoom": "string (single best professional environment to show up at)",
  "bestConnector": "string (single best connector to pursue)",
  "bestAction": "string (specific, actionable recommendation)",
  "backupAction": "string (secondary move)",
  "talkingAngle": "string (1-2 sentences positioning cooling trailers for this specific company's work)",
  "whyThisPathMakesSense": "string (short explanation)",
  "confidence": number (0-100)
}

SCORING GUIDANCE:
- Operations Manager: 95, Site Superintendent: 92, Construction Manager: 90
- Maintenance Manager: 88, Turnaround Manager: 88, HSE Manager: 78
- Procurement Manager: 72, Business Development Manager: 58
- Environment score: weight by concentration of relevant roles, likelihood of target company presence, Gulf Coast proximity, industrial specificity
- Connector score: weight by closeness to operations/supervision, already serves target company type, public credibility

Return ONLY valid JSON with a "cards" array. No markdown formatting. If no companies are found, return {"cards": []}.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 8000,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const cards: OperatorCard[] = parsed.cards || [];

    log(`Operator cards built: ${cards.length} companies`);
    return cards;
  } catch (err: any) {
    log(`OpenAI analysis error: ${err.message}`);
    return [];
  }
}

export function registerLngRoutes(app: Express, authMiddleware: any) {
  app.post("/api/lng/search", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== "string") return res.status(400).json({ error: "Search query required" });
      const trimmedQuery = query.trim().slice(0, 200);
      if (!trimmedQuery) return res.status(400).json({ error: "Search query required" });

      log(`Search request: "${trimmedQuery}"`);
      const cards = await buildOperatorCards(trimmedQuery);
      log(`Search complete: ${cards.length} operator cards`);

      res.json({ cards, query });
    } catch (err: any) {
      log(`Search error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lng/cards/save", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });

      const { card } = req.body;
      if (!card?.companyName) return res.status(400).json({ error: "Company name required" });

      const [saved] = await db.insert(lngOperatorCards).values({
        clientId,
        companyName: card.companyName,
        industryType: card.industryType || null,
        region: card.region || null,
        cardData: JSON.stringify(card),
        confidence: card.confidence || null,
        bestNextRoom: card.bestNextRoom || null,
        bestConnector: card.bestConnector || null,
        bestAction: card.bestAction || null,
      }).returning();

      log(`Saved operator card: ${card.companyName} (id=${saved.id})`);
      res.json({ ok: true, card: saved });
    } catch (err: any) {
      log(`Save card error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/lng/cards", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });

      const cards = await db.select().from(lngOperatorCards)
        .where(eq(lngOperatorCards.clientId, clientId))
        .orderBy(desc(lngOperatorCards.savedAt));

      res.json(cards);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/lng/cards/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      await db.delete(lngOperatorCards).where(and(eq(lngOperatorCards.id, id), eq(lngOperatorCards.clientId, clientId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/lng/cards/:id/notes", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      const { notes } = req.body;

      const [updated] = await db.update(lngOperatorCards)
        .set({ notes, updatedAt: new Date() })
        .where(and(eq(lngOperatorCards.id, id), eq(lngOperatorCards.clientId, clientId)))
        .returning();

      res.json({ ok: true, card: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lng/projects/save", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });
      const { project } = req.body;
      if (!project?.projectName) return res.status(400).json({ error: "Project name required" });
      const [saved] = await db.insert(lngProjects).values({
        clientId, projectName: project.projectName, operator: project.operator || null,
        location: project.location || null, state: project.state || null, status: project.status || null,
        capacity: project.capacity || null, estimatedValue: project.estimatedValue || null,
        description: project.description || null, contractors: project.contractors || null,
        timeline: project.timeline || null, source: project.source || null, sourceUrl: project.sourceUrl || null,
      }).returning();
      res.json({ ok: true, project: saved });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/lng/projects", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });
      const projects = await db.select().from(lngProjects).where(eq(lngProjects.clientId, clientId)).orderBy(desc(lngProjects.savedAt));
      res.json(projects);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/lng/projects/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      await db.delete(lngProjects).where(and(eq(lngProjects.id, id), eq(lngProjects.clientId, clientId)));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/lng/projects/:id/notes", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      const { notes } = req.body;
      const [updated] = await db.update(lngProjects).set({ notes, updatedAt: new Date() })
        .where(and(eq(lngProjects.id, id), eq(lngProjects.clientId, clientId))).returning();
      res.json({ ok: true, project: updated });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/lng/contacts/save", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });
      const { contact } = req.body;
      if (!contact?.fullName) return res.status(400).json({ error: "Contact name required" });
      const [saved] = await db.insert(lngContacts).values({
        clientId, fullName: contact.fullName, title: contact.title || null,
        company: contact.company || null, email: contact.email || null, phone: contact.phone || null,
        linkedin: contact.linkedin || null, source: contact.source || null,
      }).returning();
      res.json({ ok: true, contact: saved });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/lng/contacts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });
      const contacts = await db.select().from(lngContacts).where(eq(lngContacts.clientId, clientId)).orderBy(desc(lngContacts.savedAt));
      res.json(contacts);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/lng/contacts/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      await db.delete(lngContacts).where(and(eq(lngContacts.id, id), eq(lngContacts.clientId, clientId)));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/lng/intel", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });
      const items = await db.select().from(lngIntel).where(eq(lngIntel.clientId, clientId)).orderBy(desc(lngIntel.savedAt));
      res.json(items);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/lng/intel/save", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });
      const { item } = req.body;
      if (!item?.title) return res.status(400).json({ error: "Intel title required" });
      const [saved] = await db.insert(lngIntel).values({
        clientId, category: item.category || "general", title: item.title,
        summary: item.summary || null, url: item.url || null, date: item.date || null,
      }).returning();
      res.json({ ok: true, item: saved });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/lng/intel/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      await db.delete(lngIntel).where(and(eq(lngIntel.id, id), eq(lngIntel.clientId, clientId)));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  log("LNG Relationship Intelligence Engine routes registered");
}
