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
import { db } from "./db";
import { manualLeads, clients, companyFlows, flowAttempts, actionQueue } from "@shared/schema";
import { eq, and, gte, lte, inArray, sql, desc } from "drizzle-orm";
import { authMiddleware, createToken, extractToken, getEmailFromToken, getTokenEntry, validateToken, verifyPassword, seedPlatformAdmin, getPermissions, requirePermission } from "./auth";
import { enrichCompany, writeDMsToAirtable } from "./dm-enrichment";
import { gatherCompanyIntel } from "./web-intel";
import { storage } from "./storage";
import { getTimeWeight, getSignalAge, getDecayConstant } from "./time-weight";

export { authMiddleware } from "./auth";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

import { scopedFormula, getClientAirtableConfig } from "./airtable-scoped";

async function airtableCountFetch(url: string, headers: Record<string, string>, retries = 3): Promise<Response | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(url, { headers });
    if (resp.ok) return resp;
    if (resp.status === 429 && attempt < retries - 1) {
      const wait = Math.pow(2, attempt + 1) * 1000;
      log(`Airtable rate limited (429), retrying in ${wait}ms...`, "dashboard");
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    const body = await resp.text().catch(() => "");
    log(`Airtable count failed: ${resp.status} | ${body.slice(0, 200)}`, "dashboard");
    return null;
  }
  return null;
}

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
    if (!key || !base) {
      log(`Airtable count skipped: missing key or base`, "dashboard");
      return null;
    }

    const scopedFilter = clientId ? scopedFormula(clientId, formula) : formula;

    let count = 0;
    let offset: string | undefined;

    do {
      const params = new URLSearchParams({
        filterByFormula: scopedFilter,
        pageSize: "100",
        "fields[]": "company_name",
      });
      if (offset) params.set("offset", offset);

      const resp = await airtableCountFetch(
        `https://api.airtable.com/v0/${base}/Companies?${params}`,
        { Authorization: `Bearer ${key}` }
      );
      if (!resp) return null;
      const data = await resp.json();
      count += (data.records || []).length;
      offset = data.offset;
    } while (offset);

    return count;
  } catch (err: any) {
    log(`Airtable count error: ${err.message}`, "dashboard");
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

  app.get("/api/coaching/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.json({ coachingEnabled: true });
      const [client] = await db.select({ coachingEnabled: clients.coachingEnabled }).from(clients).where(eq(clients.id, clientId)).limit(1);
      res.json({ coachingEnabled: client?.coachingEnabled ?? true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/coaching/status", authMiddleware, requirePermission("edit_settings"), async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(400).json({ error: "No client context" });
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") return res.status(400).json({ error: "'enabled' must be a boolean" });
      await db.update(clients).set({ coachingEnabled: enabled }).where(eq(clients.id, clientId));
      log(`Coaching ${enabled ? "enabled" : "disabled"} for client ${clientId}`, "settings");
      res.json({ success: true, coachingEnabled: enabled });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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

      let history = getHistory(clientId);
      if (history.length === 0 && clientId) {
        history = getHistory(clientId, true);
      }
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

  app.get("/api/authority-trends", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const trends = await storage.getAuthorityTrends(clientId);
      res.json({ trends });
    } catch (err: any) {
      log(`Authority trends error: ${err.message}`, "dm-authority");
      res.status(500).json({ error: "Failed to load authority trends" });
    }
  });

  app.post("/api/recovery/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      let clientId = (req as any).user?.clientId;
      if (!clientId) {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const { runRecoveryEngine } = await import("./recovery-engine");
      const result = await runRecoveryEngine(clientId);
      res.json(result);
    } catch (err: any) {
      log(`Recovery engine run error: ${err.message}`, "recovery-engine");
      res.status(500).json({ error: "Failed to run recovery engine" });
    }
  });

  app.get("/api/recovery/queue", authMiddleware, async (req: Request, res: Response) => {
    try {
      let clientId = (req as any).user?.clientId;
      if (!clientId) {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const activeOnly = req.query.active !== "false";
      const queue = await storage.getRecoveryQueue(clientId, activeOnly);
      const stats = {
        total: queue.length,
        byPriority: {} as Record<string, number>,
        byStatus: {} as Record<string, number>,
        dueNow: 0,
      };
      const now = new Date();
      for (const item of queue) {
        stats.byPriority[item.priority] = (stats.byPriority[item.priority] || 0) + 1;
        stats.byStatus[item.dmStatus] = (stats.byStatus[item.dmStatus] || 0) + 1;
        if (new Date(item.nextAttempt) <= now) stats.dueNow++;
      }
      res.json({ stats, items: queue });
    } catch (err: any) {
      log(`Recovery queue fetch error: ${err.message}`, "recovery-engine");
      res.status(500).json({ error: "Failed to load recovery queue" });
    }
  });

  app.post("/api/outreach/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      let clientId = (req as any).user?.clientId;
      if (!clientId) {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const { runOutreachEngine } = await import("./outreach-engine");
      const result = await runOutreachEngine(clientId);
      res.json(result);
    } catch (err: any) {
      log(`Outreach engine run error: ${err.message}`, "outreach-engine");
      res.status(500).json({ error: "Failed to run outreach engine" });
    }
  });

  app.get("/api/outreach/pipeline", authMiddleware, async (req: Request, res: Response) => {
    try {
      let clientId = (req as any).user?.clientId;
      if (!clientId) {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const status = req.query.status as string | undefined;
      const items = await storage.getOutreachPipelines(clientId, status);
      const stats = {
        total: items.length,
        active: 0,
        completed: 0,
        responded: 0,
        notInterested: 0,
      };
      for (const item of items) {
        if (item.pipelineStatus === "ACTIVE") stats.active++;
        else if (item.pipelineStatus === "COMPLETED") stats.completed++;
        else if (item.pipelineStatus === "RESPONDED") stats.responded++;
        else if (item.pipelineStatus === "NOT_INTERESTED") stats.notInterested++;
      }
      res.json({ stats, items });
    } catch (err: any) {
      log(`Outreach pipeline fetch error: ${err.message}`, "outreach-engine");
      res.status(500).json({ error: "Failed to load outreach pipeline" });
    }
  });

  app.patch("/api/outreach/pipeline/:id/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      let clientId = (req as any).user?.clientId;
      if (!clientId) {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const { status } = req.body;
      const validStatuses = ["ACTIVE", "COMPLETED", "RESPONDED", "NOT_INTERESTED"];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(", ")}` });
      }
      const { updateOutreachStatus } = await import("./outreach-engine");
      const result = await updateOutreachStatus(parseInt(req.params.id), status, clientId);
      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }
      res.json(result);
    } catch (err: any) {
      log(`Outreach status update error: ${err.message}`, "outreach-engine");
      res.status(500).json({ error: "Failed to update outreach status" });
    }
  });

  app.post("/api/dm-status/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      let clientId = (req as any).user?.clientId;
      if (!clientId) {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) {
        return res.status(400).json({ error: "Client context required" });
      }
      const { updateDMStatus } = await import("./dm-status");
      const result = await updateDMStatus(clientId);
      res.json(result);
    } catch (err: any) {
      log(`DM Status run error: ${err.message}`, "dm-status");
      res.status(500).json({ error: "Failed to run DM status classification" });
    }
  });

  app.get("/api/alerts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const unresolvedOnly = req.query.unresolved === "true";
      const alerts = await storage.getMachineAlerts(clientId, unresolvedOnly);
      res.json({ alerts });
    } catch (err: any) {
      log(`Alerts fetch error: ${err.message}`, "machine-alerts");
      res.status(500).json({ error: "Failed to load alerts" });
    }
  });

  app.post("/api/alerts/:id/resolve", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const id = parseInt(req.params.id, 10);
      const alert = await storage.resolveMachineAlert(id, clientId);
      if (!alert) return res.status(404).json({ error: "Alert not found" });
      res.json({ alert });
    } catch (err: any) {
      log(`Alert resolve error: ${err.message}`, "machine-alerts");
      res.status(500).json({ error: "Failed to resolve alert" });
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

  app.get("/api/companies", authMiddleware, async (req: Request, res: Response) => {
    try {
      const table = encodeURIComponent("Companies");
      const companies: any[] = [];
      let offset: string | undefined;
      do {
        const params = offset ? `?pageSize=100&offset=${offset}` : "?pageSize=100";
        const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${table}${params}`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY()}` } });
        if (!resp.ok) throw new Error(`Airtable error: ${resp.status}`);
        const data = await resp.json();
        for (const rec of data.records || []) {
          const f = rec.fields;
          companies.push({
            id: rec.id,
            companyName: String(f.company_name || f.Company_Name || "").trim(),
            website: String(f.website || "").trim(),
            phone: String(f.phone || f.Phone || "").trim(),
            city: String(f.city || f.City || "").trim(),
            state: String(f.state || f.State || "").trim(),
            leadStatus: String(f.Lead_Status || "").trim(),
            enrichmentStatus: String(f.enrichment_status || "").trim(),
            dmCoverageStatus: String(f.DM_Coverage_Status || "").trim(),
            primaryDMName: String(f.Primary_DM_Name || "").trim(),
            primaryDMTitle: String(f.Primary_DM_Title || "").trim(),
            primaryDMEmail: String(f.Primary_DM_Email || "").trim(),
            primaryDMPhone: String(f.Primary_DM_Phone || "").trim(),
            offerDMName: String(f.Offer_DM_Name || "").trim(),
            offerDMTitle: String(f.Offer_DM_Title || "").trim(),
            offerDMEmail: String(f.Offer_DM_Email || "").trim(),
            offerDMPhone: String(f.Offer_DM_Phone || "").trim(),
            lastOutcome: String(f.Last_Outcome || "").trim(),
            todayCallList: f.Today_Call_List === true,
            touchCount: parseInt(String(f.Touch_Count || "0")) || 0,
            rankReason: String(f.Rank_Reason || "").trim(),
            industry: String(f.Industry || f.industry || "").trim(),
          });
        }
        offset = data.offset;
      } while (offset);
      res.json({ ok: true, companies });
    } catch (err: any) {
      log(`Companies fetch error: ${err.message}`, "contacts");
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/companies/add", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyName, website, phone, city, state, contactName, contactTitle, contactEmail, contactPhone, source, lngIntel } = req.body;
      if (!companyName) return res.status(400).json({ ok: false, error: "Company name is required" });

      const table = encodeURIComponent("Companies");
      const fields: Record<string, string> = { company_name: companyName };
      if (website) fields.website = website;
      if (phone) fields.phone = phone;
      if (city) fields.city = city;
      if (state) fields.state = state;
      fields.Lead_Status = "New";
      if (source === "lng_intelligence") fields.lead_source = "LNG Intelligence";

      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${table}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields }),
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Airtable error ${resp.status}: ${errBody}`);
      }
      const record = await resp.json();

      const dmName = contactName || (lngIntel?.dmName);
      const dmTitle = contactTitle || (lngIntel?.dmTitle);
      if (dmName) {
        try {
          const dmTable = encodeURIComponent("Decision_Makers");
          const dmFields: Record<string, any> = {
            full_name: dmName,
            company_name_text: companyName,
            source: source === "lng_intelligence" ? "lng_intelligence" : "manual",
            enriched_at: new Date().toISOString(),
          };
          if (dmTitle) dmFields.title = dmTitle;
          if (contactEmail) dmFields.email = contactEmail;
          if (contactPhone) dmFields.phone = contactPhone;

          const dmUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${dmTable}`;
          const dmResp = await fetch(dmUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${AIRTABLE_API_KEY()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ fields: dmFields }),
          });
          if (dmResp.ok) {
            log(`Created DM "${dmName}" for ${companyName}`, "contacts");
          } else {
            const dmErr = await dmResp.text();
            log(`DM creation warning: ${dmErr}`, "contacts");
          }
        } catch (dmErr: any) {
          log(`DM creation failed (non-blocking): ${dmErr.message}`, "contacts");
        }
      }

      const clientId = (req as any).user?.clientId || "global";
      await db.insert(manualLeads).values({
        clientId,
        airtableRecordId: record.id,
        companyName,
      });

      log(`Added manual lead: ${companyName} (${record.id})`, "contacts");
      res.json({ ok: true, id: record.id, companyName });
    } catch (err: any) {
      log(`Add company error: ${err.message}`, "contacts");
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/proposals/create", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(400).json({ error: "No client context" });

      const { companyName, contactName, contactTitle, contactEmail, officeAddress,
        proposalTitle, lineItems, taxRate, features, terms } = req.body;

      if (!companyName) return res.status(400).json({ error: "Company name required" });
      if (!Array.isArray(lineItems) || !lineItems.length) return res.status(400).json({ error: "At least one line item required" });
      if (!contactEmail) return res.status(400).json({ error: "Recipient email required to send proposal" });

      const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

      const subtotal = lineItems.reduce((s: number, i: any) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
      const taxAmount = subtotal * ((taxRate || 0) / 100);
      const total = subtotal + taxAmount;

      let hubspotResult: any = null;
      try {
        const { isHubSpotConnected: checkHS, createInvoiceInHubSpot } = await import("./hubspot-sync");
        const connected = await checkHS(clientId);
        if (connected) {
          hubspotResult = await createInvoiceInHubSpot(clientId, {
            companyName, contactName, contactTitle, contactEmail, officeAddress,
            proposalTitle, lineItems, taxRate: taxRate ?? 0, features: features || [], terms: terms || [],
          });
          log(`Proposal synced to HubSpot for ${companyName}`, "proposals");
        }
      } catch (hsErr: any) {
        log(`HubSpot sync skipped: ${hsErr.message}`, "proposals");
      }

      const lineItemsHtml = lineItems.map((item: any) => {
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unitPrice) || 0;
        const lineTotal = qty * price;
        return `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#0F172A;">${esc(item.description)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#0F172A;text-align:center;">${qty}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#0F172A;text-align:right;">$${price.toLocaleString()}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#0F172A;text-align:right;font-weight:600;">$${lineTotal.toLocaleString()}</td>
        </tr>`;
      }).join("");

      const featuresHtml = (Array.isArray(features) ? features : []).map((f: string) =>
        `<li style="padding:4px 0;font-size:13px;color:#334155;">${esc(f)}</li>`
      ).join("");

      const termsHtml = (Array.isArray(terms) ? terms : []).map((t: string) =>
        `<li style="padding:4px 0;font-size:13px;color:#334155;">${esc(t)}</li>`
      ).join("");

      const proposalHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#FFFFFF;border-radius:12px;border:1px solid #E2E8F0;overflow:hidden;">
      <div style="background:#0F172A;padding:32px;text-align:center;">
        <h1 style="margin:0;color:#FFFFFF;font-size:22px;font-weight:700;">${esc(proposalTitle || "Sales Proposal")}</h1>
        <p style="margin:8px 0 0;color:#94A3B8;font-size:13px;">Prepared for ${esc(companyName)}</p>
      </div>
      <div style="padding:32px;">
        <div style="margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;">Prepared For</p>
          ${contactName ? `<p style="margin:0 0 2px;font-size:15px;color:#0F172A;font-weight:600;">${esc(contactName)}</p>` : ""}
          ${contactTitle ? `<p style="margin:0 0 2px;font-size:13px;color:#64748B;">${esc(contactTitle)}</p>` : ""}
          ${companyName ? `<p style="margin:0 0 2px;font-size:13px;color:#64748B;">${esc(companyName)}</p>` : ""}
          ${officeAddress ? `<p style="margin:0;font-size:13px;color:#64748B;">${esc(officeAddress)}</p>` : ""}
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>
            <tr style="background:#F8FAFC;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;border-bottom:2px solid #E2E8F0;">Description</th>
              <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;border-bottom:2px solid #E2E8F0;">Qty</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;border-bottom:2px solid #E2E8F0;">Unit Price</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;border-bottom:2px solid #E2E8F0;">Total</th>
            </tr>
          </thead>
          <tbody>${lineItemsHtml}</tbody>
        </table>

        <div style="background:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;color:#64748B;">Subtotal</span>
            <span style="font-size:14px;color:#0F172A;font-weight:600;">$${subtotal.toLocaleString()}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;color:#64748B;">Tax (${taxRate || 0}%)</span>
            <span style="font-size:14px;color:#0F172A;">$${taxAmount.toLocaleString()}</span>
          </div>
          <div style="border-top:2px solid #E2E8F0;padding-top:12px;display:flex;justify-content:space-between;">
            <span style="font-size:16px;color:#0F172A;font-weight:700;">Total</span>
            <span style="font-size:20px;color:#10B981;font-weight:700;">$${total.toLocaleString()}</span>
          </div>
        </div>

        ${featuresHtml ? `
        <div style="margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;">Features Included</p>
          <ul style="margin:0;padding:0 0 0 20px;list-style-type:disc;">${featuresHtml}</ul>
        </div>` : ""}

        ${termsHtml ? `
        <div style="margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;font-weight:600;">Terms &amp; Conditions</p>
          <ul style="margin:0;padding:0 0 0 20px;list-style-type:disc;">${termsHtml}</ul>
        </div>` : ""}

        <div style="text-align:center;padding:24px 0 8px;border-top:1px solid #E2E8F0;">
          <p style="margin:0;font-size:12px;color:#94A3B8;">This proposal is valid for 30 days from the date of receipt.</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

      const { sendProposalEmail } = await import("./email-service");
      const emailResult = await sendProposalEmail({
        clientId,
        recipientEmail: contactEmail,
        recipientName: contactName || "",
        companyName,
        proposalTitle: proposalTitle || "Sales Proposal",
        proposalHtml,
      });

      if (!emailResult.success) {
        log(`Proposal email failed for ${companyName}: ${emailResult.error}`, "proposals");
        return res.status(400).json({ error: emailResult.error });
      }

      log(`Proposal emailed to ${contactEmail} for ${companyName}: $${total.toLocaleString()}`, "proposals");
      res.json({
        success: true,
        emailSent: true,
        hubspotSynced: hubspotResult?.synced || false,
        total,
      });
    } catch (err: any) {
      log(`Proposal creation error: ${err.message}`, "proposals");
      res.status(500).json({ error: "Failed to create proposal" });
    }
  });

  app.get("/api/companies/manual", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId || "global";
      const manualRows = await db.select().from(manualLeads).where(eq(manualLeads.clientId, clientId));

      if (manualRows.length === 0) {
        return res.json({ ok: true, companies: [], count: 0 });
      }

      const recordIds = manualRows.map(r => r.airtableRecordId);
      const table = encodeURIComponent("Companies");
      const fieldNames = [
        "company_name", "phone", "website", "city",
        "Lead_Status", "Bucket", "Final_Priority",
        "Times_Called", "Last_Outcome",
        "Offer_DM_FitScore", "Offer_DM_Reason",
        "Primary_DM_Name", "Primary_DM_Email", "Primary_DM_Phone",
        "Rank_Reason", "Rank_Evidence",
        "Playbook_Call_Opener", "Playbook_Gatekeeper_Ask", "Playbook_Voicemail",
        "Playbook_Followup_Text", "Playbook_Email_Subject", "Playbook_Email_Body",
      ];
      const fieldParams = fieldNames.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

      const companies: any[] = [];
      const BATCH = 10;
      for (let i = 0; i < recordIds.length; i += BATCH) {
        const batch = recordIds.slice(i, i + BATCH);
        const parts = batch.map(id => `RECORD_ID()='${id}'`);
        const formula = encodeURIComponent(`OR(${parts.join(",")})`);
        const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${table}?filterByFormula=${formula}&${fieldParams}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY()}` },
        });
        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          log(`Manual leads Airtable error: ${resp.status} ${errBody.slice(0, 200)}`, "contacts");
          continue;
        }
        const data = await resp.json();
        for (const rec of data.records || []) {
          const f = rec.fields;
          companies.push({
            id: rec.id,
            company_name: String(f.company_name || f.Company_Name || ""),
            phone: String(f.phone || f.Phone || ""),
            website: String(f.website || f.Website || ""),
            city: String(f.city || f.City || ""),
            state: "",
            lead_status: String(f.Lead_Status || "New"),
            bucket: String(f.Bucket || ""),
            final_priority: parseInt(f.Final_Priority || "0", 10) || 0,
            times_called: parseInt(f.Times_Called || "0", 10) || 0,
            last_outcome: String(f.Last_Outcome || ""),
            followup_due: "",
            offer_dm_name: String(f.Primary_DM_Name || ""),
            offer_dm_title: "",
            offer_dm_email: String(f.Primary_DM_Email || ""),
            offer_dm_phone: String(f.Primary_DM_Phone || ""),
            rank_reason: String(f.Rank_Reason || ""),
            rank_evidence: String(f.Rank_Evidence || ""),
            playbook_opener: String(f.Playbook_Call_Opener || ""),
            playbook_gatekeeper: String(f.Playbook_Gatekeeper_Ask || ""),
            playbook_voicemail: String(f.Playbook_Voicemail || ""),
            playbook_followup: String(f.Playbook_Followup_Text || ""),
            gatekeeper_name: "",
            dm_coverage_status: "",
            industry: "",
            touch_count: 0,
          });
        }
      }

      log(`Manual leads: ${companies.length} found`, "contacts");
      res.json({ ok: true, companies, count: companies.length });
    } catch (err: any) {
      log(`Manual leads fetch error: ${err.message}`, "contacts");
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/companies/:id/enrich", authMiddleware, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      log(`Manual enrich triggered for ${id}`, "contacts");

      const table = encodeURIComponent("Companies");
      const recUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${table}/${id}`;
      const recResp = await fetch(recUrl, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY()}` } });
      if (!recResp.ok) throw new Error(`Company not found: ${recResp.status}`);
      const record = await recResp.json();
      const f = record.fields;
      const companyName = f.company_name || f.Company_Name || "Unknown";
      const website = f.website || "";
      const city = f.city || f.City || "";
      const state = f.state || f.State || "";

      let dmResult = null;
      let intelResult = null;
      const errors: string[] = [];

      try {
        const enrichResult = await enrichCompany(id);
        const written = await writeDMsToAirtable(enrichResult);
        dmResult = {
          decisionMakersFound: enrichResult.decisionMakers.length,
          written,
          domain: enrichResult.domain,
          apolloData: enrichResult.apolloData,
        };
        if (enrichResult.error) errors.push(`DM: ${enrichResult.error}`);
      } catch (e: any) {
        errors.push(`DM enrichment failed: ${e.message}`);
      }

      try {
        const intel = await gatherCompanyIntel(
          id,
          companyName,
          website || null,
          city,
          state,
          f.Rank_Reason || "",
          f.Rank_Evidence || ""
        );
        intelResult = {
          confidence: intel.intel?.confidence || "low",
          updated: intel.updated,
        };
        if (intel.error) errors.push(`Intel: ${intel.error}`);
      } catch (e: any) {
        errors.push(`Web intel failed: ${e.message}`);
      }

      res.json({
        ok: true,
        companyName,
        dm: dmResult,
        intel: intelResult,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err: any) {
      log(`Enrich error for ${id}: ${err.message}`, "contacts");
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/command-center", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sevenDaysAgo = new Date(todayStart);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const flowFilter = clientId ? eq(companyFlows.clientId, clientId) : sql`1=1`;
      const attemptFilter = clientId ? eq(flowAttempts.clientId, clientId) : sql`1=1`;
      const queueFilter = clientId ? eq(actionQueue.clientId, clientId) : sql`1=1`;

      const [pipelineRows] = await Promise.all([
        db.select({
          status: companyFlows.status,
          lastOutcome: companyFlows.lastOutcome,
          flowType: companyFlows.flowType,
          count: sql<number>`count(*)::int`,
        }).from(companyFlows).where(flowFilter).groupBy(companyFlows.status, companyFlows.lastOutcome, companyFlows.flowType),
      ]);

      let hotLeads = 0, contacted = 0, interested = 0, proposalSent = 0, closedDeals = 0, dmIdentified = 0, newLeads = 0;
      for (const row of pipelineRows) {
        if (row.status === "active" && !row.lastOutcome) newLeads += row.count;
        if (row.flowType === "dm_call" || row.flowType === "email" || row.flowType === "linkedin") dmIdentified += row.count;
        if (row.lastOutcome && ["no_answer", "voicemail_left", "general_voicemail", "message_taken", "asked_to_send_info", "sent"].includes(row.lastOutcome)) contacted += row.count;
        if (row.lastOutcome && ["interested", "meeting_requested", "followup_scheduled", "replied", "live_answer"].includes(row.lastOutcome)) interested += row.count;
        if (row.lastOutcome === "meeting_requested") proposalSent += row.count;
        if (row.lastOutcome === "closed_won") closedDeals += row.count;
      }

      const todayAttempts = await db.select({
        channel: flowAttempts.channel,
        outcome: flowAttempts.outcome,
        count: sql<number>`count(*)::int`,
      }).from(flowAttempts).where(and(attemptFilter, gte(flowAttempts.createdAt, todayStart))).groupBy(flowAttempts.channel, flowAttempts.outcome);

      let callsMade = 0, emailsSent = 0, conversationsStarted = 0, meetingsBooked = 0;
      for (const row of todayAttempts) {
        if (row.channel === "phone") callsMade += row.count;
        if (row.channel === "email") emailsSent += row.count;
        if (row.outcome && ["live_answer", "interested", "meeting_requested", "replied"].includes(row.outcome)) conversationsStarted += row.count;
        if (row.outcome === "meeting_requested") meetingsBooked += row.count;
      }

      const callsDueToday = await db.select({ count: sql<number>`count(*)::int` })
        .from(actionQueue)
        .where(and(queueFilter, eq(actionQueue.status, "pending"), eq(actionQueue.taskType, "call"), lte(actionQueue.dueAt, now)));
      const callsDue = callsDueToday[0]?.count || 0;

      const overdueFollowups = await db.select({ count: sql<number>`count(*)::int` })
        .from(companyFlows)
        .where(and(flowFilter, eq(companyFlows.status, "active"), sql`${companyFlows.nextDueAt} IS NOT NULL`, lte(companyFlows.nextDueAt, todayStart)));
      const overdue = overdueFollowups[0]?.count || 0;

      const recentAttemptDays = await db.select({
        day: sql<string>`DATE(${flowAttempts.createdAt})::text`,
      }).from(flowAttempts).where(and(attemptFilter, gte(flowAttempts.createdAt, sevenDaysAgo))).groupBy(sql`DATE(${flowAttempts.createdAt})`).orderBy(desc(sql`DATE(${flowAttempts.createdAt})`));

      let streak = 0;
      const daySet = new Set(recentAttemptDays.map(r => r.day));
      for (let i = 0; i < 7; i++) {
        const d = new Date(todayStart);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split("T")[0];
        if (daySet.has(key)) streak++;
        else break;
      }

      const hotFlows = await db.select({
        companyName: companyFlows.companyName,
        companyId: companyFlows.companyId,
        lastOutcome: companyFlows.lastOutcome,
        flowType: companyFlows.flowType,
      }).from(companyFlows).where(and(
        flowFilter,
        eq(companyFlows.status, "active"),
        sql`${companyFlows.lastOutcome} IN ('interested', 'meeting_requested', 'followup_scheduled', 'replied', 'live_answer')`,
      )).orderBy(desc(companyFlows.updatedAt)).limit(10);
      hotLeads = hotFlows.length;

      const recentActivity = await db.select({
        companyName: flowAttempts.companyName,
        outcome: flowAttempts.outcome,
        channel: flowAttempts.channel,
        createdAt: flowAttempts.createdAt,
      }).from(flowAttempts).where(and(attemptFilter, gte(flowAttempts.createdAt, todayStart))).orderBy(desc(flowAttempts.createdAt)).limit(8);

      const aiRecommendations: Array<{ type: string; title: string; description: string; action: string; route: string }> = [];

      if (overdue > 0) {
        aiRecommendations.push({
          type: "urgent",
          title: `${overdue} overdue follow-up${overdue > 1 ? "s" : ""}`,
          description: "These leads are waiting for a callback. Don't let them go cold.",
          action: "View Follow-ups",
          route: "/machine/followups",
        });
      }

      for (const hot of hotFlows.slice(0, 3)) {
        aiRecommendations.push({
          type: "hot_lead",
          title: `${hot.companyName} is warm`,
          description: `Last outcome: ${hot.lastOutcome}. Strike while the iron is hot.`,
          action: "View Company",
          route: `/machine/company/${hot.companyId}`,
        });
      }

      if (callsMade === 0 && callsDue > 0) {
        aiRecommendations.push({
          type: "action",
          title: `${callsDue} calls waiting`,
          description: "Your call queue is ready. Start Focus Mode to begin outreach.",
          action: "Start Focus Mode",
          route: "/machine/focus",
        });
      }

      if (emailsSent === 0) {
        aiRecommendations.push({
          type: "action",
          title: "No emails sent today",
          description: "Check the email queue for leads ready for outreach.",
          action: "View Email Queue",
          route: "/machine/email-queue",
        });
      }

      res.json({
        revenue: {
          hotLeads,
          callsDue,
          overdueFollowups: overdue,
          pipelineValue: interested + proposalSent + closedDeals,
        },
        pipeline: { newLeads, dmIdentified, contacted, interested, proposalSent, closedDeals },
        activity: {
          callsMade,
          emailsSent,
          leadsFound: newLeads,
          conversationsStarted,
          meetingsBooked,
          streak,
        },
        hotLeadsList: hotFlows,
        recentActivity,
        aiRecommendations,
      });
    } catch (err: any) {
      log(`Command center error: ${err.message}`, "dashboard");
      res.status(500).json({ error: err.message });
    }
  });
}
