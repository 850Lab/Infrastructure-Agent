import type { Express, Request, Response } from "express";
import { db } from "./db";
import { hubspotTokens } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authMiddleware } from "./auth";
import { log } from "./logger";

const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "";
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || "";

const SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
].join(" ");

function getRedirectUri(req: Request): string {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}/api/hubspot/callback`;
}

async function refreshAccessToken(clientId: string): Promise<string | null> {
  const [token] = await db.select().from(hubspotTokens).where(eq(hubspotTokens.clientId, clientId)).limit(1);
  if (!token) return null;

  if (new Date(token.expiresAt) > new Date(Date.now() + 5 * 60 * 1000)) {
    return token.accessToken;
  }

  log(`Refreshing HubSpot token for client ${clientId}`, "hubspot");

  const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: HUBSPOT_CLIENT_ID,
      client_secret: HUBSPOT_CLIENT_SECRET,
      refresh_token: token.refreshToken,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    log(`HubSpot token refresh failed: ${err}`, "hubspot");
    return null;
  }

  const data = await resp.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await db.update(hubspotTokens)
    .set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || token.refreshToken,
      expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(hubspotTokens.clientId, clientId));

  return data.access_token;
}

async function hubspotApi(clientId: string, path: string, options: RequestInit = {}): Promise<any> {
  const accessToken = await refreshAccessToken(clientId);
  if (!accessToken) throw new Error("HubSpot not connected");

  const url = `https://api.hubapi.com${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`HubSpot API error ${resp.status}: ${err}`);
  }

  return resp.json();
}

