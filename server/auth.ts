import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { log } from "./logger";

interface TokenEntry {
  token: string;
  expires_at: number;
  email: string;
  role: string;
  clientId: string | null;
}

const tokens: Map<string, TokenEntry> = new Map();
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function createToken(email: string, role: string, clientId: string | null): { token: string; expires_in: number; role: string; client_id: string | null } {
  const token = randomUUID();
  tokens.set(token, { token, expires_at: Date.now() + TOKEN_TTL_MS, email, role, clientId });
  return { token, expires_in: TOKEN_TTL_MS / 1000, role, client_id: clientId };
}

export function validateToken(token: string): boolean {
  const entry = tokens.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expires_at) {
    tokens.delete(token);
    return false;
  }
  return true;
}

export function getTokenEntry(token: string): TokenEntry | null {
  const entry = tokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expires_at) {
    tokens.delete(token);
    return null;
  }
  return entry;
}

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

export function getEmailFromToken(token: string): string | null {
  const entry = getTokenEntry(token);
  return entry?.email || null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token && validateToken(token)) {
    const entry = getTokenEntry(token);
    if (entry) {
      let effectiveClientId = entry.clientId;
      if (entry.role === "platform_admin" && !effectiveClientId) {
        const override = req.query.clientId as string | undefined;
        if (override) effectiveClientId = override;
      }
      (req as any).user = {
        email: entry.email,
        role: entry.role,
        clientId: effectiveClientId,
      };
      return next();
    }
  }
  res.status(401).json({ error: "Unauthorized" });
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

const PERMISSIONS: Record<string, string[]> = {
  platform_admin: ["view_machine", "run_pipeline", "edit_settings", "manage_users", "provision", "export_data", "view_admin"],
  client_admin: ["view_machine", "run_pipeline", "edit_settings", "manage_operators", "export_data"],
  operator: ["view_machine", "run_pipeline", "export_data"],
};

export function getPermissions(role: string): string[] {
  return PERMISSIONS[role] || [];
}

export function requirePermission(...perms: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const userPerms = getPermissions(user.role);
    const hasAll = perms.every(p => userPerms.includes(p));
    if (!hasAll) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export async function seedPlatformAdmin(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    log("ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed", "auth");
    return;
  }

  const existing = await storage.getUserByEmail(adminEmail.toLowerCase());
  if (existing) {
    log(`Platform admin already exists: ${adminEmail}`, "auth");
    return;
  }

  const hashedPw = await hashPassword(adminPassword);
  await storage.createUser({
    username: adminEmail.toLowerCase(),
    email: adminEmail.toLowerCase(),
    password: hashedPw,
    role: "platform_admin",
    clientId: null,
  });
  log(`Platform admin seeded: ${adminEmail}`, "auth");
}
