export interface RunStep {
  step: string;
  started_at: number;
  finished_at?: number;
  duration_ms?: number;
  stats?: Record<string, any>;
  status: "running" | "ok" | "error" | "skipped";
}

export interface Run {
  run_id: string;
  started_at: number;
  finished_at?: number;
  steps: RunStep[];
  summary?: Record<string, any>;
  errors: string[];
  status: "running" | "completed" | "error";
}

const MAX_RUNS = 20;
const runs: Run[] = [];

export function startRun(run_id: string): Run {
  const run: Run = {
    run_id,
    started_at: Date.now(),
    steps: [],
    errors: [],
    status: "running",
  };
  runs.unshift(run);
  if (runs.length > MAX_RUNS) {
    runs.pop();
  }
  return run;
}

export function addStep(run_id: string, stepUpdate: Partial<RunStep> & { step: string }): void {
  const run = runs.find((r) => r.run_id === run_id);
  if (!run) return;

  const existing = run.steps.find((s) => s.step === stepUpdate.step);
  if (existing) {
    Object.assign(existing, stepUpdate);
  } else {
    run.steps.push({
      step: stepUpdate.step,
      started_at: stepUpdate.started_at ?? Date.now(),
      status: stepUpdate.status ?? "running",
      ...stepUpdate,
    });
  }
}

export function completeRun(
  run_id: string,
  data: { finished_at?: number; summary?: Record<string, any>; errors?: string[]; status?: "completed" | "error" }
): Run | undefined {
  const run = runs.find((r) => r.run_id === run_id);
  if (!run) return undefined;
  run.finished_at = data.finished_at ?? Date.now();
  if (data.summary) run.summary = data.summary;
  if (data.errors) run.errors = data.errors;
  run.status = data.status ?? "completed";
  return run;
}

export function getHistory(): Run[] {
  return runs;
}

export function getRunById(run_id: string): Run | undefined {
  return runs.find((r) => r.run_id === run_id);
}
