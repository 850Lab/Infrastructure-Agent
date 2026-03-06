import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History } from "lucide-react";

export default function AdminRuns() {
  const { data, isLoading } = useQuery<{ runs: any[] }>({
    queryKey: ["/api/admin/runs"],
  });

  const runs = data?.runs ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#0F172A" }} data-testid="text-runs-title">
            Run History
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94A3B8" }}>
            Pipeline runs across all client machines
          </p>
        </div>

        <Card style={{ border: "1px solid #E2E8F0" }}>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "#0F172A" }}>
              <History className="w-4 h-4" style={{ color: "#10B981" }} />
              All Runs ({runs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded animate-pulse" style={{ background: "#F8FAFC" }} />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ color: "#94A3B8" }}>
                No pipeline runs recorded yet.
              </p>
            ) : (
              <div className="space-y-2">
                {runs.map((run: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-3 px-4 rounded" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }} data-testid={`row-run-${i}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono" style={{ background: "rgba(16,185,129,0.08)", color: "#10B981" }}>
                        {i + 1}
                      </div>
                      <div>
                        <span className="text-sm font-medium block" style={{ color: "#0F172A" }}>
                          {run.id || `Run ${i + 1}`}
                        </span>
                        <span className="text-xs" style={{ color: "#94A3B8" }}>
                          {run.started_at ? new Date(run.started_at).toLocaleString() : ""}
                          {run.duration_ms ? ` · ${(run.duration_ms / 1000).toFixed(1)}s` : ""}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {run.companies_found !== undefined && (
                        <span className="text-xs" style={{ color: "#64748B" }}>
                          {run.companies_found} companies
                        </span>
                      )}
                      <span className="text-xs font-mono px-2 py-0.5 rounded" style={{
                        color: run.status === "completed" ? "#10B981" : run.status === "error" ? "#EF4444" : "#94A3B8",
                        background: run.status === "completed" ? "rgba(16,185,129,0.08)" : run.status === "error" ? "rgba(239,68,68,0.08)" : "rgba(148,163,184,0.08)",
                      }}>
                        {run.status || "unknown"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
