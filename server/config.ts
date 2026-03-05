import { IndustryConfig as DefaultConfig, type IndustryConfigType } from "../config/industry-default";

export type { IndustryConfigType };

let _config: IndustryConfigType | null = null;
let _logged = false;

export function getIndustryConfig(): IndustryConfigType {
  if (_config) return _config;

  _config = DefaultConfig;

  if (!_logged) {
    _logged = true;
    const configName = process.env.INDUSTRY_CONFIG || "default";
    console.log(`Industry config loaded: ${_config.name} (${configName})`);
  }

  return _config;
}
