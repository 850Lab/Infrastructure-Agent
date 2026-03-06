import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { log } from "./logger";

export interface ClientContext {
  clientId: string;
  clientName: string;
  machineName: string;
  industryConfig: string;
  territory: string;
  decisionMakerFocus: string;
}

export function clientContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const clientId = (req.query.client_id as string) || user.clientId;

  if (user.role === "platform_admin" && !clientId) {
    return next();
  }

  if (!clientId) {
    res.status(400).json({ error: "No client context" });
    return;
  }

  if (user.role !== "platform_admin" && clientId !== user.clientId) {
    res.status(403).json({ error: "Cannot access other client data" });
    return;
  }

  storage.getClient(clientId).then(client => {
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    (req as any).clientContext = {
      clientId: client.id,
      clientName: client.clientName,
      machineName: client.machineName,
      industryConfig: client.industryConfig,
      territory: client.territory,
      decisionMakerFocus: client.decisionMakerFocus,
    } as ClientContext;
    next();
  }).catch(err => {
    log(`Client context error: ${err.message}`, "client-context");
    res.status(500).json({ error: "Failed to load client context" });
  });
}
