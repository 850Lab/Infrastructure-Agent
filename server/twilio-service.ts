import twilio from "twilio";
import type { Twilio } from "twilio";

const log = (msg: string) => {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [twilio] ${msg}`);
};

interface TwilioCredentials {
  accountSid: string;
  apiKey: string;
  apiKeySecret: string;
  phoneNumber: string;
}

let cachedCredentials: TwilioCredentials | null = null;
let cachedClient: Twilio | null = null;
let credentialsFetchedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getCredentials(): Promise<TwilioCredentials> {
  if (cachedCredentials && Date.now() - credentialsFetchedAt < CACHE_TTL) {
    return cachedCredentials;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error("Twilio: X-Replit-Token not found");
  }

  const connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=twilio",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    }
  )
    .then((res) => res.json())
    .then((data) => data.items?.[0]);

  if (
    !connectionSettings ||
    !connectionSettings.settings.account_sid ||
    !connectionSettings.settings.api_key ||
    !connectionSettings.settings.api_key_secret
  ) {
    throw new Error("Twilio not connected — missing credentials");
  }

  cachedCredentials = {
    accountSid: connectionSettings.settings.account_sid,
    apiKey: connectionSettings.settings.api_key,
    apiKeySecret: connectionSettings.settings.api_key_secret,
    phoneNumber: connectionSettings.settings.phone_number || "",
  };
  credentialsFetchedAt = Date.now();
  log("Credentials loaded successfully");
  return cachedCredentials;
}

export async function getTwilioClient(): Promise<Twilio> {
  if (cachedClient && cachedCredentials && Date.now() - credentialsFetchedAt < CACHE_TTL) {
    return cachedClient;
  }
  const creds = await getCredentials();
  cachedClient = twilio(creds.apiKey, creds.apiKeySecret, {
    accountSid: creds.accountSid,
  });
  return cachedClient;
}

export async function getTwilioFromNumber(): Promise<string> {
  const creds = await getCredentials();
  return creds.phoneNumber;
}

export async function isTwilioConnected(): Promise<boolean> {
  try {
    await getCredentials();
    return true;
  } catch {
    return false;
  }
}

export async function sendSms(to: string, body: string): Promise<{ success: boolean; sid?: string; error?: string }> {
  try {
    const client = await getTwilioClient();
    const from = await getTwilioFromNumber();
    if (!from) {
      return { success: false, error: "No Twilio phone number configured" };
    }

    const normalized = normalizePhone(to);
    if (!normalized) {
      return { success: false, error: "Invalid phone number" };
    }

    const message = await client.messages.create({
      to: normalized,
      from,
      body,
    });

    log(`SMS sent to ${normalized} (SID: ${message.sid})`);
    return { success: true, sid: message.sid };
  } catch (err: any) {
    log(`SMS error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function initiateCall(
  to: string,
  statusCallbackUrl?: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  try {
    const client = await getTwilioClient();
    const from = await getTwilioFromNumber();
    if (!from) {
      return { success: false, error: "No Twilio phone number configured" };
    }

    const normalized = normalizePhone(to);
    if (!normalized) {
      return { success: false, error: "Invalid phone number" };
    }

    const callParams: any = {
      to: normalized,
      from,
      twiml: `<Response><Say>Connecting your call through Texas Automation Systems.</Say><Dial>${normalized}</Dial></Response>`,
    };

    if (statusCallbackUrl) {
      callParams.statusCallback = statusCallbackUrl;
      callParams.statusCallbackEvent = ["initiated", "ringing", "answered", "completed"];
      callParams.statusCallbackMethod = "POST";
    }

    const call = await client.calls.create(callParams);
    log(`Call initiated to ${normalized} (SID: ${call.sid})`);
    return { success: true, sid: call.sid };
  } catch (err: any) {
    log(`Call error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function getCallStatus(callSid: string): Promise<any> {
  try {
    const client = await getTwilioClient();
    const call = await client.calls(callSid).fetch();
    return {
      sid: call.sid,
      status: call.status,
      duration: call.duration,
      direction: call.direction,
      from: call.from,
      to: call.to,
      startTime: call.startTime,
      endTime: call.endTime,
    };
  } catch (err: any) {
    log(`Get call status error: ${err.message}`);
    return null;
  }
}

export async function listRecentCalls(limit: number = 20): Promise<any[]> {
  try {
    const client = await getTwilioClient();
    const calls = await client.calls.list({ limit });
    return calls.map((c) => ({
      sid: c.sid,
      status: c.status,
      direction: c.direction,
      from: c.from,
      to: c.to,
      duration: c.duration,
      startTime: c.startTime,
      endTime: c.endTime,
    }));
  } catch (err: any) {
    log(`List calls error: ${err.message}`);
    return [];
  }
}

export async function listRecentMessages(limit: number = 20): Promise<any[]> {
  try {
    const client = await getTwilioClient();
    const messages = await client.messages.list({ limit });
    return messages.map((m) => ({
      sid: m.sid,
      status: m.status,
      direction: m.direction,
      from: m.from,
      to: m.to,
      body: m.body,
      dateSent: m.dateSent,
    }));
  } catch (err: any) {
    log(`List messages error: ${err.message}`);
    return [];
  }
}

function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return digits.length >= 11 ? digits : null;
  }
  if (digits.length === 10) {
    return "+1" + digits;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return "+" + digits;
  }
  return digits.length >= 11 ? "+" + digits : null;
}
