import type { Express, Request, Response, NextFunction } from "express";
import { enrichCompany, writeDMsToAirtable, fetchCompaniesForEnrichment, batchEnrich, getEnrichmentStats } from "./dm-enrichment";
import { isApolloAvailable } from "./apollo";
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

export function registerDMRoutes(app: Express) {
  app.get("/api/enrichment/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await getEnrichmentStats();
      res.json({ ok: true, apollo: isApolloAvailable(), ...stats });
    } catch (e: any) {
      log(`Stats failed: ${e.message}`, "dm-enrich");
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/enrichment/preview", async (req: Request, res: Response) => {
    const limit = parseInt(String(req.query.limit || "10"), 10);
    try {
      const companies = await fetchCompaniesForEnrichment(limit);
      res.json({ ok: true, count: companies.length, companies });
    } catch (e: any) {
      log(`Preview failed: ${e.message}`, "dm-enrich");
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/enrichment/enrich-one", requireAuth, async (req: Request, res: Response) => {
    const { recordId } = req.body;
    if (!recordId) return res.status(400).json({ ok: false, error: "recordId is required" });

    try {
      const result = await enrichCompany(recordId);
      const written = await writeDMsToAirtable(result);

      res.json({
        ok: true,
        companyName: result.companyName,
        domain: result.domain,
        pagesScanned: result.pagesScanned,
        decisionMakersFound: result.decisionMakers.length,
        writtenToAirtable: written,
        apolloData: result.apolloData,
        decisionMakers: result.decisionMakers,
        error: result.error,
      });
    } catch (e: any) {
      log(`Enrich one failed: ${e.message}`, "dm-enrich");
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/enrichment/enrich-batch", requireAuth, async (req: Request, res: Response) => {
    const { limit = 10, dryRun = false } = req.body || {};

    try {
      if (dryRun) {
        const companies = await fetchCompaniesForEnrichment(limit);
        return res.json({
          ok: true,
          dryRun: true,
          companiesFound: companies.length,
          companies,
        });
      }

      const { results, totalDMs, companiesProcessed } = await batchEnrich(limit);

      res.json({
        ok: true,
        dryRun: false,
        companiesProcessed,
        totalDMsFound: totalDMs,
        results: results.map(r => ({
          companyName: r.companyName,
          domain: r.domain,
          dmsFound: r.decisionMakers.length,
          pagesScanned: r.pagesScanned,
          apolloData: r.apolloData ? { employees: r.apolloData.estimated_employees, industry: r.apolloData.industry } : null,
          error: r.error,
        })),
      });
    } catch (e: any) {
      log(`Batch enrich failed: ${e.message}`, "dm-enrich");
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
