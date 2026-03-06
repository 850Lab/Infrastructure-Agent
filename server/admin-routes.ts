import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireRole, hashPassword } from "./auth";
import { storage } from "./storage";
import { getHistory } from "./run-history";
import { log } from "./logger";

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

      res.json({
        totalClients: clients.length,
        activeClients,
        totalRuns: history.length,
        recentRuns,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load stats" });
    }
  });
}
