import type { Express, Request, Response } from "express";
import {
  generateAllQueries,
  writeQueriesToAirtable,
  scoreCompanyWebsite,
  updateCompanyScore,
  fetchCompaniesForScoring,
  fetchHighScoreCompanies,
  disableLowScoreQueries,
  getGeos,
  getKeywords,
} from "./active-work";
import { log } from "./index";

export function registerActiveWorkRoutes(app: Express) {
  app.get("/api/active-work/config", (_req: Request, res: Response) => {
    res.json({
      geos: getGeos(),
      keywords: getKeywords(),
      totalPossibleQueries: getGeos().length * getKeywords().length,
    });
  });

  app.post("/api/active-work/generate-queries", async (req: Request, res: Response) => {
    const dryRun = req.query.dryRun === "true" || req.body?.dryRun === true;

    try {
      const queries = generateAllQueries();

      if (dryRun) {
        res.json({
          dryRun: true,
          totalQueries: queries.length,
          geos: getGeos().length,
          keywords: getKeywords().length,
          sample: queries.slice(0, 10),
          queries,
        });
        return;
      }

      const written = await writeQueriesToAirtable(queries);
      res.json({
        dryRun: false,
        totalQueries: queries.length,
        writtenToAirtable: written,
      });
    } catch (e: any) {
      log(`Generate queries failed: ${e.message}`, "active-work");
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/active-work/score-company", async (req: Request, res: Response) => {
    const { url, companyName, recordId } = req.body;

    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    try {
      const score = await scoreCompanyWebsite(url, companyName);

      if (recordId) {
        await updateCompanyScore(recordId, score);
      }

      res.json({ url, companyName, recordId, ...score });
    } catch (e: any) {
      log(`Score company failed: ${e.message}`, "active-work");
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/active-work/score-batch", async (req: Request, res: Response) => {
    const { limit = 20, dryRun = false } = req.body || {};

    try {
      const companies = await fetchCompaniesForScoring(limit);

      if (dryRun) {
        res.json({
          dryRun: true,
          companiesFound: companies.length,
          companies: companies.map(c => ({ id: c.id, name: c.name, website: c.website })),
        });
        return;
      }

      const results: Array<{ id: string; name: string; website: string; score: number; reasoning: string }> = [];

      for (const company of companies) {
        try {
          const score = await scoreCompanyWebsite(company.website, company.name);
          await updateCompanyScore(company.id, score);
          results.push({
            id: company.id,
            name: company.name,
            website: company.website,
            score: score.score,
            reasoning: score.reasoning,
          });
          log(`Scored ${company.name}: ${score.score}`, "active-work");
        } catch (e: any) {
          log(`Failed to score ${company.name}: ${e.message}`, "active-work");
          results.push({
            id: company.id,
            name: company.name,
            website: company.website,
            score: 0,
            reasoning: `Error: ${e.message}`,
          });
        }
      }

      res.json({
        dryRun: false,
        scored: results.length,
        results: results.sort((a, b) => b.score - a.score),
      });
    } catch (e: any) {
      log(`Batch scoring failed: ${e.message}`, "active-work");
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/active-work/high-score", async (_req: Request, res: Response) => {
    try {
      const records = await fetchHighScoreCompanies();
      res.json({
        count: records.length,
        companies: records.map((r: any) => ({
          id: r.id,
          name: r.fields.name || r.fields.Name || r.fields.company_name || "",
          phone: r.fields.phone || r.fields.Phone || "",
          website: r.fields.website || r.fields.Website || "",
          score: r.fields.Active_Work_Score,
          reasoning: r.fields.score_reasoning || "",
          city: r.fields.city || r.fields.City || "",
          state: r.fields.state || r.fields.State || "",
        })),
      });
    } catch (e: any) {
      log(`Fetch high score failed: ${e.message}`, "active-work");
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/active-work/rotate-queries", async (_req: Request, res: Response) => {
    try {
      const result = await disableLowScoreQueries();
      res.json(result);
    } catch (e: any) {
      log(`Rotate queries failed: ${e.message}`, "active-work");
      res.status(500).json({ error: e.message });
    }
  });
}
