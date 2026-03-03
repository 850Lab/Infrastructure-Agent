import type { Express, Request, Response, NextFunction } from "express";
import { fetchCandidates, rankAndSelect, buildCallPack, pushToCallCenter, tagAirtableRecords } from "./foreman";
import { log } from "./index";

function requireInternalAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ ok: false, error: "Authorization header required" });
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== apiKey) {
    return res.status(403).json({ ok: false, error: "Invalid API key" });
  }

  next();
}

export function registerForemanRoutes(app: Express) {
  app.get("/api/foreman/call-pack/preview", async (req: Request, res: Response) => {
    const count = parseInt(String(req.query.count || "20"), 10);
    const minEmployee = parseInt(String(req.query.min_employee || "0"), 10);
    const geo = String(req.query.geo || "gulf_coast");
    const mode = String(req.query.mode || "blind_mobilization");

    try {
      const candidates = await fetchCandidates();
      const { selected, filtered } = rankAndSelect(candidates, count, minEmployee, geo);
      const callPack = buildCallPack(selected, mode);

      res.json({
        ok: true,
        preview: true,
        totalCandidates: candidates.length,
        eligibleCandidates: filtered,
        selectedCount: selected.length,
        callPack,
      });
    } catch (e: any) {
      log(`Preview failed: ${e.message}`, "foreman");
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/foreman/call-pack/generate", requireInternalAuth, async (req: Request, res: Response) => {
    const { count = 20, min_employee = 0, geo = "gulf_coast", mode = "blind_mobilization" } = req.body || {};

    try {
      const candidates = await fetchCandidates();
      const { selected, filtered } = rankAndSelect(candidates, count, min_employee, geo);
      const callPack = buildCallPack(selected, mode);

      log(`Generated call pack: ${selected.length} leads from ${filtered} eligible`, "foreman");

      let pushed = false;
      let pushError: string | null = null;

      try {
        const pushResult = await pushToCallCenter(callPack);
        pushed = pushResult.ok;
        if (!pushResult.ok) {
          pushError = `CallCenter returned ${pushResult.status}: ${JSON.stringify(pushResult.body)}`;
          log(`Push failed: ${pushError}`, "foreman");
        }
      } catch (e: any) {
        pushError = e.message;
        log(`Push error: ${e.message}`, "foreman");
      }

      res.json({
        ok: true,
        pushed,
        pushError,
        count: selected.length,
        preview: callPack.leads.slice(0, 3),
        totalCandidates: candidates.length,
        eligibleCandidates: filtered,
      });
    } catch (e: any) {
      log(`Generate failed: ${e.message}`, "foreman");
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/foreman/call-pack/generate-and-tag", requireInternalAuth, async (req: Request, res: Response) => {
    const { count = 20, min_employee = 0, geo = "gulf_coast", mode = "blind_mobilization" } = req.body || {};

    try {
      const candidates = await fetchCandidates();
      const { selected, filtered } = rankAndSelect(candidates, count, min_employee, geo);
      const callPack = buildCallPack(selected, mode);

      log(`Generated call pack with tagging: ${selected.length} leads`, "foreman");

      let pushed = false;
      let pushError: string | null = null;

      try {
        const pushResult = await pushToCallCenter(callPack);
        pushed = pushResult.ok;
        if (!pushResult.ok) {
          pushError = `CallCenter returned ${pushResult.status}: ${JSON.stringify(pushResult.body)}`;
        }
      } catch (e: any) {
        pushError = e.message;
        log(`Push error: ${e.message}`, "foreman");
      }

      let tagged = 0;
      if (pushed) {
        tagged = await tagAirtableRecords(selected);
      } else {
        log("Skipping Airtable tagging because push failed", "foreman");
      }

      res.json({
        ok: true,
        pushed,
        pushError,
        tagged,
        count: selected.length,
        preview: callPack.leads.slice(0, 3),
        totalCandidates: candidates.length,
        eligibleCandidates: filtered,
      });
    } catch (e: any) {
      log(`Generate-and-tag failed: ${e.message}`, "foreman");
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
