import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireRole, hashPassword } from "./auth";
import { storage } from "./storage";
import { getHistory } from "./run-history";
import { log } from "./logger";
import { getUsageSummary } from "./usage-guard";
import { startDailyRun, RunAlreadyActiveError } from "./run-daily-web";
import { exportTableCSV } from "./data-export";
import { migrateClientData } from "./migrate-client-data";
import { aggregatePlatformInsights, getPlatformInsightsForIndustry } from "./platform-insights";
import { getSchedulerStatus, startScheduler, stopScheduler } from "./scheduler";
import { db } from "./db";
import { outreachPipeline, emailTemplates, clientEmailSettings } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const provisionSchema = z.object({
  clientName: z.string().min(1),
  machineName: z.string().min(1),
  industryConfig: z.string().min(1),
  territory: z.string().min(1),
  decisionMakerFocus: z.string().min(1),
  userEmail: z.string().email(),
  userPassword: z.string().min(6),
  userRole: z.enum(["client_admin", "operator"]).default("client_admin"),
});

export async function registerAdminRoutes(app: Express): Promise<void> {
  app.get("/api/admin/clients", authMiddleware, requireRole("platform_admin"), async (_req: Request, res: Response) => {
    try {
      const clients = await storage.getAllClients();
      res.json({ clients });
    } catch (err: any) {
      log(`Admin clients error: ${err.message}`, "admin");
      res.status(500).json({ error: "Failed to load clients" });
    }
  });

  app.get("/api/admin/clients/:id", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) return res.status(404).json({ error: "Client not found" });
      res.json({ client });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load client" });
    }
  });

  app.post("/api/admin/provision", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const parsed = provisionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      }

      const { clientName, machineName, industryConfig, territory, decisionMakerFocus, userEmail, userPassword, userRole } = parsed.data;

      const existingUser = await storage.getUserByEmail(userEmail.toLowerCase());
      if (existingUser) {
        return res.status(409).json({ error: "User with this email already exists" });
      }

      const client = await storage.createClient({
        clientName,
        machineName,
        industryConfig,
        territory,
        decisionMakerFocus,
        status: "active",
        airtableBaseId: null,
      });

      const hashedPw = await hashPassword(userPassword);
      const user = await storage.createUser({
        username: userEmail.toLowerCase(),
        email: userEmail.toLowerCase(),
        password: hashedPw,
        role: userRole,
        clientId: client.id,
      });

      await storage.upsertClientConfig({ clientId: client.id });

      log(`Provisioned client: ${clientName} (${client.id}) with user ${userEmail}`, "admin");

      res.json({
        success: true,
        client,
        user: { id: user.id, email: user.email, role: user.role, clientId: user.clientId },
      });
    } catch (err: any) {
      log(`Provision error: ${err.message}`, "admin");
      res.status(500).json({ error: "Failed to provision client" });
    }
  });

  app.get("/api/admin/runs", authMiddleware, requireRole("platform_admin"), async (_req: Request, res: Response) => {
    try {
      const history = getHistory();
      res.json({ runs: history });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load runs" });
    }
  });

  app.get("/api/admin/stats", authMiddleware, requireRole("platform_admin"), async (_req: Request, res: Response) => {
    try {
      const clients = await storage.getAllClients();
      const history = getHistory();
      const activeClients = clients.filter(c => c.status === "active").length;
      const recentRuns = history.slice(0, 10);
      const failedToday = history.filter(r => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return r.status === "error" && r.started_at >= today.getTime();
      }).length;

      res.json({
        totalClients: clients.length,
        activeClients,
        totalRuns: history.length,
        recentRuns,
        failedRunsToday: failedToday,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load stats" });
    }
  });

  app.get("/api/admin/clients/:id/usage", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const since = req.query.since ? new Date(req.query.since as string) : undefined;
      const summary = await getUsageSummary(req.params.id, since);
      const config = await storage.getClientConfig(req.params.id);
      res.json({ ...summary, limits: config || null });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load usage" });
    }
  });

  app.get("/api/admin/clients/:id/users", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const users = await storage.getUsersByClientId(req.params.id);
      res.json({ users: users.map(u => ({ id: u.id, email: u.email, role: u.role, clientId: u.clientId })) });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load users" });
    }
  });

  app.post("/api/admin/clients/:id/run", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const clientId = req.params.id;
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });

      const run_id = startDailyRun({ clientId, top: req.body?.top || 25 });
      res.json({ run_id, clientId });
    } catch (err: any) {
      if (err instanceof RunAlreadyActiveError) {
        return res.status(409).json({ error: "RUN_ALREADY_ACTIVE" });
      }
      res.status(500).json({ error: "Failed to start run" });
    }
  });

  app.post("/api/admin/clients/:id/users", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const clientId = req.params.id;
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });

      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(6),
        role: z.enum(["client_admin", "operator", "manager"]).default("operator"),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      }

      const { email, password, role } = parsed.data;
      const existingUser = await storage.getUserByEmail(email.toLowerCase());
      if (existingUser) {
        return res.status(409).json({ error: "A user with this email already exists" });
      }

      const hashedPw = await hashPassword(password);
      const user = await storage.createUser({
        username: email.toLowerCase(),
        email: email.toLowerCase(),
        password: hashedPw,
        role,
        clientId,
      });

      log(`Added user ${email} (${role}) to client ${client.clientName}`, "admin");
      res.json({ success: true, user: { id: user.id, email: user.email, role: user.role, clientId: user.clientId } });
    } catch (err: any) {
      log(`Add user error: ${err.message}`, "admin");
      res.status(500).json({ error: "Failed to add user" });
    }
  });

  app.get("/api/admin/clients/:id/email-settings", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const clientId = req.params.id;
      const [settings] = await db
        .select({
          fromName: clientEmailSettings.fromName,
          fromEmail: clientEmailSettings.fromEmail,
          smtpHost: clientEmailSettings.smtpHost,
          smtpUser: clientEmailSettings.smtpUser,
          providerType: clientEmailSettings.providerType,
          dailyLimit: clientEmailSettings.dailyLimit,
          autoSendEnabled: clientEmailSettings.autoSendEnabled,
        })
        .from(clientEmailSettings)
        .where(eq(clientEmailSettings.clientId, clientId));

      res.json({ settings: settings || null });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load email settings" });
    }
  });

  app.patch("/api/admin/users/:id", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const { email, role } = req.body || {};
      const updates: Record<string, any> = {};
      if (typeof email === "string" && email.trim()) {
        if (!email.includes("@") || !email.includes(".")) {
          return res.status(400).json({ error: "Invalid email format" });
        }
        updates.email = email.toLowerCase().trim();
        updates.username = email.toLowerCase().trim();
      }
      if (typeof role === "string" && ["operator", "manager", "platform_admin"].includes(role)) {
        updates.role = role;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      const updated = await storage.updateUser(req.params.id, updates);
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json({ success: true, user: { id: updated.id, email: updated.email, role: updated.role, clientId: updated.clientId } });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.patch("/api/admin/clients/:id", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) return res.status(404).json({ error: "Client not found" });
      const body = req.body || {};
      const updates: Record<string, any> = {};
      if (typeof body.clientName === "string") updates.clientName = body.clientName;
      if (typeof body.machineName === "string") updates.machineName = body.machineName;
      if (typeof body.territory === "string") updates.territory = body.territory;
      if (typeof body.status === "string" && ["active", "paused", "inactive"].includes(body.status)) updates.status = body.status;
      if (typeof body.industryConfig === "string") updates.industryConfig = body.industryConfig;
      if (typeof body.decisionMakerFocus === "string") updates.decisionMakerFocus = body.decisionMakerFocus;
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      const updated = await storage.updateClient(req.params.id, updates);
      res.json({ success: true, client: updated });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update client" });
    }
  });

  app.post("/api/admin/users/:id/reset-password", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const { newPassword } = req.body || {};
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      const hashedPw = await hashPassword(newPassword);
      const updated = await storage.updateUser(req.params.id, { password: hashedPw });
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  app.put("/api/admin/clients/:id/config", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const clientId = req.params.id;
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });

      const config = await storage.upsertClientConfig({ clientId, ...req.body });
      res.json({ config });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update config" });
    }
  });

  app.get("/api/admin/clients/:id/export/:type", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const { id, type } = req.params;
      const client = await storage.getClient(id);
      if (!client) return res.status(404).json({ error: "Client not found" });

      const validTypes = ["companies", "calls", "decision_makers", "opportunities", "queries"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
      }

      const csv = await exportTableCSV(id, type);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${client.clientName}_${type}.csv"`);
      res.send(csv);
    } catch (err: any) {
      log(`Export error: ${err.message}`, "admin");
      res.status(500).json({ error: "Export failed" });
    }
  });

  app.get("/api/export/:type", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(400).json({ error: "Client context required" });

      const { type } = req.params;
      const validTypes = ["companies", "calls", "decision_makers", "opportunities", "queries"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
      }

      const csv = await exportTableCSV(clientId, type);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${type}_export.csv"`);
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ error: "Export failed" });
    }
  });

  app.get("/api/admin/clients/:id/health", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const clientId = req.params.id;
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });

      const history = getHistory(clientId);
      const lastRun = history.length > 0 ? history[0] : null;
      const lastSuccess = history.find(r => r.status === "completed");
      const lastFailed = history.find(r => r.status === "error");
      const recentErrors = history.slice(0, 5).flatMap(r => r.errors || []);

      res.json({
        clientId,
        clientName: client.clientName,
        status: client.status,
        lastRunStatus: lastRun?.status || null,
        lastRunAt: lastRun?.started_at || null,
        lastSuccessAt: lastSuccess?.started_at || null,
        lastFailedAt: lastFailed?.started_at || null,
        lastFailedStep: lastFailed?.steps?.find(s => s.status === "error")?.step || null,
        recentErrors: recentErrors.slice(0, 10),
        totalRuns: history.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to compute health" });
    }
  });

  app.post("/api/admin/clients/:id/migrate", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const clientId = req.params.id;
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });

      log(`Starting data migration for client ${clientId} (${client.clientName})`, "admin");
      const results = await migrateClientData(clientId);
      res.json({ success: true, results });
    } catch (err: any) {
      log(`Migration error: ${err.message}`, "admin");
      res.status(500).json({ error: "Migration failed", message: err.message });
    }
  });

  app.get("/api/admin/platform-insights", authMiddleware, requireRole("platform_admin"), async (req: Request, res: Response) => {
    try {
      const industry = req.query.industry as string | undefined;
      const insights = await storage.getPlatformInsights(industry);
      res.json({ insights });
    } catch (err: any) {
      log(`Platform insights fetch error: ${err.message}`, "admin");
      res.status(500).json({ error: "Failed to load platform insights" });
    }
  });

  app.post("/api/admin/platform-insights/aggregate", authMiddleware, requireRole("platform_admin"), async (_req: Request, res: Response) => {
    try {
      const result = await aggregatePlatformInsights();
      res.json({ success: true, ...result });
    } catch (err: any) {
      log(`Platform insights aggregation error: ${err.message}`, "admin");
      res.status(500).json({ error: "Aggregation failed", message: err.message });
    }
  });

  app.get("/api/admin/scheduler", authMiddleware, requireRole("platform_admin"), (_req: Request, res: Response) => {
    res.json(getSchedulerStatus());
  });

  app.post("/api/admin/scheduler/start", authMiddleware, requireRole("platform_admin"), (req: Request, res: Response) => {
    const intervalHours = req.body?.intervalHours;
    const intervalMs = intervalHours ? Math.max(intervalHours * 60 * 60 * 1000, 60 * 60 * 1000) : undefined;
    startScheduler(intervalMs);
    res.json({ success: true, ...getSchedulerStatus() });
  });

  app.post("/api/admin/scheduler/stop", authMiddleware, requireRole("platform_admin"), (_req: Request, res: Response) => {
    stopScheduler();
    res.json({ success: true, ...getSchedulerStatus() });
  });

  app.get("/api/admin/campaign-overview", authMiddleware, requireRole("platform_admin"), async (_req: Request, res: Response) => {
    try {
      const clients = await storage.getAllClients();
      const activeClients = clients.filter(c => c.status === "active");

      const campaigns = [];
      for (const client of activeClients) {
        const pipelines = await db.select().from(outreachPipeline).where(eq(outreachPipeline.clientId, client.id));
        const templates = await db.select().from(emailTemplates).where(eq(emailTemplates.clientId, client.id));

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart.getTime() + 86400000);
        const stats = {
          totalLeads: pipelines.length,
          active: 0,
          completed: 0,
          responded: 0,
          notInterested: 0,
          dueToday: 0,
          touchStages: { not_contacted: 0, touch_1: 0, touch_2: 0, touch_3: 0, touch_4: 0, touch_5: 0, touch_6: 0 },
          templateCount: templates.length,
        };

        for (const p of pipelines) {
          if (p.pipelineStatus === "ACTIVE") stats.active++;
          else if (p.pipelineStatus === "COMPLETED") stats.completed++;
          else if (p.pipelineStatus === "RESPONDED") stats.responded++;
          else if (p.pipelineStatus === "NOT_INTERESTED") stats.notInterested++;

          const touchDate = new Date(p.nextTouchDate);
          if (p.pipelineStatus === "ACTIVE" && touchDate >= todayStart && touchDate < todayEnd) stats.dueToday++;

          const tc = p.touchesCompleted;
          if (tc === 0) stats.touchStages.not_contacted++;
          else if (tc === 1) stats.touchStages.touch_1++;
          else if (tc === 2) stats.touchStages.touch_2++;
          else if (tc === 3) stats.touchStages.touch_3++;
          else if (tc === 4) stats.touchStages.touch_4++;
          else if (tc === 5) stats.touchStages.touch_5++;
          else if (tc >= 6) stats.touchStages.touch_6++;
        }

        campaigns.push({
          clientId: client.id,
          clientName: client.clientName,
          machineName: client.machineName,
          industryConfig: client.industryConfig,
          territory: client.territory,
          status: client.status,
          ...stats,
        });
      }

      res.json({ campaigns });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
