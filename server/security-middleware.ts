import type { NextFunction, Request, Response } from "express";

type AttemptWindow = { count: number; resetAt: number };

const loginAttempts = new Map<string, AttemptWindow>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 10;

function requestKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (firstForwarded || req.ip || "unknown").trim();
}

/**
 * Basic single-process protection for the existing login endpoint.
 * Replace with an edge or shared-store limiter before horizontal scaling.
 */
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = requestKey(req);
  const current = loginAttempts.get(key);
  const window = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + LOGIN_WINDOW_MS }
    : current;

  window.count += 1;
  loginAttempts.set(key, window);

  res.setHeader("X-RateLimit-Limit", String(LOGIN_ATTEMPT_LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, LOGIN_ATTEMPT_LIMIT - window.count)));

  if (window.count > LOGIN_ATTEMPT_LIMIT) {
    res.setHeader("Retry-After", String(Math.ceil((window.resetAt - now) / 1000)));
    res.status(429).json({ error: "Too many login attempts. Please try again later." });
    return;
  }

  next();
}

/** Prevent browsers and intermediary caches from retaining credit API data. */
export function sensitiveNoStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}
