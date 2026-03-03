import type { MakeScenario, MakeModule, MakeRun } from "./make";
import { log } from "./index";

export interface AuditFinding {
  scenarioId: number;
  scenarioName: string;
  findingType: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

export function generateFindings(
  scenarios: MakeScenario[],
  modulesByScenario: Map<number, MakeModule[]>,
  runsByScenario: Map<number, MakeRun[]>
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const scenario of scenarios) {
    const runs = runsByScenario.get(scenario.id) || [];
    const modules = modulesByScenario.get(scenario.id) || [];

    if (!scenario.isEnabled) {
      findings.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        findingType: "disabled_scenario",
        severity: "medium",
        description: `Scenario "${scenario.name}" is disabled. Review if it should be active or removed.`,
      });
    }

    const recentErrors = runs.filter(r => r.status === "error");
    if (recentErrors.length >= 3) {
      const errorRate = Math.round((recentErrors.length / runs.length) * 100);
      findings.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        findingType: "repeated_failures",
        severity: recentErrors.length >= 10 ? "critical" : "high",
        description: `Scenario "${scenario.name}" has ${recentErrors.length} errors in the last ${runs.length} runs (${errorRate}% failure rate).`,
      });
    }

    const hasErrorHandler = modules.some(m =>
      m.module?.toLowerCase().includes("error") ||
      m.module?.toLowerCase().includes("rollback") ||
      m.module?.toLowerCase().includes("break") ||
      m.name?.toLowerCase().includes("error handler")
    );
    if (modules.length > 0 && !hasErrorHandler) {
      findings.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        findingType: "missing_error_handler",
        severity: "medium",
        description: `Scenario "${scenario.name}" has ${modules.length} modules but no error handler detected.`,
      });
    }

    const hasRouter = modules.some(m =>
      m.module?.toLowerCase().includes("router") ||
      m.routes
    );
    const hasDedupeOrFilter = modules.some(m =>
      m.module?.toLowerCase().includes("filter") ||
      m.module?.toLowerCase().includes("aggregator") ||
      m.module?.toLowerCase().includes("unique") ||
      m.name?.toLowerCase().includes("dedupe") ||
      m.name?.toLowerCase().includes("duplicate")
    );
    if (hasRouter && !hasDedupeOrFilter && modules.length > 3) {
      findings.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        findingType: "missing_idempotency",
        severity: "low",
        description: `Scenario "${scenario.name}" has a router and ${modules.length} modules but no filter/deduplication detected. Consider adding idempotency controls.`,
      });
    }

    if (runs.length > 0) {
      const warningRuns = runs.filter(r => r.status === "warning");
      if (warningRuns.length > runs.length * 0.5) {
        findings.push({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          findingType: "excessive_warnings",
          severity: "medium",
          description: `Scenario "${scenario.name}" has warnings in ${warningRuns.length}/${runs.length} recent runs.`,
        });
      }
    }
  }

  findings.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  log(`Generated ${findings.length} audit findings`, "make-audit");
  return findings;
}

export function rankScenarios(
  scenarios: MakeScenario[],
  runsByScenario: Map<number, MakeRun[]>,
  findingsByScenario: Map<number, AuditFinding[]>
): Array<{
  scenario: MakeScenario;
  score: number;
  totalRuns: number;
  errorRate: number;
  findingCount: number;
}> {
  return scenarios.map(s => {
    const runs = runsByScenario.get(s.id) || [];
    const findings = findingsByScenario.get(s.id) || [];
    const errors = runs.filter(r => r.status === "error").length;
    const errorRate = runs.length > 0 ? errors / runs.length : 0;

    let score = 0;
    if (s.isEnabled) score += 30;
    score += Math.min(runs.length, 20);
    score += errorRate * 30;
    score += Math.min(findings.length * 5, 20);

    return {
      scenario: s,
      score,
      totalRuns: runs.length,
      errorRate: Math.round(errorRate * 100),
      findingCount: findings.length,
    };
  }).sort((a, b) => b.score - a.score);
}
