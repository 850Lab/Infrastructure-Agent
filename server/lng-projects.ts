import { Express, Request, Response } from "express";
import OpenAI from "openai";
import { db } from "./db";
import { lngProjects, lngContacts, lngIntel } from "@shared/schema";
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

async function fetchPage(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; IntelBot/1.0)" },
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

interface LngSearchResult {
  projects: Array<{
    projectName: string;
    operator: string;
    location: string;
    state: string;
    status: string;
    capacity: string;
    estimatedValue: string;
    description: string;
    contractors: string;
    timeline: string;
    source: string;
    sourceUrl: string;
  }>;
  contacts: Array<{
    fullName: string;
    title: string;
    company: string;
    email: string;
    phone: string;
    linkedin: string;
    projectName: string;
    source: string;
  }>;
  intel: Array<{
    category: string;
    title: string;
    summary: string;
    url: string;
    date: string;
    projectName: string;
  }>;
}

async function searchAndAnalyzeLng(query: string): Promise<LngSearchResult> {
  log(`Searching: ${query}`);

  const googleResults = await searchGoogle(query);
  log(`Found ${googleResults.length} Google results`);

  let pageContents = "";
  const crawlPromises = googleResults.slice(0, 5).map(async (r) => {
    if (!r.link) return "";
    const content = await fetchPage(r.link);
    return content ? `\n--- Source: ${r.title} (${r.link}) ---\n${content.slice(0, 5000)}\n` : "";
  });
  const crawled = await Promise.all(crawlPromises);
  pageContents = crawled.join("");

  const searchContext = googleResults.map(r => `- ${r.title}: ${r.snippet} (${r.link})`).join("\n");

  const prompt = `You are an LNG (Liquefied Natural Gas) industry intelligence analyst. Analyze the following search results and web content to extract detailed information about LNG projects, key people/decision makers, and relevant intelligence.

SEARCH QUERY: "${query}"

SEARCH RESULTS:
${searchContext}

WEB PAGE CONTENT:
${pageContents.slice(0, 30000)}

Extract and return a JSON object with three arrays:

1. "projects" - LNG projects found (each with: projectName, operator, location, state, status, capacity, estimatedValue, description, contractors, timeline, source, sourceUrl)
2. "contacts" - Key people/decision makers at LNG-related companies (each with: fullName, title, company, email, phone, linkedin, projectName, source)
   - Include executives, project managers, engineers, operations directors, procurement heads
   - Look for anyone who makes decisions about contractor services, equipment, cooling, safety
3. "intel" - Relevant intelligence items (each with: category, title, summary, url, date, projectName)
   - Categories: "hiring" (job postings), "press_release", "event", "regulatory", "construction_update", "social_media", "contract_award", "partnership"
   - Include industry events, conferences, and trade shows where LNG people gather
   - Include events by associated organizations (not just LNG companies directly)

Be thorough. Extract every project, person, and intelligence item you can find. For contacts, aggressively look for names and titles from company websites, LinkedIn mentions, press releases, and news articles.

Return ONLY valid JSON, no markdown formatting.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      projects: parsed.projects || [],
      contacts: parsed.contacts || [],
      intel: parsed.intel || [],
    };
  } catch (err: any) {
    log(`OpenAI analysis error: ${err.message}`);
    return { projects: [], contacts: [], intel: [] };
  }
}

export function registerLngRoutes(app: Express, authMiddleware: any) {
  app.post("/api/lng/search", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ error: "Search query required" });

      log(`Search request: "${query}"`);

      const predefinedQueries = [
        query,
        `${query} decision makers executives leadership`,
        `${query} hiring jobs careers`,
        `${query} press release news 2025 2026`,
        `${query} conference event trade show`,
      ];

      const allResults: LngSearchResult = { projects: [], contacts: [], intel: [] };

      for (const q of predefinedQueries) {
        const result = await searchAndAnalyzeLng(q);
        allResults.projects.push(...result.projects);
        allResults.contacts.push(...result.contacts);
        allResults.intel.push(...result.intel);
      }

      const uniqueProjects = allResults.projects.filter((p, i, arr) =>
        arr.findIndex(x => x.projectName.toLowerCase() === p.projectName.toLowerCase()) === i
      );
      const uniqueContacts = allResults.contacts.filter((c, i, arr) =>
        arr.findIndex(x => x.fullName.toLowerCase() === c.fullName.toLowerCase() && x.company?.toLowerCase() === c.company?.toLowerCase()) === i
      );
      const uniqueIntel = allResults.intel.filter((item, i, arr) =>
        arr.findIndex(x => x.title.toLowerCase() === item.title.toLowerCase()) === i
      );

      log(`Search complete: ${uniqueProjects.length} projects, ${uniqueContacts.length} contacts, ${uniqueIntel.length} intel items`);

      res.json({
        projects: uniqueProjects,
        contacts: uniqueContacts,
        intel: uniqueIntel,
        query,
      });
    } catch (err: any) {
      log(`Search error: ${err.message}`);
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
        clientId,
        projectName: project.projectName,
        operator: project.operator || null,
        location: project.location || null,
        state: project.state || null,
        status: project.status || null,
        capacity: project.capacity || null,
        estimatedValue: project.estimatedValue || null,
        description: project.description || null,
        contractors: project.contractors || null,
        timeline: project.timeline || null,
        source: project.source || null,
        sourceUrl: project.sourceUrl || null,
      }).returning();

      log(`Saved project: ${project.projectName} (id=${saved.id})`);
      res.json({ ok: true, project: saved });
    } catch (err: any) {
      log(`Save project error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lng/contacts/save", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });

      const { contact } = req.body;
      if (!contact?.fullName) return res.status(400).json({ error: "Contact name required" });

      const [saved] = await db.insert(lngContacts).values({
        clientId,
        projectId: contact.projectId || null,
        fullName: contact.fullName,
        title: contact.title || null,
        company: contact.company || null,
        email: contact.email || null,
        phone: contact.phone || null,
        linkedin: contact.linkedin || null,
        source: contact.source || null,
        notes: contact.notes || null,
      }).returning();

      log(`Saved contact: ${contact.fullName} (id=${saved.id})`);
      res.json({ ok: true, contact: saved });
    } catch (err: any) {
      log(`Save contact error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lng/intel/save", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });

      const { item } = req.body;
      if (!item?.title) return res.status(400).json({ error: "Intel title required" });

      const [saved] = await db.insert(lngIntel).values({
        clientId,
        projectId: item.projectId || null,
        category: item.category || "general",
        title: item.title,
        summary: item.summary || null,
        url: item.url || null,
        date: item.date || null,
      }).returning();

      log(`Saved intel: ${item.title} (id=${saved.id})`);
      res.json({ ok: true, item: saved });
    } catch (err: any) {
      log(`Save intel error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/lng/projects", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });

      const projects = await db.select().from(lngProjects)
        .where(eq(lngProjects.clientId, clientId))
        .orderBy(desc(lngProjects.savedAt));

      res.json(projects);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/lng/contacts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });

      const projectId = req.query.projectId ? Number(req.query.projectId) : null;

      let contacts;
      if (projectId) {
        contacts = await db.select().from(lngContacts)
          .where(and(eq(lngContacts.clientId, clientId), eq(lngContacts.projectId, projectId)))
          .orderBy(desc(lngContacts.savedAt));
      } else {
        contacts = await db.select().from(lngContacts)
          .where(eq(lngContacts.clientId, clientId))
          .orderBy(desc(lngContacts.savedAt));
      }

      res.json(contacts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/lng/intel", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(401).json({ error: "No client context" });

      const projectId = req.query.projectId ? Number(req.query.projectId) : null;
      const category = req.query.category as string | undefined;

      let items;
      const conditions = [eq(lngIntel.clientId, clientId)];
      if (projectId) conditions.push(eq(lngIntel.projectId, projectId));
      if (category) conditions.push(eq(lngIntel.category, category));

      items = await db.select().from(lngIntel)
        .where(and(...conditions))
        .orderBy(desc(lngIntel.savedAt));

      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/lng/projects/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      await db.delete(lngProjects).where(and(eq(lngProjects.id, id), eq(lngProjects.clientId, clientId)));
      await db.delete(lngContacts).where(and(eq(lngContacts.projectId, id), eq(lngContacts.clientId, clientId)));
      await db.delete(lngIntel).where(and(eq(lngIntel.projectId, id), eq(lngIntel.clientId, clientId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/lng/contacts/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      await db.delete(lngContacts).where(and(eq(lngContacts.id, id), eq(lngContacts.clientId, clientId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/lng/intel/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      await db.delete(lngIntel).where(and(eq(lngIntel.id, id), eq(lngIntel.clientId, clientId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/lng/projects/:id/notes", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = Number(req.params.id);
      const { notes } = req.body;

      const [updated] = await db.update(lngProjects)
        .set({ notes, updatedAt: new Date() })
        .where(and(eq(lngProjects.id, id), eq(lngProjects.clientId, clientId)))
        .returning();

      res.json({ ok: true, project: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  log("LNG Projects routes registered");
}
