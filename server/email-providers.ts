export interface ProviderProfile {
  type: string;
  label: string;
  maxDailyLimit: number;
  recommendedDailyLimit: number;
  recommendedIntervalMs: number;
  notes: string;
}

const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  gmail: {
    type: "gmail",
    label: "Gmail / Google Workspace",
    maxDailyLimit: 500,
    recommendedDailyLimit: 100,
    recommendedIntervalMs: 10000,
    notes: "Gmail limits: 500/day consumer, 2000/day Workspace. Using 500 as safe max. Requires App Password with 2FA.",
  },
  outlook: {
    type: "outlook",
    label: "Outlook / Office 365",
    maxDailyLimit: 300,
    recommendedDailyLimit: 80,
    recommendedIntervalMs: 10000,
    notes: "Outlook limits: 300 recipients/day, 30 messages/min. Conservative pacing recommended.",
  },
  yahoo: {
    type: "yahoo",
    label: "Yahoo Mail",
    maxDailyLimit: 500,
    recommendedDailyLimit: 80,
    recommendedIntervalMs: 15000,
    notes: "Yahoo limits: 500/day. Aggressive sending can trigger temporary blocks.",
  },
  sendgrid: {
    type: "sendgrid",
    label: "SendGrid",
    maxDailyLimit: 10000,
    recommendedDailyLimit: 500,
    recommendedIntervalMs: 2000,
    notes: "SendGrid limits vary by plan (100/day free, up to 100k+ paid). Set according to your plan tier.",
  },
  hubspot: {
    type: "hubspot",
    label: "HubSpot SMTP",
    maxDailyLimit: 5000,
    recommendedDailyLimit: 500,
    recommendedIntervalMs: 3000,
    notes: "HubSpot limits depend on subscription tier. Check your account for specifics.",
  },
  zoho: {
    type: "zoho",
    label: "Zoho Mail",
    maxDailyLimit: 250,
    recommendedDailyLimit: 50,
    recommendedIntervalMs: 12000,
    notes: "Zoho limits: 250/day free, more on premium plans. Conservative pacing required.",
  },
  custom: {
    type: "custom",
    label: "Custom SMTP",
    maxDailyLimit: 500,
    recommendedDailyLimit: 50,
    recommendedIntervalMs: 5000,
    notes: "Unknown provider. Using conservative defaults. Adjust based on your provider's documentation.",
  },
};

export function detectProviderFromHost(smtpHost: string): ProviderProfile {
  const host = (smtpHost || "").toLowerCase().trim();

  if (host.includes("gmail") || host.includes("google")) return PROVIDER_PROFILES.gmail;
  if (host.includes("office365") || host.includes("outlook") || host.includes("microsoft")) return PROVIDER_PROFILES.outlook;
  if (host.includes("yahoo")) return PROVIDER_PROFILES.yahoo;
  if (host.includes("sendgrid")) return PROVIDER_PROFILES.sendgrid;
  if (host.includes("hubspot")) return PROVIDER_PROFILES.hubspot;
  if (host.includes("zoho")) return PROVIDER_PROFILES.zoho;

  return PROVIDER_PROFILES.custom;
}

export function getProviderProfile(providerType: string): ProviderProfile {
  return PROVIDER_PROFILES[providerType] || PROVIDER_PROFILES.custom;
}

export function getAllProviderProfiles(): ProviderProfile[] {
  return Object.values(PROVIDER_PROFILES);
}

export function clampDailyLimit(requestedLimit: number, providerType: string): {
  limit: number;
  clamped: boolean;
  maxAllowed: number;
} {
  const profile = getProviderProfile(providerType);
  const maxAllowed = profile.maxDailyLimit;
  if (requestedLimit > maxAllowed) {
    return { limit: maxAllowed, clamped: true, maxAllowed };
  }
  return { limit: requestedLimit, clamped: false, maxAllowed };
}
