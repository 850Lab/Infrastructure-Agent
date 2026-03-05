import { useQuery } from "@tanstack/react-query";

export interface RunStep {
  step: string;
  started_at: number;
  status: string;
  finished_at?: number;
  duration_ms?: number;
  stats: Record<string, any>;
}

export interface RunEntry {
  run_id: string;
  started_at: number;
  finished_at?: number;
  status: string;
  steps: RunStep[];
  errors: any[];
  summary?: { errors_count: number };
}

export function useLatestRun() {
  const query = useQuery<RunEntry[]>({
    queryKey: ["/api/run-history"],
    refetchInterval: 30000,
  });

  const latestRun = query.data && query.data.length > 0 ? query.data[0] : null;

  function getStep(name: string): RunStep | null {
    if (!latestRun) return null;
    return latestRun.steps.find((s) => s.step === name) || null;
  }

  return {
    ...query,
    latestRun,
    getStep,
    allRuns: query.data || [],
  };
}
