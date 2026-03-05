import type { IndustryConfigType } from "../config/industry-default";

let _config: IndustryConfigType | null = null;

export function getIndustryConfig(): IndustryConfigType {
  if (_config) return _config;

  const configName = process.env.INDUSTRY_CONFIG || "default";

  try {
    const mod = require(`../config/industry-${configName}`);
    _config = mod.IndustryConfig as IndustryConfigType;
  } catch {
    const mod = require("../config/industry-default");
    _config = mod.IndustryConfig as IndustryConfigType;
  }

  console.log(`Industry config loaded: ${_config!.name} (${configName})`);
  return _config!;
}
