import type { Express, Request, Response, NextFunction } from "express";
import { generateQueries, runOutscraper, enrichLeads, runFullPipeline, getLeadFeedStats } from "./lead-feed";
import { log } from "./index";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ ok: false, error: "Authorization header required" });

  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== apiKey) return res.status(403).json({ ok: false, error: "Invalid API key" });

  next();
}

export function registerLeadFeedRoutes(app: Express) {
  app.get("/api/lead-feed/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await getLeadFeedStats();
      res.json({ ok: true, ...stats });
    } catch (e: any) {
      log(`Lead feed stats failed: ${e.message}`, "lead-feed");
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/lead-feed/generate-queries", requireAuth, async (req: Request, res: Response) => {
    const count = Math.min(Number(req.body?.count) || 15, 50);
    try {
      const result = await generateQueries(count);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      log(`Generate queries failed: ${e.message}`, "lead-feed");
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/lead-feed/run-outscraper", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.body?.limit) || 5, 20);
    try {
      const result = await runOutscraper(limit);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      log(`Run outscraper failed: ${e.message}`, "lead-feed");
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/lead-feed/enrich", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.body?.limit) || 10, 50);
    try {
      const result = await enrichLeads(limit);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      log(`Enrich failed: ${e.message}`, "lead-feed");
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/lead-feed/run-all", requireAuth, async (req: Request, res: Response) => {
    const {
      queryCount = 15,
      queryLimit = 5,
      enrichLimit = 10,
      skipGenerate = false,
      skipOutscraper = false,
      skipEnrich = false,
    } = req.body || {};

    try {
      const result = await runFullPipeline({
        queryCount: Math.min(Number(queryCount), 50),
        queryLimit: Math.min(Number(queryLimit), 20),
        enrichLimit: Math.min(Number(enrichLimit), 50),
        skipGenerate: Boolean(skipGenerate),
        skipOutscraper: Boolean(skipOutscraper),
        skipEnrich: Boolean(skipEnrich),
      });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      log(`Full pipeline failed: ${e.message}`, "lead-feed");
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
