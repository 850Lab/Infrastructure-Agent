import { log } from "./index";

const MAKE_API_TOKEN = process.env.MAKE_API_TOKEN;
const MAKE_BASE_URLS = [
  "https://us1.make.com/api/v2",
  "https://eu1.make.com/api/v2",
  "https://eu2.make.com/api/v2",
];

let resolvedBaseUrl: string | null = null;

async function makeRequest(path: string, baseUrl?: string): Promise<any> {
  if (!MAKE_API_TOKEN) {
    throw new Error("Make API token not configured");
  }

  const url = `${baseUrl || resolvedBaseUrl || MAKE_BASE_URLS[0]}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Token ${MAKE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Make API error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function discoverMakeRegion(): Promise<{ baseUrl: string; orgId: number; orgName: string }> {
  for (const baseUrl of MAKE_BASE_URLS) {
    try {
      const data = await makeRequest("/organizations", baseUrl);
      const orgs = data.organizations || [];
      if (orgs.length > 0) {
        resolvedBaseUrl = baseUrl;
        log(`Discovered Make region: ${baseUrl}, org: ${orgs[0].name}`, "make");
        return { baseUrl, orgId: orgs[0].id, orgName: orgs[0].name };
      }
    } catch (e: any) {
      log(`Region ${baseUrl} failed: ${e.message}`, "make");
    }
  }
  throw new Error("Could not discover Make region. Check your API token.");
}

export async function getMakeHealth(): Promise<{
  connected: boolean;
  region?: string;
  orgId?: number;
  orgName?: string;
  error?: string;
}> {
  try {
    const info = await discoverMakeRegion();
    return { connected: true, region: info.baseUrl, orgId: info.orgId, orgName: info.orgName };
  } catch (e: any) {
    return { connected: false, error: e.message };
  }
}

export interface MakeScenario {
  id: number;
  name: string;
  isEnabled: boolean;
  schedulingType: string;
  scheduling?: any;
  folderId?: number;
  folderName?: string;
  updatedAt?: string;
  lastRun?: {
    status: string;
    finishedAt: string;
  };
}

export async function listScenarios(orgId: number): Promise<MakeScenario[]> {
  const scenarios: MakeScenario[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await makeRequest(`/scenarios?organizationId=${orgId}&pg[limit]=${limit}&pg[offset]=${offset}`);
    const batch = data.scenarios || [];
    if (batch.length === 0) break;

    for (const s of batch) {
      scenarios.push({
        id: s.id,
        name: s.name,
        isEnabled: !s.isPaused,
        schedulingType: s.scheduling?.type || "unknown",
        scheduling: s.scheduling,
        folderId: s.folderId,
        updatedAt: s.updatedByAt || s.createdAt,
        lastRun: s.lastExec ? { status: "unknown", finishedAt: s.lastExec } : undefined,
      });
    }

    offset += limit;
    if (batch.length < limit) break;
  }

  log(`Fetched ${scenarios.length} scenarios from Make`, "make");
  return scenarios;
}

export interface MakeModule {
  id: number;
  module: string;
  name?: string;
  mapper?: any;
  routes?: any;
}

export async function getScenarioBlueprint(scenarioId: number): Promise<{
  modules: MakeModule[];
  graphSummary: string;
}> {
  try {
    const data = await makeRequest(`/scenarios/${scenarioId}/blueprint`);
    const blueprint = data.response?.blueprint || data.blueprint || data;
    const flow = blueprint?.flow || [];

    const modules: MakeModule[] = [];
    const graphParts: string[] = [];

    function walkModules(nodes: any[]) {
      for (const node of nodes) {
        modules.push({
          id: node.id,
          module: node.module,
          name: node.metadata?.designer?.name || node.module,
          mapper: node.mapper,
          routes: node.routes,
        });
        graphParts.push(node.metadata?.designer?.name || node.module);

        if (node.routes) {
          for (const route of node.routes) {
            if (route.flow) {
              graphParts.push("Router →");
              walkModules(route.flow);
            }
          }
        }
      }
    }

    walkModules(flow);

    return {
      modules,
      graphSummary: graphParts.join(" → ") || "Empty blueprint",
    };
  } catch (e: any) {
    log(`Failed to get blueprint for scenario ${scenarioId}: ${e.message}`, "make");
    return { modules: [], graphSummary: "Blueprint unavailable" };
  }
}

export interface MakeRun {
  id: number;
  scenarioId: number;
  status: string;
  startedAt: string;
  finishedAt?: string;
  duration?: number;
  error?: string;
}

export async function getScenarioRuns(scenarioId: number, limit = 24): Promise<MakeRun[]> {
  try {
    const data = await makeRequest(`/scenarios/${scenarioId}/logs?pg[limit]=${limit}&pg[sortBy]=timestamp&pg[sortDir]=desc`);
    const logs = data.scenarioLogs || data.logs || [];

    return logs.map((l: any) => ({
      id: l.id || l.imtId,
      scenarioId,
      status: l.status === 1 ? "success" : l.status === 2 ? "warning" : l.status === 3 ? "error" : `status_${l.status}`,
      startedAt: l.timestamp || l.startedAt,
      finishedAt: l.finishedAt,
      duration: l.duration,
      error: l.errorMessage || l.error || undefined,
    }));
  } catch (e: any) {
    log(`Failed to get runs for scenario ${scenarioId}: ${e.message}`, "make");
    return [];
  }
}

export function formatSchedule(scenario: MakeScenario): string {
  const s = scenario.scheduling;
  if (!s) return "Not scheduled";
  if (s.type === "indefinitely") return "Runs continuously";
  if (s.type === "immediately") return "On demand";
  if (s.interval) return `Every ${s.interval} minutes`;
  return s.type || "Unknown schedule";
}

export interface BlueprintImport {
  scenarios: Array<{
    id?: number;
    name: string;
    isEnabled?: boolean;
    blueprint?: {
      flow?: any[];
    };
  }>;
}

export function parseBlueprintJson(json: string): BlueprintImport {
  const data = JSON.parse(json);

  if (Array.isArray(data)) {
    return {
      scenarios: data.map((s, i) => ({
        id: s.id || i + 1,
        name: s.name || `Imported Scenario ${i + 1}`,
        isEnabled: s.isEnabled ?? true,
        blueprint: s.blueprint || s,
      })),
    };
  }

  if (data.flow) {
    return {
      scenarios: [{
        id: 1,
        name: data.name || "Imported Scenario",
        isEnabled: true,
        blueprint: data,
      }],
    };
  }

  if (data.blueprint) {
    return {
      scenarios: [{
        id: data.id || 1,
        name: data.name || "Imported Scenario",
        isEnabled: data.isEnabled ?? true,
        blueprint: data.blueprint,
      }],
    };
  }

  throw new Error("Unrecognized blueprint JSON format");
}
