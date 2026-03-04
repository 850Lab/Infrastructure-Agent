import { Router, Request, Response } from "express";
import {
  isOutscraperAvailable,
  fetchCompaniesWithoutWebsite,
  lookupAndUpdateWebsite,
  batchLookupWebsites,
} from "./outscraper";

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

function requireAuth(req: Request, res: Response, next: Function) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function registerOutscraperRoutes(app: Router) {
  app.get("/api/outscraper/status", async (_req: Request, res: Response) => {
    try {
      const companies = await fetchCompaniesWithoutWebsite();
      res.json({
        ok: true,
        outscraper: isOutscraperAvailable(),
        companiesWithoutWebsite: companies.length,
        companies: companies.map(c => ({
          recordId: c.recordId,
          companyName: c.companyName,
          city: c.city,
          state: c.state,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/outscraper/lookup-one", requireAuth, async (req: Request, res: Response) => {
    try {
      const { recordId, companyName, city, state } = req.body;
      if (!recordId || !companyName) {
        return res.status(400).json({ error: "recordId and companyName required" });
      }
      const result = await lookupAndUpdateWebsite(recordId, companyName, city || "", state || "");
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/outscraper/lookup-batch", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.body.limit) || 10, 50);
      const result = await batchLookupWebsites(limit);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/outscraper/lookup-then-enrich", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.body.limit) || 10, 50);
      const { enrichCompany, writeDMsToAirtable } = await import("./dm-enrichment");

      const lookupResult = await batchLookupWebsites(limit);

      const enrichResults: any[] = [];
      for (const lr of lookupResult.results) {
        if (lr.websiteFound && lr.recordId) {
          try {
            const enrichResult = await enrichCompany(lr.recordId);
            const written = await writeDMsToAirtable(enrichResult);
            enrichResults.push({
              companyName: lr.companyName,
              websiteFound: lr.websiteFound,
              dmsFound: enrichResult.decisionMakers.length,
              dmsWritten: written,
            });
          } catch (e: any) {
            enrichResults.push({
              companyName: lr.companyName,
              websiteFound: lr.websiteFound,
              error: e.message,
            });
          }
        }
      }

      res.json({
        ok: true,
        websiteLookup: {
          processed: lookupResult.processed,
          websitesFound: lookupResult.websitesFound,
        },
        enrichment: {
          companiesEnriched: enrichResults.length,
          results: enrichResults,
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
