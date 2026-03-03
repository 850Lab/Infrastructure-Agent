import type { Express, Request, Response } from "express";
import { getMakeHealth, listScenarios, getScenarioBlueprint, getScenarioRuns, discoverMakeRegion, formatSchedule, parseBlueprintJson } from "./make";
import { generateFindings, rankScenarios } from "./make-audit";
import { syncScenariosToAirtable, syncModulesToAirtable, syncRunsToAirtable, syncFindingsToAirtable } from "./make-airtable";
import type { MakeScenario, MakeModule, MakeRun } from "./make";
import type { AuditFinding } from "./make-audit";
import { log } from "./index";

let cachedSyncResult: any = null;

export function registerMakeRoutes(app: Express) {
  app.get("/api/make/health", async (_req: Request, res: Response) => {
    try {
      const health = await getMakeHealth();
      res.json(health);
    } catch (e: any) {
      res.json({ connected: false, error: e.message });
    }
  });

  app.post("/api/make/scenarios/sync", async (req: Request, res: Response) => {
    const dryRun = req.query.dryRun === "true" || req.body?.dryRun === true;

    try {
      log("Starting Make scenario sync...", "make");
      const { orgId } = await discoverMakeRegion();

      const scenarios = await listScenarios(orgId);
      const modulesByScenario = new Map<number, MakeModule[]>();
      const runsByScenario = new Map<number, MakeRun[]>();
      const allRuns: MakeRun[] = [];

      for (const scenario of scenarios) {
        const { modules, graphSummary } = await getScenarioBlueprint(scenario.id);
        modulesByScenario.set(scenario.id, modules);

        if (!dryRun) {
          await syncModulesToAirtable(scenario.id, modules, graphSummary);
        }

        const runs = await getScenarioRuns(scenario.id);
        runsByScenario.set(scenario.id, runs);
        allRuns.push(...runs);
      }

      const findings = generateFindings(scenarios, modulesByScenario, runsByScenario);

      const findingsByScenario = new Map<number, AuditFinding[]>();
      for (const f of findings) {
        const existing = findingsByScenario.get(f.scenarioId) || [];
        existing.push(f);
        findingsByScenario.set(f.scenarioId, existing);
      }

      const ranked = rankScenarios(scenarios, runsByScenario, findingsByScenario);

      if (!dryRun) {
        await syncScenariosToAirtable(scenarios);
        await syncRunsToAirtable(allRuns);
        await syncFindingsToAirtable(findings);
      }

      const result = {
        dryRun,
        syncedAt: new Date().toISOString(),
        summary: {
          totalScenarios: scenarios.length,
          activeScenarios: scenarios.filter(s => s.isEnabled).length,
          disabledScenarios: scenarios.filter(s => !s.isEnabled).length,
          totalModules: Array.from(modulesByScenario.values()).reduce((sum, m) => sum + m.length, 0),
          totalRuns: allRuns.length,
          totalFindings: findings.length,
          findingsBySeverity: {
            critical: findings.filter(f => f.severity === "critical").length,
            high: findings.filter(f => f.severity === "high").length,
            medium: findings.filter(f => f.severity === "medium").length,
            low: findings.filter(f => f.severity === "low").length,
          },
        },
        machineMap: ranked.slice(0, 10).map(r => ({
          scenarioId: r.scenario.id,
          name: r.scenario.name,
          isActive: r.scenario.isEnabled,
          schedule: formatSchedule(r.scenario),
          totalRuns: r.totalRuns,
          errorRate: `${r.errorRate}%`,
          findings: r.findingCount,
          importanceScore: Math.round(r.score),
        })),
        findings: findings.slice(0, 20),
        scenarios: scenarios.map(s => ({
          id: s.id,
          name: s.name,
          isEnabled: s.isEnabled,
          schedule: formatSchedule(s),
          moduleCount: (modulesByScenario.get(s.id) || []).length,
          graphSummary: modulesByScenario.get(s.id)?.length ? "Available" : "Empty",
          runCount: (runsByScenario.get(s.id) || []).length,
          errorCount: (runsByScenario.get(s.id) || []).filter(r => r.status === "error").length,
        })),
      };

      cachedSyncResult = result;
      log(`Sync complete: ${scenarios.length} scenarios, ${findings.length} findings`, "make");
      res.json(result);
    } catch (e: any) {
      log(`Sync failed: ${e.message}`, "make");
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/make/sync-result", (_req: Request, res: Response) => {
    if (cachedSyncResult) {
      res.json(cachedSyncResult);
    } else {
      res.json(null);
    }
  });

  app.post("/api/make/blueprint/import", async (req: Request, res: Response) => {
    try {
      const { blueprintJson, dryRun } = req.body;
      if (!blueprintJson) {
        return res.status(400).json({ error: "blueprintJson is required" });
      }

      const imported = parseBlueprintJson(blueprintJson);
      const scenarios: MakeScenario[] = [];
      const modulesByScenario = new Map<number, MakeModule[]>();

      for (const s of imported.scenarios) {
        const scenario: MakeScenario = {
          id: s.id || 0,
          name: s.name,
          isEnabled: s.isEnabled ?? true,
          schedulingType: "imported",
        };
        scenarios.push(scenario);

        if (s.blueprint?.flow) {
          const modules: MakeModule[] = [];
          const graphParts: string[] = [];

          function walkFlow(nodes: any[]) {
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
                    walkFlow(route.flow);
                  }
                }
              }
            }
          }

          walkFlow(s.blueprint.flow);
          modulesByScenario.set(scenario.id, modules);
        }
      }

      const emptyRuns = new Map<number, MakeRun[]>();
      const findings = generateFindings(scenarios, modulesByScenario, emptyRuns);

      res.json({
        dryRun: dryRun ?? true,
        imported: true,
        scenarios: scenarios.map(s => ({
          id: s.id,
          name: s.name,
          isEnabled: s.isEnabled,
          moduleCount: (modulesByScenario.get(s.id) || []).length,
        })),
        findings,
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
}
