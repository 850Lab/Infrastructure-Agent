import type { Express, Request, Response } from "express";
import { sendSms, initiateCall, getCallStatus, isTwilioConnected, listRecentCalls, listRecentMessages } from "./twilio-service";

const log = (msg: string) => {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [twilio-routes] ${msg}`);
};

export function registerTwilioRoutes(app: Express, authMiddleware: any) {
  app.get("/api/twilio/status", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const connected = await isTwilioConnected();
      res.json({ connected });
    } catch (err: any) {
      res.json({ connected: false, error: err.message });
    }
  });

  app.post("/api/twilio/sms", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { to, body } = req.body;
      if (!to || !body) {
        return res.status(400).json({ error: "Both 'to' phone number and 'body' message are required" });
      }
      if (typeof body !== "string" || body.length > 1600) {
        return res.status(400).json({ error: "Message body must be a string under 1600 characters" });
      }

      const result = await sendSms(to, body);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      log(`SMS sent by user to ${to}`);
      res.json({ ok: true, sid: result.sid });
    } catch (err: any) {
      log(`SMS route error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/twilio/call", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { to } = req.body;
      if (!to) {
        return res.status(400).json({ error: "Phone number 'to' is required" });
      }

      const result = await initiateCall(to);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      log(`Call initiated by user to ${to}`);
      res.json({ ok: true, sid: result.sid });
    } catch (err: any) {
      log(`Call route error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/call/:sid", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { sid } = req.params;
      const status = await getCallStatus(sid);
      if (!status) {
        return res.status(404).json({ error: "Call not found" });
      }
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/calls", authMiddleware, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const calls = await listRecentCalls(limit);
      res.json(calls);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/twilio/messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const messages = await listRecentMessages(limit);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  log("Twilio routes registered");
}
