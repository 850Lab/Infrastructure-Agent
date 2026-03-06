import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { eventBus } from "./events";
import { startDailyRun, RunAlreadyActiveError } from "./run-daily-web";
import { getHistory, getRunById, getRunStatus, loadHistory, completeRun } from "./run-history";
import { computeMachineMetrics } from "./machine-metrics";
import { revertChangeset } from "./run-changeset";
import { getUserConfig, saveUserConfig, suggestMachineName, mapToIndustryConfig } from "./user-config";
import type { MachineConfig } from "./user-config";
import { computeDailyBriefing } from "./briefing";
import { computeOutcomes, computeConfidence } from "./outcomes";
import { computeDMAuthorityReport } from "./dm-authority-learning";
import { getQueryIntelSummary } from "./query-intel";
import { log } from "./logger";
import { authMiddleware, createToken, extractToken, getEmailFromToken, getTokenEntry, validateToken, verifyPassword, seedPlatformAdmin, getPermissions, requirePermission } from "./auth";
import { storage } from "./storage";
import { getTimeWeight, getSignalAge, getDecayConstant } from "./time-weight";

export { authMiddleware } from "./auth";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";

async function airtableCount(formula: string, clientId?: string): Promise<number | null> {
  try {
    let key: string, base: string;
    if (clientId) {
      const cfg = await getClientAirtableConfig(clientId);
      key = cfg.apiKey;
      base = cfg.baseId;
    } else {
      key = AIRTABLE_API_KEY();
      base = AIRTABLE_BASE_ID();
    }
    if (!key || !base) return null;

    const scopedFilter = clientId ? scopedFormula(clientId, formula) : formula;

    let count = 0;
    let offset: string | undefined;

    do {
      const params = new URLSearchParams({
        filterByFormula: scopedFilter,
        pageSize: "100",
        "fields[]": "Company",
      });
      if (offset) params.set("offset", offset);

      const resp = await fetch(
        `https://api.airtable.com/v0/${base}/Companies?${params}`,
        { headers: { Authorization: `Bearer ${key}` } }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      count += (data.records || []).length;
      offset = data.offset;
    } while (offset);

    return count;
  } catch {
    return null;
  }
}

export async function registerDashboardRoutes(app: Express): Promise<void> {
  await loadHistory().catch((e: any) => log(`Failed to load run history: ${e.message}`, "run-history"));
  await seedPlatformAdmin().catch((e: any) => log(`Failed to seed admin: ${e.message}`, "auth"));

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      const user = await storage.getUserByEmail(email.toLowerCase());
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const valid = await verifyPassword(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const tokenData = createToken(user.email, user.role, user.clientId);
      log(`Login successful for ${email} (role: ${user.role})`, "auth");
      return res.json(tokenData);
    } catch (err: any) {
      log(`Login error: ${err.message}`, "auth");
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/events", (req: Request, res: Response) => {
    const token = req.query.token as string | undefined;
    if (!token || !validateToken(token)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const tokenEntry = getTokenEntry(token);
    const clientId = tokenEntry?.clientId || null;
    const isPlatformAdmin = tokenEntry?.role === "platform_admin";
    const sinceSeq = parseInt(req.query.since_seq as string, 10) || 0;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const backfill = sinceSeq > 0
      ? eventBus.getEventsSince(sinceSeq, 50, isPlatformAdmin ? undefined : (clientId || undefined))
      : eventBus.getRecentEvents(50, isPlatformAdmin ? undefined : (clientId || undefined));

    for (const event of backfill) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    }

    const subId = eventBus.subscribe(res, clientId, isPlatformAdmin);

    const heartbeatInterval = setInterval(() => {
      try {
        eventBus.sendHeartbeatTo(res);
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeatInterval);
      eventBus.unsubscribe(subId);
    });
  });

  app.post("/api/run-daily", authMiddleware, (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const run_id = startDailyRun({ clientId });
      res.json({ run_id });
    } catch (err) {
      if (err instanceof RunAlreadyActiveError) {
        return res.status(409).json({ error: "RUN_ALREADY_ACTIVE" });
      }
      res.status(500).json({ error: "Failed to start run" });
    }
  });

  app.get("/api/run-history", authMiddleware, (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    res.json(getHistory(clientId));
  });

  app.get("/api/run-history/:run_id", authMiddleware, (req: Request, res: Response) => {
    const run = getRunById(req.params.run_id);
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }
    const clientId = (req as any).user?.clientId;
    if (clientId && run.clientId && run.clientId !== clientId) {
      return res.status(404).json({ error: "Run not found" });
    }
    res.json(run);
  });

  app.get("/api/run-latest-diff", authMiddleware, (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    const history = getHistory(clientId);
    const latest = history.find((r) => r.status !== "running" && r.summary?.diff);
    if (!latest) {
      return res.json({ run_id: null, diff: null, duration_ms: null });
    }
    res.json({
      run_id: latest.run_id,
      started_at: latest.started_at,
      finished_at: latest.finished_at,
      duration_ms: latest.duration_ms,
      status: latest.status,
      diff: latest.summary?.diff || null,
      errors_count: latest.errors?.length || 0,
    });
  });

  app.post("/api/run-history/:run_id/revert", authMiddleware, async (req: Request, res: Response) => {
    try {
      const run = getRunById(req.params.run_id);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const { categories } = req.body || {};
      if (!categories || !Array.isArray(categories) || categories.length === 0) {
        return res.status(400).json({ error: "categories array required (rank, offer_dm, playbooks)" });
      }

      const validCats = ["rank", "offer_dm", "playbooks"];
      const filteredCats = categories.filter((c: string) => validCats.includes(c));
      if (filteredCats.length === 0) {
        return res.status(400).json({ error: "No valid categories. Must be: rank, offer_dm, playbooks" });
      }

      const changeset = run.summary?.changeset;
      if (!changeset || !changeset.entries || changeset.entries.length === 0) {
        return res.status(400).json({ error: "No changeset available for this run" });
      }

      const alreadyReverted = new Set(changeset.reverted_categories || []);
      const newCats = filteredCats.filter((c: string) => !alreadyReverted.has(c));
      if (newCats.length === 0) {
        return res.status(400).json({
          error: "All requested categories already reverted",
          reverted_categories: Array.from(alreadyReverted),
        });
      }

      const result = await revertChangeset(changeset.entries, newCats);

      const allReverted = new Set([...alreadyReverted, ...newCats]);
      const allCatsInChangeset = new Set((changeset.entries || []).map((e: any) => e.category));
      const fullyReverted = [...allCatsInChangeset].every(c => allReverted.has(c));

      run.summary = {
        ...run.summary,
        changeset: {
          ...changeset,
          reverted: fullyReverted,
          reverted_at: new Date().toISOString(),
          reverted_categories: Array.from(allReverted),
        },
      };
      completeRun(run.run_id, {
        summary: run.summary,
        status: run.status as "completed" | "error",
      });

      res.json({
        success: true,
        reverted: result.reverted,
        skipped: result.skipped,
        categories: filteredCats,
        errors: result.errors,
      });
    } catch (err: any) {
      log(`Revert error: ${err.message}`, "revert");
      res.status(500).json({ error: "Revert failed", message: err.message });
    }
  });

  app.get("/api/run-status", authMiddleware, (_req: Request, res: Response) => {
    res.json(getRunStatus());
  });

  app.get("/api/machine-metrics", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const metrics = await computeMachineMetrics(clientId);
      res.json(metrics);
    } catch (err: any) {
      log(`Machine metrics error: ${err.message}`, "machine-metrics");
      res.json({
        companies_total: null,
        dms_total: null,
        calls_total: null,
        wins_total: null,
        opportunities_total: null,
        computed_at: Date.now(),
      });
    }
  });

  app.get("/api/me", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: "Invalid token" });
      }
      const { email, role, clientId } = user;

      let clientContext = null;
      if (clientId) {
        const client = await storage.getClient(clientId);
        if (client) {
          clientContext = {
            client_id: client.id,
            client_name: client.clientName,
            machine_name: client.machineName,
            industry_config: client.industryConfig,
            territory: client.territory,
            decision_maker_focus: client.decisionMakerFocus,
          };
        }
      }

      const config = await getUserConfig(email);
      const safeConfig = config ? {
        machine_name: config.machine_name,
        market: config.market,
        opportunity: config.opportunity,
        decision_maker_focus: config.decision_maker_focus,
        geo: config.geo,
        industry_config_selected: config.industry_config_selected,
      } : null;
      res.json({
        email,
        role,
        client_id: clientId,
        client: clientContext,
        machine_config: safeConfig,
        needsOnboarding: role !== "platform_admin" && !config,
        permissions: getPermissions(role),
      });
    } catch (err: any) {
      log(`/api/me error: ${err.message}`, "auth");
      res.status(500).json({ error: "Failed to load user profile" });
    }
  });

  app.post("/api/onboarding", authMiddleware, async (req: Request, res: Response) => {
    try {
      const token = extractToken(req);
      const email = token ? getEmailFromToken(token) : null;
      if (!email) {
        return res.status(401).json({ error: "Invalid token" });
      }

      const clientId = (req as any).user?.clientId;
      const { machine_name, market, opportunity, decision_maker_focus, geo } = req.body || {};

      if (!machine_name || !market || !opportunity || !decision_maker_focus || !geo) {
        return res.status(400).json({ error: "All fields are required" });
      }

      const industryConfig = mapToIndustryConfig(market);

      const config: MachineConfig = {
        email,
        machine_name,
        market,
        opportunity,
        decision_maker_focus,
        geo,
        industry_config_selected: industryConfig,
        created_at: Date.now(),
      };

      const saved = await saveUserConfig(config);

      if (clientId) {
        await storage.updateClient(clientId, {
          machineName: machine_name,
          industryConfig,
          territory: geo,
          decisionMakerFocus: decision_maker_focus,
        });
      }

      log(`Onboarding complete for ${email}: ${machine_name} (${industryConfig})`, "onboarding");
      res.json({ success: true, config: saved });
    } catch (err: any) {
      log(`Onboarding error: ${err.message}`, "onboarding");
      res.status(500).json({ error: "Failed to save configuration" });
    }
  });

  app.post("/api/onboarding/suggest-name", authMiddleware, (req: Request, res: Response) => {
    const { market, opportunity, geo } = req.body || {};
    const name = suggestMachineName(market || "", opportunity || "", geo || "");
    res.json({ suggested_name: name });
  });

  app.post("/api/onboarding/build", authMiddleware, (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const run_id = startDailyRun({ top: 10, bootstrap: true, clientId });
      log(`Onboarding build triggered: ${run_id}`, "onboarding");
      res.json({ run_id });
    } catch (err) {
      if (err instanceof RunAlreadyActiveError) {
        return res.status(409).json({ error: "RUN_ALREADY_ACTIVE" });
      }
      res.status(500).json({ error: "Failed to start build" });
    }
  });

  const ALLOWED_MARKETS = ["industrial", "saas", "real-estate", "agency", "custom"] as const;

  const machineSettingsSchema = z.object({
    machine_name: z.string().min(1).max(100).optional(),
    geo: z.string().min(1).max(200).optional(),
    decision_maker_focus: z.string().min(1).max(200).optional(),
    opportunity: z.string().min(1).max(200).optional(),
    market: z.enum(ALLOWED_MARKETS).optional(),
  });

  app.patch("/api/machine-settings", authMiddleware, requirePermission("edit_settings"), async (req: Request, res: Response) => {
    try {
      const token = extractToken(req);
      const email = token ? getEmailFromToken(token) : null;
      if (!email) {
        return res.status(401).json({ error: "Invalid token" });
      }

      const parsed = machineSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      }

      const existing = await getUserConfig(email);
      if (!existing) {
        return res.status(404).json({ error: "No machine config found. Complete onboarding first." });
      }

      const { machine_name, geo, decision_maker_focus, market, opportunity } = parsed.data;
      const marketChanged = market && market !== existing.market;

      const updated: MachineConfig = {
        ...existing,
        machine_name: machine_name ?? existing.machine_name,
        geo: geo ?? existing.geo,
        decision_maker_focus: decision_maker_focus ?? existing.decision_maker_focus,
        opportunity: opportunity ?? existing.opportunity,
      };

      if (marketChanged) {
        updated.market = market!;
        updated.industry_config_selected = mapToIndustryConfig(market!);
      }

      const saved = await saveUserConfig(updated);
      log(`Machine settings updated for ${email}: ${saved.machine_name}`, "settings");
      res.json({ success: true, config: saved, industry_changed: !!marketChanged });
    } catch (err: any) {
      log(`Machine settings update error: ${err.message}`, "settings");
      res.status(500).json({ error: "Failed to update machine settings" });
    }
  });

  app.get("/api/dashboard/stats", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const [today_list_count, dm_resolved_count, playbooks_ready_count, fresh_pool_count] = await Promise.all([
        airtableCount("{Today_Call_List}=TRUE()", clientId),
        airtableCount("AND({Today_Call_List}=TRUE(),{Offer_DM_Name}!='')", clientId),
        airtableCount("AND({Today_Call_List}=TRUE(),{Playbook_Version}!='')", clientId),
        airtableCount("OR({Times_Called}=0,{Lead_Status}='New')", clientId),
      ]);

      const history = getHistory(clientId);
      const lastRun = history.length > 0 ? history[0] : null;

      res.json({
        today_list_count,
        fresh_pool_count,
        dm_resolved_count,
        playbooks_ready_count,
        last_run_status: lastRun?.status ?? null,
        last_run_id: lastRun?.run_id ?? null,
        last_run_time: lastRun?.started_at ?? null,
      });
    } catch (err: any) {
      log(`Dashboard stats error: ${err.message}`, "dashboard");
      res.json({
        today_list_count: null,
        fresh_pool_count: null,
        dm_resolved_count: null,
        playbooks_ready_count: null,
        last_run_status: null,
        last_run_id: null,
        last_run_time: null,
      });
    }
  });

  app.get("/api/briefing", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const briefing = await computeDailyBriefing(clientId);
      res.json(briefing);
    } catch (err: any) {
      log(`Briefing error: ${err.message}`, "briefing");
      res.status(500).json({ error: "Failed to compute briefing" });
    }
  });

  app.post("/api/action/run-pipeline", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const run_id = startDailyRun({ top: 10, clientId });
      res.json({ run_id, status: "started" });
    } catch (err: any) {
      if (err instanceof RunAlreadyActiveError) {
        res.status(409).json({ error: "Pipeline is already running" });
      } else {
        log(`Run-pipeline action error: ${err.message}`, "briefing");
        res.status(500).json({ error: "Failed to start pipeline" });
      }
    }
  });

  app.post("/api/action/enrich-dms", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const run_id = startDailyRun({ top: 10, clientId });
      res.json({ run_id, status: "started", note: "Pipeline will enrich DMs as part of its run." });
    } catch (err: any) {
      if (err instanceof RunAlreadyActiveError) {
        res.status(409).json({ error: "Pipeline is already running" });
      } else {
        log(`Enrich-dms action error: ${err.message}`, "briefing");
        res.status(500).json({ error: "Failed to start enrichment" });
      }
    }
  });

  app.post("/api/action/open-company/:id", authMiddleware, async (req: Request, res: Response) => {
    const { id } = req.params;
    res.json({ company_id: id, message: "Company detail navigation ready." });
  });

  app.get("/api/outcomes", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const range = String(req.query.range || "7d");
      if (range !== "7d" && range !== "30d") {
        return res.status(400).json({ error: "range must be 7d or 30d" });
      }
      const outcomes = await computeOutcomes(range, clientId);
      res.json(outcomes);
    } catch (err: any) {
      log(`Outcomes error: ${err.message}`, "outcomes");
      res.status(500).json({ error: "Failed to compute outcomes" });
    }
  });

  app.get("/api/confidence", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const confidence = await computeConfidence(clientId);
      res.json(confidence);
    } catch (err: any) {
      log(`Confidence error: ${err.message}`, "outcomes");
      res.status(500).json({ error: "Failed to compute confidence" });
    }
  });

  app.get("/api/dm-authority/report", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const report = await computeDMAuthorityReport(clientId);
      res.json(report);
    } catch (err: any) {
      log(`DM authority report error: ${err.message}`, "dm-authority");
      res.status(500).json({ error: "Failed to compute DM authority report" });
    }
  });

  app.get("/api/query-intel/summary", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const summary = await getQueryIntelSummary(clientId);
      res.json(summary);
    } catch (err: any) {
      log(`Query intel summary error: ${err.message}`, "query-intel");
      res.status(500).json({ error: "Failed to compute query intel summary" });
    }
  });

  app.get("/api/query-performance", authMiddleware, async (req: Request, res: Response) => {
    try {
      const perms = getPermissions(req);
      const clientId = perms?.clientId;

      let key: string, base: string;
      if (clientId) {
        const cfg = await getClientAirtableConfig(clientId);
        key = cfg.apiKey;
        base = cfg.baseId;
      } else {
        key = AIRTABLE_API_KEY();
        base = AIRTABLE_BASE_ID();
      }
      if (!key || !base) {
        return res.json({ ColdStart: null, QueryIntel: null, WinPattern: null, hasData: false });
      }

      const modes = ["ColdStart", "QueryIntel", "WinPattern"] as const;
      const result: Record<string, { leads: number; dm_found: number; dm_rate: number; positive_calls: number; positive_call_rate: number; opportunities: number; opportunity_rate: number } | null> = {};

      for (const mode of modes) {
        const baseFormula = `{Source_Query_Mode} = '${mode}'`;
        const filter = clientId ? scopedFormula(clientId, baseFormula) : baseFormula;
        const fields = ["Source_Query_Mode", "DM_Coverage_Status", "Last_Outcome", "Lead_Status", "Win_Flag"].map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

        let records: any[] = [];
        let offset: string | undefined;

        do {
          const params = new URLSearchParams({ filterByFormula: filter, pageSize: "100" });
          if (offset) params.set("offset", offset);

          const resp = await fetch(
            `https://api.airtable.com/v0/${base}/Companies?${params}&${fields}`,
            { headers: { Authorization: `Bearer ${key}` } }
          );
          if (!resp.ok) break;
          const data = await resp.json();
          records = records.concat(data.records || []);
          offset = data.offset;
        } while (offset);

        if (records.length === 0) {
          result[mode] = null;
          continue;
        }

        const leads = records.length;
        const dmFound = records.filter((r: any) => r.fields.DM_Coverage_Status === "Ready").length;
        const positiveCalls = records.filter((r: any) => {
          const outcome = r.fields.Last_Outcome;
          return outcome === "Decision Maker" || outcome === "Qualified" || outcome === "Callback" || outcome === "Won";
        }).length;
        const opportunities = records.filter((r: any) => {
          return r.fields.Lead_Status === "Won" || r.fields.Win_Flag === true;
        }).length;

        result[mode] = {
          leads,
          dm_found: dmFound,
          dm_rate: leads > 0 ? Math.round((dmFound / leads) * 100) : 0,
          positive_calls: positiveCalls,
          positive_call_rate: leads > 0 ? Math.round((positiveCalls / leads) * 100) : 0,
          opportunities,
          opportunity_rate: leads > 0 ? Math.round((opportunities / leads) * 100) : 0,
        };
      }

      const hasData = Object.values(result).some(v => v !== null);
      res.json({ ...result, hasData });
    } catch (err: any) {
      log(`Query performance error: ${err.message}`, "analytics");
      res.status(500).json({ error: "Failed to compute query performance" });
    }
  });

  app.get("/api/analytics/authority-miss-rate", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;

      const missFormula = `AND({Authority_Miss_Count}>0,{Times_Called}>0)`;
      const totalFormula = `{Times_Called}>0`;

      const [missCount, totalCount] = await Promise.all([
        airtableCount(missFormula, clientId),
        airtableCount(totalFormula, clientId),
      ]);

      if (missCount === null || totalCount === null || totalCount === 0) {
        return res.json({ missCount: 0, totalContacted: 0, missRate: 0, hasData: false });
      }

      const missRate = Math.round((missCount / totalCount) * 100);

      res.json({
        missCount,
        totalContacted: totalCount,
        missRate,
        hasData: true,
      });
    } catch (err: any) {
      log(`Authority miss rate error: ${err.message}`, "analytics");
      res.status(500).json({ error: "Failed to compute authority miss rate" });
    }
  });

  app.get("/api/analytics/weighted-signals", authMiddleware, async (req: Request, res: Response) => {
    try {
      const perms = getPermissions(req);
      const clientId = perms?.clientId;

      let key: string, base: string;
      if (clientId) {
        const cfg = await getClientAirtableConfig(clientId);
        key = cfg.apiKey;
        base = cfg.baseId;
      } else {
        key = AIRTABLE_API_KEY();
        base = AIRTABLE_BASE_ID();
      }
      if (!key || !base) {
        return res.json({ hasData: false });
      }

      const formula = clientId
        ? scopedFormula(clientId, "{Times_Called}>0")
        : "{Times_Called}>0";
      const fields = ["First_Seen", "Engagement_Score", "Last_Outcome", "Lead_Status", "Win_Flag"]
        .map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

      let records: any[] = [];
      let offset: string | undefined;

      do {
        const params = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
        if (offset) params.set("offset", offset);
        const resp = await fetch(
          `https://api.airtable.com/v0/${base}/Companies?${params}&${fields}`,
          { headers: { Authorization: `Bearer ${key}` } }
        );
        if (!resp.ok) break;
        const data = await resp.json();
        records = records.concat(data.records || []);
        offset = data.offset;
      } while (offset);

      if (records.length === 0) {
        return res.json({ hasData: false });
      }

      let recentWeightedSum = 0;
      let historicalWeightedSum = 0;
      let recentCount = 0;
      let midCount = 0;
      let historicalCount = 0;

      const decayConstant = getDecayConstant();

      for (const rec of records) {
        const f = rec.fields;
        const firstSeen = f.First_Seen || null;
        const engagement = parseInt(f.Engagement_Score || "0", 10) || 0;
        const age = getSignalAge(firstSeen);
        const weight = getTimeWeight(firstSeen, decayConstant);

        const signalStrength = Math.max(1, engagement);
        const weightedSignal = signalStrength * weight;

        if (age === "recent") {
          recentCount++;
          recentWeightedSum += weightedSignal;
        } else if (age === "mid") {
          midCount++;
          historicalWeightedSum += weightedSignal;
        } else {
          historicalCount++;
          historicalWeightedSum += weightedSignal;
        }
      }

      const totalWeighted = recentWeightedSum + historicalWeightedSum;
      const recentPct = totalWeighted > 0 ? Math.round((recentWeightedSum / totalWeighted) * 100) : 0;
      const historicalPct = totalWeighted > 0 ? Math.round((historicalWeightedSum / totalWeighted) * 100) : 0;

      res.json({
        hasData: true,
        recentSignals: recentCount,
        historicalSignals: midCount + historicalCount,
        totalSignals: records.length,
        recentWeightPct: recentPct,
        historicalWeightPct: historicalPct,
        decayConstant,
      });
    } catch (err: any) {
      log(`Weighted signals error: ${err.message}`, "analytics");
      res.status(500).json({ error: "Failed to compute weighted signals" });
    }
  });
}
