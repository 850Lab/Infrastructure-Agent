Warning: truncated output (original token count: 38687)
Total output lines: 3476

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
import { manualLeads, clients, companyFlows, flowAttempts, actionQueue, outreachPipeline, targetProfiles, emailSends, emailReplies, twilioRecordings, inboundMessages } from "@shared/schema";
import { eq, and, gte, lte, inArray, sql, desc, or, asc, isNotNull, isNull } from "drizzle-orm";
import { authMiddleware, createToken, extractToken, getEmailFromToken, getTokenEntry, validateToken, verifyPassword, seedPlatformAdmin, getPermissions, requirePermission } from "./auth";
import { enrichCompany, writeDMsToAirtable } from "./dm-enrichment";
import { gatherCompanyIntel } from "./web-intel";
import { storage } from "./storage";
import { getTimeWeight, getSignalAge, getDecayConstant } from "./time-weight";
import { analyzeLeadQuality, extractContactInfo } from "./openai";
import { scoreAndUpdateFlow, scoreAllFlowsForClient, scoreCompany } from "./lead-intelligence";
import { inferredContacts } from "@shared/schema";
import { loginRateLimit } from "./security-middleware";

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

  app.post("/api/auth/login", loginRateLimit, async (req: Request, res: Response) => {
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
        hotLeads: 0,
        warmLeads: 0,
      };
      for (const item of items) {
        if (item.pipelineStatus === "ACTIVE") stats.active++;
        else if (item.pipelineStatus === "COMPLETED") stats.completed++;
        else if (item.pipelineStatus === "RESPONDED") stats.responded++;
        else if (item.pipelineStatus === "NOT_INTERESTED") stats.notInterested++;
      }

      const { actionQueue, companyFlows } = await import("@shared/schema");
      const [hotResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(actionQueue)
        .where(
          and(
            eq(actionQueue.clientId, clientId),
            eq(actionQueue.taskType, "hot_reply_followup"),
            eq(actionQueue.status, "pending"),
          )
        );
      stats.hotLeads = hotResult?.count || 0;

      const [warmResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(companyFlows)
        .where(
          and(
            eq(companyFlows.clientId, clientId),
            eq(companyFlows.status, "active"),
            isNotNull(companyFlows.warmStage),
          )
        );
      stats.warmLeads = warmResult?.count || 0;

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

  app.get("/api/pipeline-integrity", authMiddleware, async (req: Request, res: Response) => {
    try {
      let clientId = (req as any).user?.clientId;
      if (!clientId && (req as any).user?.role === "platform_admin") {
        clientId = undefined;
      }
      const { reportPipelineIntegrity } = await import("./pipeline-integrity");
      const report = await reportPipelineIntegrity(clientId);
      res.json(report);
    } catch (err: any) {
      log(`Pipeline integrity error: ${err.message}`, "pipeline-integrity");
      res.status(500).json({ error: err.message });
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
      const historicalPct = totalWeighted > 0 ? Math.round((historical…18687 tokens truncated…
        rows.length > 0
          ? rows
              .map((r) => r.triageAt?.getTime() ?? 0)
              .reduce((a, b) => Math.max(a, b), 0)
          : 0;
      const triagedAtIso = triagedAt > 0 ? new Date(triagedAt).toISOString() : null;

      res.json({
        websiteStatus,
        contactStatus,
        outreachReadiness,
        totalActiveFlows: totalResult[0]?.count ?? 0,
        triagedCount: rows.length,
        triagedAt: triagedAtIso,
      });
    } catch (err: any) {
      log(`Lead triage summary error: ${err.message}`, "lead-triage");
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lead-triage/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const { runLeadTriage } = await import("./lead-triage");
      const result = await runLeadTriage(clientId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      log(`Lead triage run error: ${err.message}`, "lead-triage");
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/lead-triage/debug-sample", authMiddleware, async (req: Request, res: Response) => {
    try {
      let clientId = (req as any).user?.clientId;
      if (!clientId) {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const { runLeadTriageForFlow } = await import("./lead-triage");

      const flows = await db
        .select({
          id: companyFlows.id,
          companyId: companyFlows.companyId,
          companyName: companyFlows.companyName,
          contactName: companyFlows.contactName,
          compositeScore: companyFlows.compositeScore,
          websiteStatus: companyFlows.websiteStatus,
          contactStatus: companyFlows.contactStatus,
          outreachReadiness: companyFlows.outreachReadiness,
          triageAt: companyFlows.triageAt,
        })
        .from(companyFlows)
        .where(and(eq(companyFlows.clientId, clientId), eq(companyFlows.status, "active")))
        .orderBy(desc(companyFlows.compositeScore))
        .limit(10);

      const results: Array<{
        flowId: number;
        companyName: string;
        compositeScore: number | null;
        source: { website: string | null; websiteLookupStatus: string | null; websiteCandidate: string | null; contactEmail: string | null; contactName: string | null; phone: string | null };
        triage: { websiteStatus: string; contactStatus: string; outreachReadiness: string };
      }> = [];

      for (const f of flows) {
        const triage = await runLeadTriageForFlow(clientId, f.id);
        const [pipeline] = await db
          .select({
            website: outreachPipeline.website,
            websiteLookupStatus: outreachPipeline.websiteLookupStatus,
            websiteCandidate: outreachPipeline.websiteCandidate,
            contactEmail: outreachPipeline.contactEmail,
            contactName: outreachPipeline.contactName,
            phone: outreachPipeline.phone,
          })
          .from(outreachPipeline)
          .where(and(eq(outreachPipeline.clientId, clientId), eq(outreachPipeline.companyId, f.companyId)));

        results.push({
          flowId: f.id,
          companyName: f.companyName,
          compositeScore: f.compositeScore,
          source: {
            website: pipeline?.website ?? null,
            websiteLookupStatus: pipeline?.websiteLookupStatus ?? null,
            websiteCandidate: pipeline?.websiteCandidate ?? null,
            contactEmail: pipeline?.contactEmail ?? null,
            contactName: pipeline?.contactName ?? null,
            phone: pipeline?.phone ?? null,
          },
          triage: triage
            ? { websiteStatus: triage.websiteStatus, contactStatus: triage.contactStatus, outreachReadiness: triage.outreachReadiness }
            : { websiteStatus: f.websiteStatus ?? "", contactStatus: f.contactStatus ?? "", outreachReadiness: f.outreachReadiness ?? "" },
        });
      }

      res.json({ count: results.length, flows: results });
    } catch (err: any) {
      log(`Lead triage debug-sample error: ${err.message}`, "lead-triage");
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/research-engine/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });
      const { runResearchEngine } = await import("./research-engine");
      const result = await runResearchEngine(clientId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      log(`Research engine error: ${err.message}`, "research-engine");
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/vetting/progress", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });
      const { getVettingProgress } = await import("./vetting-engine");
      const progress = await getVettingProgress(clientId);
      res.json({ success: true, ...progress });
    } catch (err: any) {
      log(`Vetting progress error: ${err.message}`, "vetting");
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/vetting/run-batch", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });
      const batchSize = Number(req.body?.batchSize) || 10;
      const { runVettingBatch, isVettingRunning } = await import("./vetting-engine");
      if (isVettingRunning()) return res.status(409).json({ error: "Vetting batch already in progress" });
      const result = await runVettingBatch(clientId, batchSize);
      res.json({ success: true, ...result });
    } catch (err: any) {
      log(`Vetting batch error: ${err.message}`, "vetting");
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/vetting/run-full", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });
      const batchSize = Number(req.body?.batchSize) || 10;
      const { isVettingRunning } = await import("./vetting-engine");
      if (isVettingRunning()) return res.status(409).json({ error: "Vetting already in progress" });
      res.json({ success: true, message: `Full vetting started (batch size ${batchSize}). Check progress at GET /api/vetting/progress.` });
      const { runFullVetting } = await import("./vetting-engine");
      runFullVetting(clientId, batchSize, (batchResult, batchNumber) => {
        log(`Vetting batch #${batchNumber}: processed=${batchResult.batchProcessed} remaining=${batchResult.remaining} (${batchResult.percentComplete}%)`, "vetting");
      }).then(final => {
        log(`Full vetting complete: ${final.totalProcessed} processed in ${final.totalBatches} batches`, "vetting");
      }).catch(err => {
        log(`Full vetting error: ${err.message}`, "vetting");
      });
    } catch (err: any) {
      log(`Vetting start error: ${err.message}`, "vetting");
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/research-engine/enrich/:flowId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });
      const flowId = parseInt(req.params.flowId);
      if (isNaN(flowId)) return res.status(400).json({ error: "Invalid flow ID" });
      const [flow] = await db.select({ id: companyFlows.id, clientId: companyFlows.clientId })
        .from(companyFlows).where(and(eq(companyFlows.id, flowId), eq(companyFlows.clientId, clientId)));
      if (!flow) return res.status(404).json({ error: "Flow not found" });
      const { deepEnrichFlow } = await import("./research-engine");
      const result = await deepEnrichFlow(flowId);
      if (!result) return res.status(404).json({ error: "Enrichment failed" });
      res.json({ success: true, ...result });
    } catch (err: any) {
      log(`Research enrich error: ${err.message}`, "research-engine");
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/research-engine/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const allActive = await db.select({
        bestChannel: companyFlows.bestChannel,
        researchBlockerReasons: companyFlows.researchBlockerReasons,
        researchConvertedFrom: companyFlows.researchConvertedFrom,
        deepEnrichmentRan: companyFlows.deepEnrichmentRan,
        enrichmentStatus: companyFlows.enrichmentStatus,
      }).from(companyFlows)
        .where(and(eq(companyFlows.clientId, clientId), eq(companyFlows.status, "active")));

      let researchBacklog = 0;
      let convertedToEmail = 0;
      let convertedToCall = 0;
      let deepEnriched = 0;
      let blocked = 0;
      const blockerBreakdown: Record<string, number> = {};

      for (const f of allActive) {
        if (f.bestChannel === "research_more") researchBacklog++;
        if (f.researchConvertedFrom === "research_more") {
          if (f.bestChannel === "email") convertedToEmail++;
          else if (f.bestChannel === "call") convertedToCall++;
        }
        if (f.deepEnrichmentRan) deepEnriched++;
        if (f.enrichmentStatus === "research_blocked") blocked++;
        if (f.researchBlockerReasons) {
          try {
            const reasons = JSON.parse(f.researchBlockerReasons);
            for (const r of reasons) {
              blockerBreakdown[r] = (blockerBreakdown[r] || 0) + 1;
            }
          } catch {}
        }
      }

      res.json({
        totalActive: allActive.length,
        researchBacklog,
        convertedToEmail,
        convertedToCall,
        totalConverted: convertedToEmail + convertedToCall,
        deepEnriched,
        blocked,
        blockerBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/website-finder-engine/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const { runWebsiteFinderEngine } = await import("./website-finder-engine");
      const result = await runWebsiteFinderEngine(clientId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      log(`Website finder engine error: ${err.message}`, "website-finder-engine");
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/website-finder-engine/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const [rows, filterCounts] = await Promise.all([
        db.select({
          websiteLookupStatus: outreachPipeline.websiteLookupStatus,
        }).from(outreachPipeline)
          .where(eq(outreachPipeline.clientId, clientId)),
        (async () => {
          const { getWebsiteFinderFilterCounts } = await import("./website-finder-engine");
          return getWebsiteFinderFilterCounts(clientId);
        })(),
      ]);

      let processed = 0;
      let websitesFound = 0;
      let notFound = 0;
      let candidateStored = 0;
      let lowConfidence = 0;
      let blockedUrl = 0;
      let sourceUnavailable = 0;
      const breakdown: Record<string, number> = {};

      for (const r of rows) {
        if (!r.websiteLookupStatus) continue;
        processed++;
        breakdown[r.websiteLookupStatus] = (breakdown[r.websiteLookupStatus] || 0) + 1;
        if (r.websiteLookupStatus === "found") websitesFound++;
        else if (r.websiteLookupStatus === "not_found") notFound++;
        else if (r.websiteLookupStatus === "candidate_stored") candidateStored++;
        else if (r.websiteLookupStatus === "low_confidence") lowConfidence++;
        else if (r.websiteLookupStatus === "blocked_url") blockedUrl++;
        else if (r.websiteLookupStatus === "source_unavailable") sourceUnavailable++;
      }

      const stillBlocked = notFound + candidateStored + lowConfidence + blockedUrl + sourceUnavailable;

      res.json({
        processed,
        websitesFound,
        stillBlocked,
        notFound,
        candidateStored,
        lowConfidence,
        blockedUrl,
        sourceUnavailable,
        breakdown,
        filterCounts,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/deep-research-engine/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const { runDeepResearchEngine } = await import("./deep-research-engine");
      const result = await runDeepResearchEngine(clientId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      log(`Deep research engine error: ${err.message}`, "deep-research-engine");
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/deep-research-engine/enrich/:flowId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const flowId = parseInt(req.params.flowId);
      if (isNaN(flowId)) return res.status(400).json({ error: "Invalid flow ID" });

      const [flow] = await db.select({ id: companyFlows.id, clientId: companyFlows.clientId })
        .from(companyFlows).where(and(eq(companyFlows.id, flowId), eq(companyFlows.clientId, clientId)));
      if (!flow) return res.status(404).json({ error: "Flow not found" });

      const { deepResearchFlow } = await import("./deep-research-engine");
      const result = await deepResearchFlow(flowId);
      if (!result) return res.status(404).json({ error: "Enrichment failed" });
      res.json({ success: true, ...result });
    } catch (err: any) {
      log(`Deep research enrich error: ${err.message}`, "deep-research-engine");
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/deep-research-engine/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let clientId = user?.clientId;
      if (!clientId && user?.role === "platform_admin") {
        const allClients = await storage.getAllClients();
        if (allClients.length > 0) clientId = allClients[0].id;
      }
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const allActive = await db.select({
        bestChannel: companyFlows.bestChannel,
        deepEnrichmentRan: companyFlows.deepEnrichmentRan,
        deepResearchRan: companyFlows.deepResearchRan,
        deepResearchBlockerReasons: companyFlows.deepResearchBlockerReasons,
        enrichmentStatus: companyFlows.enrichmentStatus,
        researchConvertedFrom: companyFlows.researchConvertedFrom,
        deepResearchBestInferredEmail: companyFlows.deepResearchBestInferredEmail,
      }).from(companyFlows)
        .where(and(eq(companyFlows.clientId, clientId), eq(companyFlows.status, "active")));

      let remainingBacklog = 0;
      let convertedToEmail = 0;
      let convertedToCall = 0;
      let deepResearched = 0;
      let blocked = 0;
      const blockerBreakdown: Record<string, number> = {};

      for (const f of allActive) {
        const deepResearchIsDone = !!f.deepResearchRan;

        if (f.bestChannel === "research_more" && f.deepEnrichmentRan && !deepResearchIsDone) remainingBacklog++;

        if (deepResearchIsDone && f.researchConvertedFrom === "research_more") {
          if (f.bestChannel === "email") convertedToEmail++;
          else if (f.bestChannel === "call") convertedToCall++;
        }

        if (deepResearchIsDone) deepResearched++;
        if (deepResearchIsDone && f.enrichmentStatus === "research_blocked") blocked++;

        if (f.deepResearchBlockerReasons) {
          try {
            const reasons = JSON.parse(f.deepResearchBlockerReasons);
            for (const r of reasons) blockerBreakdown[r] = (blockerBreakdown[r] || 0) + 1;
          } catch {}
        }
      }

      res.json({
        totalActive: allActive.length,
        remainingBacklog,
        convertedToEmail,
        convertedToCall,
        totalConverted: convertedToEmail + convertedToCall,
        deepResearched,
        blocked,
        blockerBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const WARM_LEAD_OUTCOMES = ["interested", "meeting_requested", "followup_scheduled", "replied", "live_answer", "callback"];
  const WARM_STAGES = ["initial_interest", "proposal_sent", "meeting_scheduled", "negotiating", "verbal_commit", "closed_won", "closed_lost"];

  app.get("/api/warm-leads", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;

      const flows = await db.select().from(companyFlows)
        .where(and(
          clientId ? eq(companyFlows.clientId, clientId) : sql`1=1`,
          or(
            sql`${companyFlows.lastOutcome} IN (${sql.join(WARM_LEAD_OUTCOMES.map(o => sql`${o}`), sql`, `)})`,
            sql`${companyFlows.warmStage} IS NOT NULL`,
          ),
        ))
        .orderBy(asc(companyFlows.nextDueAt));

      const companyIds = [...new Set(flows.map(f => f.companyId))];

      let pipelineMap = new Map<string, any>();
      if (companyIds.length > 0) {
        const pipelineWhere = clientId
          ? and(eq(outreachPipeline.clientId, clientId), inArray(outreachPipeline.companyId, companyIds))
          : inArray(outreachPipeline.companyId, companyIds);
        const pipelineRows = await db.select().from(outreachPipeline).where(pipelineWhere);
        pipelineRows.forEach(p => { pipelineMap.set(p.companyId, p); });
      }

      const now = new Date();
      const leads = flows.map(f => {
        const pipeline = pipelineMap.get(f.companyId);
        const isOverdue = f.nextDueAt && new Date(f.nextDueAt) < now;
        const daysSinceActivity = f.lastAttemptAt
          ? Math.floor((now.getTime() - new Date(f.lastAttemptAt).getTime()) / 86400000)
          : null;

        let urgency: "critical" | "high" | "normal" | "low" = "normal";
        if (isOverdue && daysSinceActivity !== null && daysSinceActivity > 3) urgency = "critical";
        else if (isOverdue) urgency = "high";
        else if (f.warmStage === "closed_won" || f.warmStage === "closed_lost") urgency = "low";

        let parsedSignals: any = null;
        try { if (f.qualitySignals) parsedSignals = JSON.parse(f.qualitySignals); } catch {}

        return {
          flowId: f.id,
          companyId: f.companyId,
          companyName: f.companyName,
          contactName: f.contactName || pipeline?.contactName || null,
          contactEmail: pipeline?.contactEmail || null,
          contactPhone: pipeline?.phone || null,
          flowType: f.flowType,
          lastOutcome: f.lastOutcome,
          outcomeSource: f.outcomeSource,
          warmStage: f.warmStage || "initial_interest",
          warmStageUpdatedAt: f.warmStageUpdatedAt,
          nextAction: f.nextAction,
          nextDueAt: f.nextDueAt,
          lastAttemptAt: f.lastAttemptAt,
          priority: f.priority,
          verifiedQualityScore: f.verifiedQualityScore,
          verifiedQualityLabel: f.verifiedQualityLabel,
          transcriptSummary: f.transcriptSummary,
          buyingSignals: parsedSignals?.buyingSignals || [],
          objections: parsedSignals?.objections || [],
          nextStepReason: parsedSignals?.nextStepReason || null,
          notes: f.notes,
          urgency,
          isOverdue: !!isOverdue,
          daysSinceActivity,
          city: pipeline?.city || null,
          state: pipeline?.state || null,
          industry: pipeline?.industry || null,
          attemptCount: f.attemptCount,
          compositeScore: f.compositeScore,
          revenuePotentialScore: f.revenuePotentialScore,
          reachabilityScore: f.reachabilityScore,
          heatRelevanceScore: f.heatRelevanceScore,
          contactConfidenceScore: f.contactConfidenceScore,
          bestChannel: f.bestChannel,
          routingReason: f.routingReason,
          bestContactPath: f.bestContactPath,
          enrichmentStatus: f.enrichmentStatus,
          researchBlockerReasons: f.researchBlockerReasons,
          deepResearchRan: f.deepResearchRan,
          deepResearchBestInferredEmail: f.deepResearchBestInferredEmail,
          deepResearchBestInferredEmailConfidence: f.deepResearchBestInferredEmailConfidence,
          deepResearchSelectedRole: f.deepResearchSelectedRole,
          deepResearchSignals: f.deepResearchSignals,
          deepResearchBlockerReasons: f.deepResearchBlockerReasons,
        };
      });

      leads.sort((a, b) => {
        const urgencyOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      });

      const overdue = leads.filter(l => l.isOverdue && l.warmStage !== "closed_won" && l.warmStage !== "closed_lost").length;
      const meetingsToday = leads.filter(l => l.warmStage === "meeting_scheduled" && l.nextDueAt && new Date(l.nextDueAt).toDateString() === now.toDateString()).length;
      const needsProposal = leads.filter(l => l.warmStage === "initial_interest" && l.daysSinceActivity !== null && l.daysSinceActivity >= 2).length;
      const activeDeals = leads.filter(l => l.warmStage !== "closed_won" && l.warmStage !== "closed_lost").length;

      res.json({
        leads,
        stats: { total: leads.length, overdue, meetingsToday, needsProposal, activeDeals },
      });
    } catch (err: any) {
      log(`Warm leads error: ${err.message}`, "warm-leads");
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/warm-leads/:flowId/stage", authMiddleware, async (req: Request, res: Response) => {
    try {
      const flowId = parseInt(req.params.flowId);
      const { stage, notes } = req.body;

      if (!WARM_STAGES.includes(stage)) {
        return res.status(400).json({ error: `Invalid stage. Must be one of: ${WARM_STAGES.join(", ")}` });
      }

      const updates: any = {
        warmStage: stage,
        warmStageUpdatedAt: new Date(),
        updatedAt: new Date(),
      };

      if (stage === "closed_won") {
        updates.status = "completed";
        updates.lastOutcome = "won";
      } else if (stage === "closed_lost") {
        updates.status = "completed";
        updates.lastOutcome = "lost";
      }

      if (notes) {
        const existing = await db.select({ notes: companyFlows.notes }).from(companyFlows).where(eq(companyFlows.id, flowId));
        const prev = existing[0]?.notes || "";
        const timestamp = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
        updates.notes = prev ? `${prev}\n[${timestamp}] Stage → ${stage}${notes ? `: ${notes}` : ""}` : `[${timestamp}] Stage → ${stage}${notes ? `: ${notes}` : ""}`;
      }

      await db.update(companyFlows).set(updates).where(eq(companyFlows.id, flowId));
      log(`Warm lead ${flowId} stage updated to ${stage}`, "warm-leads");
      res.json({ success: true, stage });
    } catch (err: any) {
      log(`Warm lead stage update error: ${err.message}`, "warm-leads");
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/warm-leads/:companyId/timeline", authMiddleware, async (req: Request, res: Response) => {
    try {
      const companyId = req.params.companyId;
      const clientId = (req as any).user?.clientId;
      const events: any[] = [];

      const attempts = await db.select().from(flowAttempts)
        .where(and(
          eq(flowAttempts.companyId, companyId),
          clientId ? eq(flowAttempts.clientId, clientId) : sql`1=1`,
        )).orderBy(desc(flowAttempts.createdAt));

      attempts.forEach(a => {
        events.push({
          type: "attempt",
          channel: a.channel,
          outcome: a.outcome,
          notes: a.notes,
          contactName: a.contactName,
          capturedInfo: a.capturedInfo,
          timestamp: a.createdAt,
        });
      });

      const emails = await db.select().from(emailSends)
        .where(and(
          eq(emailSends.companyId, companyId),
          clientId ? eq(emailSends.clientId, clientId) : sql`1=1`,
        )).orderBy(desc(emailSends.sentAt));

      emails.forEach(e => {
        events.push({
          type: "email_sent",
          channel: "email",
          subject: e.subject,
          contactEmail: e.contactEmail,
          contactName: e.contactName,
          status: e.status,
          openCount: e.openCount,
          clickCount: e.clickCount,
          replyDetectedAt: e.replyDetectedAt,
          touchNumber: e.touchNumber,
          timestamp: e.sentAt,
        });
      });

      const companyNameForRecordings = await db.select({ companyName: companyFlows.companyName }).from(companyFlows).where(eq(companyFlows.companyId, companyId)).limit(1);
      const cName = companyNameForRecordings[0]?.companyName;

      const recordings = cName ? await db.select().from(twilioRecordings)
        .where(eq(twilioRecordings.companyName, cName))
        .orderBy(desc(twilioRecordings.createdAt)) : [];

      recordings.forEach(r => {
        events.push({
          type: "call_recording",
          channel: "call",
          duration: r.duration,
          transcription: r.transcription ? r.transcription.substring(0, 500) : null,
          analysis: r.analysis,
          outcome: r.callOutcome,
          timestamp: r.createdAt,
        });
      });

      const sms = await db.select().from(inboundMessages)
        .where(eq(inboundMessages.matchedCompany, companyId))
        .orderBy(desc(inboundMessages.createdAt));

      sms.forEach(m => {
        events.push({
          type: "sms_inbound",
          channel: "sms",
          body: m.body,
          fromNumber: m.fromNumber,
          timestamp: m.createdAt,
        });
      });

      const emailIds = emails.map(e => e.id);
      if (emailIds.length > 0) {
        const replies = await db.select().from(emailReplies)
          .where(sql`${emailReplies.emailSendId} IN (${sql.join(emailIds.map(id => sql`${id}`), sql`, `)})`)
          .orderBy(desc(emailReplies.receivedAt));

        replies.forEach(r => {
          events.push({
            type: "email_reply",
            channel: "email",
            fromEmail: r.fromEmail,
            subject: r.subject,
            snippet: r.snippet,
            timestamp: r.receivedAt,
          });
        });
      }

      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      res.json({ companyId, events });
    } catch (err: any) {
      log(`Timeline error for ${req.params.companyId}: ${err.message}`, "warm-leads");
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/warm-leads/:flowId/notes", authMiddleware, async (req: Request, res: Response) => {
    try {
      const flowId = parseInt(req.params.flowId);
      const { note } = req.body;
      if (!note) return res.status(400).json({ error: "Note is required" });

      const existing = await db.select({ notes: companyFlows.notes }).from(companyFlows).where(eq(companyFlows.id, flowId));
      const prev = existing[0]?.notes || "";
      const timestamp = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const updated = prev ? `${prev}\n[${timestamp}] ${note}` : `[${timestamp}] ${note}`;

      await db.update(companyFlows).set({ notes: updated, updatedAt: new Date() }).where(eq(companyFlows.id, flowId));
      res.json({ success: true, notes: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/warm-leads/deep-analysis", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      const apiKey = AIRTABLE_API_KEY();
      const baseId = AIRTABLE_BASE_ID();

      if (!apiKey || !baseId) {
        return res.status(400).json({ error: "Airtable not configured" });
      }

      const result = {
        totalRecords: 0,
        analyzed: 0,
        contactsExtracted: 0,
        qualityAnalyzed: 0,
        pipelineUpdated: 0,
        flowsUpdated: 0,
        newCompaniesAdded: 0,
        details: [] as { company: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; extractedNotes: string; qualityScore: number | null; }[],
        errors: [] as string[],
      };

      const formula = encodeURIComponent('OR(company_name!="",Company!="")');
      const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent("Calls")}?filterByFormula=${formula}&pageSize=100`;
      const airtableRes = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!airtableRes.ok) {
        return res.status(500).json({ error: `Airtable fetch failed: ${airtableRes.status}` });
      }
      const airtableData = await airtableRes.json() as any;
      const records = airtableData.records || [];
      result.totalRecords = records.length;

      const processedCompanies = new Set<string>();

      for (const rec of records) {
        const f = rec.fields || {};
        const companyName = (f.company_name || f.Company || "").trim();
        if (!companyName) continue;

        const companyKey = companyName.toLowerCase();
        if (processedCompanies.has(companyKey)) continue;
        processedCompanies.add(companyKey);

        const allRecordsForCompany = records.filter((r: any) => {
          const cn = (r.fields?.company_name || r.fields?.Company || "").trim().toLowerCase();
          return cn === companyKey;
        });

        let combinedText = "";
        allRecordsForCompany.forEach((r: any) => {
          const rf = r.fields || {};
          if (rf.Transcription) combinedText += `\n[TRANSCRIPT]: ${rf.Transcription}`;
          if (rf.Notes) combinedText += `\n[CALL NOTES]: ${rf.Notes}`;
          if (rf.Analysis) combinedText += `\n[CALL ANALYSIS]: ${rf.Analysis}`;
          if (rf.Gatekeeper_Name) combinedText += `\n[GATEKEEPER]: ${rf.Gatekeeper_Name}`;
          if (rf.Outcome) combinedText += `\n[OUTCOME]: ${rf.Outcome}`;
          if (rf.phone) combinedText += `\n[PHONE ON FILE]: ${rf.phone}`;
        });

        combinedText = combinedText.trim();
        if (!combinedText || combinedText.length < 10) continue;

        result.analyzed++;
        let contactInfo: Awaited<ReturnType<typeof extractContactInfo>> | null = null;
        let qualityResult: Awaited<ReturnType<typeof analyzeLeadQuality>> | null = null;

        try {
          contactInfo = await extractContactInfo(combinedText, companyName);
          result.contactsExtracted++;
          log(`[deep-analysis] ${companyName}: contact=${contactInfo.contactName}, email=${contactInfo.contactEmail}, phone=${contactInfo.contactPhone}`, "warm-leads");
        } catch (err: any) {
          result.errors.push(`${companyName} contact extraction: ${err.message}`);
        }

        const transcriptText = allRecordsForCompany
          .map((r: any) => r.fields?.Transcription || "")
          .filter((t: string) => t.length > 30)
          .join("\n\n");

        if (transcriptText.length > 30) {
          try {
            qualityResult = await analyzeLeadQuality(transcriptText, companyName);
            result.qualityAnalyzed++;
            log(`[deep-analysis] ${companyName}: quality=${qualityResult.score}/10 (${qualityResult.label})`, "warm-leads");
          } catch (err: any) {
            result.errors.push(`${companyName} quality analysis: ${err.message}`);
          }
        }

        const pipelineUpdates: any = {};
        if (contactInfo?.contactName) pipelineUpdates.contactName = contactInfo.contactName;
        if (contactInfo?.contactEmail) pipelineUpdates.contactEmail = contactInfo.contactEmail;
        if (contactInfo?.contactPhone) pipelineUpdates.phone = contactInfo.contactPhone;
        if (contactInfo?.contactTitle) pipelineUpdates.title = contactInfo.contactTitle;

        const noteParts: string[] = [];
        if (contactInfo?.extractedNotes && contactInfo.extractedNotes !== "No actionable info found" && contactInfo.extractedNotes !== "Extraction failed") {
          noteParts.push(contactInfo.extractedNotes);
        }
        if (contactInfo?.gatekeeperName) noteParts.push(`Gatekeeper: ${contactInfo.gatekeeperName}`);
        if (contactInfo?.companyDetails) noteParts.push(contactInfo.companyDetails);
        if (contactInfo?.directExtension) noteParts.push(`Ext: ${contactInfo.directExtension}`);

        const existingPipeline = await db.select().from(outreachPipeline)
          .where(sql`LOWER(${outreachPipeline.companyName}) = LOWER(${companyName})`)
          .limit(1);

        if (existingPipeline.length > 0) {
          const pipe = existingPipeline[0];
          const mergedUpdates: any = { ...pipelineUpdates, updatedAt: new Date() };
          if (pipe.contactName && pipelineUpdates.contactName) mergedUpdates.contactName = pipelineUpdates.contactName;
          if (!pipe.contactEmail && pipelineUpdates.contactEmail) mergedUpdates.contactEmail = pipelineUpdates.contactEmail;
          if (!pipe.phone && pipelineUpdates.phone) mergedUpdates.phone = pipelineUpdates.phone;
          if (!pipe.title && pipelineUpdates.title) mergedUpdates.title = pipelineUpdates.title;
          if (noteParts.length > 0) {
            const existingNotes = pipe.notes || "";
            const newNote = `[AI Extract] ${noteParts.join(" | ")}`;
            if (!existingNotes.includes("[AI Extract]")) {
              mergedUpdates.notes = existingNotes ? `${existingNotes}\n${newNote}` : newNote;
            }
          }
          await db.update(outreachPipeline).set(mergedUpdates).where(eq(outreachPipeline.id, pipe.id));
          result.pipelineUpdated++;
        }

        const existingFlows = await db.select().from(companyFlows)
          .where(and(
            sql`LOWER(${companyFlows.companyName}) = LOWER(${companyName})`,
            ...(clientId ? [eq(companyFlows.clientId, clientId)] : []),
          ))
          .orderBy(desc(companyFlows.updatedAt))
          .limit(1);

        if (existingFlows.length > 0) {
          const flow = existingFlows[0];
          const flowUpdates: any = { updatedAt: new Date() };

          if (contactInfo?.contactName && !flow.contactName) flowUpdates.contactName = contactInfo.contactName;

          if (qualityResult && flow.verifiedQualityScore === null) {
            flowUpdates.verifiedQualityScore = qualityResult.score;
            flowUpdates.verifiedQualityLabel = qualityResult.label;
            flowUpdates.qualitySignals = JSON.stringify({
              buyingSignals: qualityResult.buyingSignals,
              objections: qualityResult.objections,
              signals: qualityResult.signals,
              nextStepReason: qualityResult.nextStepReason,
            });
            flowUpdates.transcriptSummary = qualityResult.summary;
            if (qualityResult.nextStepReason) flowUpdates.nextAction = qualityResult.nextStepReason;
          }

          if (noteParts.length > 0) {
            const existingNotes = flow.notes || "";
            const newNote = `[AI Extract] ${noteParts.join(" | ")}`;
            if (!existingNotes.includes("[AI Extract]")) {
              flowUpdates.notes = existingNotes ? `${existingNotes}\n${newNote}` : newNote;
            }
          }

          await db.update(companyFlows).set(flowUpdates).where(eq(companyFlows.id, flow.id));
          result.flowsUpdated++;
        }

        result.details.push({
          company: companyName,
          contactName: contactInfo?.contactName || null,
          contactEmail: contactInfo?.contactEmail || null,
          contactPhone: contactInfo?.contactPhone || null,
          extractedNotes: contactInfo?.extractedNotes || "",
          qualityScore: qualityResult?.score || null,
        });
      }

      log(`[deep-analysis] Complete: ${result.analyzed} analyzed, ${result.contactsExtracted} contacts extracted, ${result.pipelineUpdated} pipeline updated, ${result.flowsUpdated} flows updated`, "warm-leads");
      res.json(result);
    } catch (err: any) {
      log(`Deep analysis error: ${err.message}`, "warm-leads");
      res.status(500).json({ error: err.message });
    }
  });
}
