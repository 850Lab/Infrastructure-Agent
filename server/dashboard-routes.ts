import type { Express, Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { eventBus } from "./events";
import { startDailyRun, RunAlreadyActiveError } from "./run-daily-web";
import { getHistory, getRunById } from "./run-history";
import { log } from "./logger";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

interface TokenEntry {
  token: string;
  expires_at: number;
}

const tokens: Map<string, TokenEntry> = new Map();
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function createToken(): { token: string; expires_in: number } {
  const token = randomUUID();
  tokens.set(token, { token, expires_at: Date.now() + TOKEN_TTL_MS });
  return { token, expires_in: TOKEN_TTL_MS / 1000 };
}

function validateToken(token: string): boolean {
  const entry = tokens.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expires_at) {
    tokens.delete(token);
    return false;
  }
  return true;
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (validateToken(token)) {
      return next();
    }
  }
  res.status(401).json({ error: "Unauthorized" });
}

async function airtableCount(formula: string): Promise<number | null> {
  try {
    const key = AIRTABLE_API_KEY();
    const base = AIRTABLE_BASE_ID();
    if (!key || !base) return null;

    let count = 0;
    let offset: string | undefined;

    do {
      const params = new URLSearchParams({
        filterByFormula: formula,
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

export function registerDashboardRoutes(app: Express): void {
  app.post("/api/auth/login", (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      return res.status(500).json({ error: "Auth not configured" });
    }

    if (email?.toLowerCase() === adminEmail?.toLowerCase() && password === adminPassword) {
      const tokenData = createToken();
      log(`Login successful for ${email}`, "auth");
      return res.json(tokenData);
    }

    res.status(401).json({ error: "Invalid credentials" });
  });

  app.get("/api/events", (req: Request, res: Response) => {
    const token = req.query.token as string | undefined;
    if (!token || !validateToken(token)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const recent = eventBus.getRecentEvents(50);
    for (const event of recent) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    }

    eventBus.subscribe(res);

    const heartbeatInterval = setInterval(() => {
      try {
        eventBus.publish("HEARTBEAT", { ts: Date.now() });
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeatInterval);
      eventBus.unsubscribe(res);
    });
  });

  app.post("/api/run-daily", authMiddleware, (_req: Request, res: Response) => {
    try {
      const run_id = startDailyRun();
      res.json({ run_id });
    } catch (err) {
      if (err instanceof RunAlreadyActiveError) {
        return res.status(409).json({ error: "RUN_ALREADY_ACTIVE" });
      }
      res.status(500).json({ error: "Failed to start run" });
    }
  });

  app.get("/api/run-history", authMiddleware, (_req: Request, res: Response) => {
    res.json(getHistory());
  });

  app.get("/api/run-history/:run_id", authMiddleware, (req: Request, res: Response) => {
    const run = getRunById(req.params.run_id);
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }
    res.json(run);
  });

  app.get("/api/dashboard/stats", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const [today_list_count, dm_resolved_count, playbooks_ready_count, fresh_pool_count] = await Promise.all([
        airtableCount("{Today_Call_List}=TRUE()"),
        airtableCount("AND({Today_Call_List}=TRUE(),{Offer_DM_Name}!='')"),
        airtableCount("AND({Today_Call_List}=TRUE(),{Playbook_Version}!='')"),
        airtableCount("OR({Times_Called}=0,{Lead_Status}='New')"),
      ]);

      const history = getHistory();
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
}
