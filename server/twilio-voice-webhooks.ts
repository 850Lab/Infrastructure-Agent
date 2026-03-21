/**
 * Twilio Voice TwiML webhooks for AI Call Bot bidirectional media.
 * Mounted from server/index.ts immediately after body parsers so they always
 * win over any SPA / Vite catch-all (see vite.ts / static.ts).
 */
import type { Express, Request, Response } from "express";
import twilio from "twilio";
import { normalizePhone, twilioXmlAttrEscape } from "./twilio-service";

const log = (msg: string) => {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [twilio-voice-webhooks] ${msg}`);
};

function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}`;
}

/** Optional: ?verifyKey= matches CALLCENTER_TWILIO_WEBHOOK_VERIFY_KEY → skip signature (curl / staging only). */
function isWebhookVerifyBypass(req: Request): boolean {
  const key = process.env.CALLCENTER_TWILIO_WEBHOOK_VERIFY_KEY;
  if (!key || key.length < 8) return false;
  return String(req.query.verifyKey || "") === key;
}

function assertValidTwilioVoiceWebhook(req: Request, res: Response): boolean {
  if (isWebhookVerifyBypass(req)) {
    log(`twilio_voice_webhook_verify_bypass path=${req.path} (CALLCENTER_TWILIO_WEBHOOK_VERIFY_KEY)`);
    return true;
  }
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    log("TwiML webhook: TWILIO_AUTH_TOKEN unset — accepting (set token in production for signature validation)");
    return true;
  }
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature) {
    res.status(403).type("text/plain").send("Forbidden");
    return false;
  }
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  const fullUrl = `${proto}://${host}${req.originalUrl}`;
  const ok = twilio.validateRequest(authToken, signature, fullUrl, req.body);
  if (!ok) {
    log(`TwiML webhook: invalid signature for ${fullUrl}`);
    res.status(403).type("text/plain").send("Forbidden");
    return false;
  }
  return true;
}

export function registerTwilioVoiceTwiMlWebhooks(app: Express): void {
  app.post("/api/twilio/webhook/coaching-outbound-twiml", async (req: Request, res: Response) => {
    log(
      `HIT coaching-outbound-twiml method=${req.method} path=${req.path} originalUrl=${req.originalUrl} contentType=${String(req.headers["content-type"] || "")}`
    );
    try {
      if (!assertValidTwilioVoiceWebhook(req, res)) return;

      if (isWebhookVerifyBypass(req)) {
        res
          .type("text/xml")
          .send(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Callcenter Twilio webhook reachability OK. Coaching outbound.</Say></Response>`
          );
        return;
      }

      const CallSid = req.body.CallSid as string | undefined;
      const From = req.body.From as string | undefined;
      const leadE164 = String(req.query.leadE164 || "");
      const streamWss = String(req.query.streamWss || "");
      const baseUrl = getBaseUrl(req);
      if (!CallSid || !From || !normalizePhone(leadE164) || (!streamWss.startsWith("wss://") && !streamWss.startsWith("ws://"))) {
        log(`coaching-outbound-twiml: invalid params sid=${CallSid} lead=${leadE164}`);
        res.type("text/xml").status(400).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Invalid request.</Say></Response>`);
        return;
      }
      const leadNorm = normalizePhone(leadE164)!;
      const leadBidiUrl =
        `${baseUrl}/api/twilio/webhook/lead-bidi-stream?` +
        new URLSearchParams({
          parentCallSid: CallSid,
          streamWss,
        }).toString();
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting your call now.</Say>
  <Dial record="record-from-answer-dual" callerId="${twilioXmlAttrEscape(From)}">
    <Number url="${twilioXmlAttrEscape(leadBidiUrl)}">${leadNorm}</Number>
  </Dial>
</Response>`;
      log(`coaching-outbound-twiml: parent=${CallSid} lead=${leadNorm}`);
      res.type("text/xml").send(xml);
    } catch (err: any) {
      log(`coaching-outbound-twiml error: ${err.message}`);
      res.type("text/xml").status(500).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }
  });

  app.post("/api/twilio/webhook/lead-bidi-stream", async (req: Request, res: Response) => {
    log(
      `HIT lead-bidi-stream method=${req.method} path=${req.path} originalUrl=${req.originalUrl} contentType=${String(req.headers["content-type"] || "")}`
    );
    try {
      if (!assertValidTwilioVoiceWebhook(req, res)) return;

      if (isWebhookVerifyBypass(req)) {
        res
          .type("text/xml")
          .send(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Callcenter Twilio webhook reachability OK. Lead bidirectional stream.</Say></Response>`
          );
        return;
      }

      const parentCallSid = String(req.query.parentCallSid || "");
      const streamWss = String(req.query.streamWss || "");
      if (!parentCallSid.startsWith("CA") || (!streamWss.startsWith("wss://") && !streamWss.startsWith("ws://"))) {
        res.type("text/xml").status(400).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
        return;
      }
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${twilioXmlAttrEscape(streamWss)}">
      <Parameter name="leg" value="child"/>
      <Parameter name="parentCallSid" value="${twilioXmlAttrEscape(parentCallSid)}"/>
    </Stream>
  </Connect>
</Response>`;
      log(`lead-bidi-stream TwiML parentCallSid=${parentCallSid}`);
      res.type("text/xml").send(xml);
    } catch (err: any) {
      log(`lead-bidi-stream error: ${err.message}`);
      res.type("text/xml").status(500).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }
  });
}