export function registerHubspotRoutes(app: Express) {
  app.get("/api/hubspot/auth", authMiddleware, (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    if (!clientId) return res.status(400).json({ error: "Client context required" });

    if (!HUBSPOT_CLIENT_ID) {
      return res.status(500).json({ error: "HubSpot OAuth not configured" });
    }

    const redirectUri = getRedirectUri(req);
    const state = clientId;
    const url = `https://app.hubspot.com/oauth/authorize?client_id=${encodeURIComponent(HUBSPOT_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}&state=${encodeURIComponent(state)}`;

    log(`HubSpot OAuth initiated for client ${clientId}, redirect: ${redirectUri}`, "hubspot");
    res.json({ url });
  });

  app.get("/api/hubspot/callback", async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send("Missing code or state parameter");
    }

    const clientId = String(state);
    const redirectUri = getRedirectUri(req);

    try {
      const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: HUBSPOT_CLIENT_ID,
          client_secret: HUBSPOT_CLIENT_SECRET,
          redirect_uri: redirectUri,
          code: String(code),
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        log(`HubSpot token exchange failed: ${err}`, "hubspot");
        return res.status(400).send(`HubSpot authorization failed: ${err}`);
      }

      const data = await resp.json();
      const expiresAt = new Date(Date.now() + data.expires_in * 1000);

      let hubId: string | null = null;
      try {
        const tokenInfo = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${data.access_token}`);
        if (tokenInfo.ok) {
          const info = await tokenInfo.json();
          hubId = String(info.hub_id || "");
        }
      } catch {}

      const existing = await db.select().from(hubspotTokens).where(eq(hubspotTokens.clientId, clientId)).limit(1);
      if (existing.length > 0) {
        await db.update(hubspotTokens)
          .set({
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt,
            hubId,
            updatedAt: new Date(),
          })
          .where(eq(hubspotTokens.clientId, clientId));
      } else {
        await db.insert(hubspotTokens).values({
          clientId,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt,
          hubId,
        });
      }

      log(`HubSpot connected for client ${clientId} (hub: ${hubId})`, "hubspot");
      res.redirect("/machine/settings?hubspot=connected");
    } catch (err: any) {
      log(`HubSpot callback error: ${err.message}`, "hubspot");
      res.redirect("/machine/settings?hubspot=error");
    }
  });

  app.get("/api/hubspot/status", authMiddleware, async (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    if (!clientId) return res.json({ connected: false });

    const [token] = await db.select().from(hubspotTokens).where(eq(hubspotTokens.clientId, clientId)).limit(1);
    if (!token) return res.json({ connected: false });

    res.json({
      connected: true,
      hubId: token.hubId,
      connectedAt: token.createdAt,
      lastRefreshed: token.updatedAt,
    });
  });

  app.post("/api/hubspot/disconnect", authMiddleware, async (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    if (!clientId) return res.status(400).json({ error: "Client context required" });

    await db.delete(hubspotTokens).where(eq(hubspotTokens.clientId, clientId));
    log(`HubSpot disconnected for client ${clientId}`, "hubspot");
    res.json({ ok: true });
  });

  app.get("/api/hubspot/contacts", authMiddleware, async (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    if (!clientId) return res.status(400).json({ error: "Client context required" });

    try {
      const limit = Math.min(parseInt(String(req.query.limit || "50")), 100);
      const after = req.query.after ? String(req.query.after) : undefined;

      let path = `/crm/v3/objects/contacts?limit=${limit}&properties=firstname,lastname,email,phone,company,jobtitle,lifecyclestage`;
      if (after) path += `&after=${after}`;

      const data = await hubspotApi(clientId, path);
      res.json({
        ok: true,
        contacts: data.results || [],
        paging: data.paging || null,
        total: data.total || data.results?.length || 0,
      });
    } catch (err: any) {
      log(`HubSpot contacts fetch error: ${err.message}`, "hubspot");
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/hubspot/companies", authMiddleware, async (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    if (!clientId) return res.status(400).json({ error: "Client context required" });

    try {
      const limit = Math.min(parseInt(String(req.query.limit || "50")), 100);
      const data = await hubspotApi(clientId, `/crm/v3/objects/companies?limit=${limit}&properties=name,domain,phone,city,state,industry,numberofemployees`);
      res.json({
        ok: true,
        companies: data.results || [],
        total: data.total || data.results?.length || 0,
      });
    } catch (err: any) {
      log(`HubSpot companies fetch error: ${err.message}`, "hubspot");
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/hubspot/deals", authMiddleware, async (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    if (!clientId) return res.status(400).json({ error: "Client context required" });

    try {
      const limit = Math.min(parseInt(String(req.query.limit || "50")), 100);
      const data = await hubspotApi(clientId, `/crm/v3/objects/deals?limit=${limit}&properties=dealname,amount,dealstage,pipeline,closedate,hubspot_owner_id`);
      res.json({
        ok: true,
        deals: data.results || [],
        total: data.total || data.results?.length || 0,
      });
    } catch (err: any) {
      log(`HubSpot deals fetch error: ${err.message}`, "hubspot");
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/hubspot/deals", authMiddleware, async (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    if (!clientId) return res.status(400).json({ error: "Client context required" });

    try {
      const { dealname, amount, dealstage, pipeline, closedate } = req.body;
      if (!dealname) return res.status(400).json({ error: "Deal name is required" });

      const properties: Record<string, string> = { dealname };
      if (amount) properties.amount = String(amount);
      if (dealstage) properties.dealstage = dealstage;
      if (pipeline) properties.pipeline = pipeline;
      if (closedate) properties.closedate = closedate;

      const data = await hubspotApi(clientId, "/crm/v3/objects/deals", {
        method: "POST",
        body: JSON.stringify({ properties }),
      });

      log(`HubSpot deal created: ${dealname} for client ${clientId}`, "hubspot");
      res.json({ ok: true, deal: data });
    } catch (err: any) {
      log(`HubSpot deal creation error: ${err.message}`, "hubspot");
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/hubspot/contacts", authMiddleware, async (req: Request, res: Response) => {
    const clientId = (req as any).user?.clientId;
    if (!clientId) return res.status(400).json({ error: "Client context required" });

    try {
      const { firstname, lastname, email, phone, company, jobtitle } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

      const properties: Record<string, string> = { email };
      if (firstname) properties.firstname = firstname;
      if (lastname) properties.lastname = lastname;
      if (phone) properties.phone = phone;
      if (company) properties.company = company;
      if (jobtitle) properties.jobtitle = jobtitle;

      const data = await hubspotApi(clientId, "/crm/v3/objects/contacts", {
        method: "POST",
        body: JSON.stringify({ properties }),
      });

      log(`HubSpot contact created: ${email} for client ${clientId}`, "hubspot");
      res.json({ ok: true, contact: data });
    } catch (err: any) {
      log(`HubSpot contact creation error: ${err.message}`, "hubspot");
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
