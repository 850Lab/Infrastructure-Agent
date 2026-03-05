import type { IndustryConfig } from "../config/types";
import { IndustryConfig as DefaultConfig } from "../config/industry-default";
import { IndustryConfig as IndustrialConfig } from "../config/industry-industrial";
import { IndustryConfig as SaasConfig } from "../config/industry-saas";
import { IndustryConfig as RealEstateConfig } from "../config/industry-real-estate";
import { IndustryConfig as AgencyConfig } from "../config/industry-agency";

export type { IndustryConfig };

let _config: IndustryConfig | null = null;
let _logged = false;

const CONFIG_MAP: Record<string, IndustryConfig> = {
  "default": DefaultConfig,
  "industrial": IndustrialConfig,
  "saas": SaasConfig,
  "real-estate": RealEstateConfig,
  "agency": AgencyConfig,
};

function validateConfig(cfg: any, name: string): void {
  const required: string[] = [
    "name", "market", "company_categories", "opportunity_keywords",
    "decision_maker_titles_tiers", "search_templates", "cold_start_queries",
    "scoring", "call_list", "geo", "lead_feed",
  ];
  for (const key of required) {
    if (!(key in cfg)) {
      throw new Error(`Industry config "${name}" is missing required key: ${key}`);
    }
  }
}

export function getIndustryConfig(): IndustryConfig {
  if (_config) return _config;

  const configName = process.env.INDUSTRY_CONFIG || "default";

  _config = CONFIG_MAP[configName] || CONFIG_MAP["default"];
  validateConfig(_config, configName);

  if (!_logged) {
    _logged = true;
    console.log(`Industry config loaded: ${_config!.name} (${configName})`);
  }

  return _config!;
}

export function resetConfig(): void {
  _config = null;
  _logged = false;
}
