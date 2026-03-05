import { log } from "./logger";
import * as fs from "fs";
import * as path from "path";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";
const TABLE_NAME = "User_Config";
const JSON_PATH = path.join(process.cwd(), "data", "user_config.json");

export interface MachineConfig {
  email: string;
  machine_name: string;
  market: string;
  opportunity: string;
  decision_maker_focus: string;
  geo: string;
  industry_config_selected: string;
  created_at: number;
  _airtable_id?: string;
}

function hasAirtable(): boolean {
  return !!(AIRTABLE_API_KEY() && AIRTABLE_BASE_ID());
}

async function airtableRequest(pathStr: string, options: RequestInit = {}): Promise<any> {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${pathStr}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

function ensureDataDir(): void {
  const dir = path.dirname(JSON_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadFromJson(): MachineConfig[] {
  try {
    if (fs.existsSync(JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
      return Array.isArray(data) ? data : [];
    }
  } catch (e: any) {
    log(`Failed to load user config JSON: ${e.message}`, "user-config");
  }
  return [];
}

function saveToJson(configs: MachineConfig[]): void {
  try {
    ensureDataDir();
    fs.writeFileSync(JSON_PATH, JSON.stringify(configs, null, 2));
  } catch (e: any) {
    log(`Failed to save user config JSON: ${e.message}`, "user-config");
  }
}

async function loadFromAirtable(email: string): Promise<MachineConfig | null> {
  try {
    const encoded = encodeURIComponent(TABLE_NAME);
    const params = new URLSearchParams({
      filterByFormula: `{email}='${email.replace(/'/g, "\\'")}'`,
      maxRecords: "1",
    });
    const data = await airtableRequest(`${encoded}?${params}`);
    const rec = data.records?.[0];
    if (!rec) return null;
    return {
      email: rec.fields.email || email,
      machine_name: rec.fields.machine_name || "",
      market: rec.fields.market || "",
      opportunity: rec.fields.opportunity || "",
      decision_maker_focus: rec.fields.decision_maker_focus || "",
      geo: rec.fields.geo || "",
      industry_config_selected: rec.fields.industry_config_selected || "",
      created_at: rec.fields.created_at ? new Date(rec.fields.created_at).getTime() : Date.now(),
      _airtable_id: rec.id,
    };
  } catch (e: any) {
    log(`Airtable load user config failed: ${e.message}`, "user-config");
    return null;
  }
}

async function saveToAirtable(config: MachineConfig): Promise<string | null> {
  try {
    const fields: Record<string, any> = {
      email: config.email,
      machine_name: config.machine_name,
      market: config.market,
      opportunity: config.opportunity,
      decision_maker_focus: config.decision_maker_focus,
      geo: config.geo,
      industry_config_selected: config.industry_config_selected,
      created_at: new Date(config.created_at).toISOString(),
    };
    const encoded = encodeURIComponent(TABLE_NAME);

    if (config._airtable_id) {
      await airtableRequest(encoded, {
        method: "PATCH",
        body: JSON.stringify({ records: [{ id: config._airtable_id, fields }] }),
      });
      return config._airtable_id;
    } else {
      const result = await airtableRequest(encoded, {
        method: "POST",
        body: JSON.stringify({ records: [{ fields }] }),
      });
      return result.records?.[0]?.id || null;
    }
  } catch (e: any) {
    log(`Airtable save user config failed: ${e.message}`, "user-config");
    return null;
  }
}

export async function getUserConfig(email: string): Promise<MachineConfig | null> {
  if (hasAirtable()) {
    const airtableConfig = await loadFromAirtable(email);
    if (airtableConfig) return airtableConfig;
  }

  const configs = loadFromJson();
  return configs.find((c) => c.email.toLowerCase() === email.toLowerCase()) || null;
}

export async function saveUserConfig(config: MachineConfig): Promise<MachineConfig> {
  const configs = loadFromJson();
  const idx = configs.findIndex((c) => c.email.toLowerCase() === config.email.toLowerCase());
  if (idx >= 0) {
    configs[idx] = { ...configs[idx], ...config };
  } else {
    configs.push(config);
  }
  saveToJson(configs);

  if (hasAirtable()) {
    const existing = await loadFromAirtable(config.email);
    if (existing?._airtable_id) {
      config._airtable_id = existing._airtable_id;
    }
    const airtableId = await saveToAirtable(config);
    if (airtableId && !config._airtable_id) {
      config._airtable_id = airtableId;
      const idx2 = configs.findIndex((c) => c.email.toLowerCase() === config.email.toLowerCase());
      if (idx2 >= 0) {
        configs[idx2]._airtable_id = airtableId;
        saveToJson(configs);
      }
    }
  }

  log(`Saved machine config for ${config.email}: ${config.machine_name}`, "user-config");
  return config;
}

export function suggestMachineName(market: string, opportunity: string, geo: string): string {
  const marketPart = market === "industrial" ? "INDUSTRIAL" :
    market === "saas" ? "SAAS" :
    market === "real-estate" ? "REALTY" :
    market === "agency" ? "AGENCY" : market.toUpperCase().slice(0, 8);

  const geoPart = geo.toLowerCase().includes("houston") ? "HTX" :
    geo.toLowerCase().includes("gulf") ? "GC" :
    geo.toLowerCase().includes("texas") ? "TX" :
    geo.toLowerCase().includes("nationwide") ? "US" : geo.toUpperCase().slice(0, 3);

  const oppPart = opportunity.toLowerCase().includes("cooling") ? "COOL" :
    opportunity.toLowerCase().includes("heat") ? "HEAT" :
    opportunity.toLowerCase().includes("safety") ? "SAFE" :
    opportunity.toLowerCase().includes("logistics") ? "LOG" :
    opportunity.toUpperCase().slice(0, 4);

  return `${marketPart}-${oppPart}-${geoPart}`;
}

export function mapToIndustryConfig(market: string): string {
  const map: Record<string, string> = {
    industrial: "industrial",
    saas: "saas",
    "real-estate": "real-estate",
    agency: "agency",
  };
  return map[market.toLowerCase()] || "default";
}
