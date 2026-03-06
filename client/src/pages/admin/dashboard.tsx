import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Users, Activity, Zap, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AdminStats {
  totalClients: number;
  activeClients: number;
  totalRuns: number;
  recentRuns: any[];
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#0F172A" }} data-testid="text-admin-title">
            Platform Overview
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94A3B8" }}>
            Manage client machines across the Texas Automation Systems network
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} style={{ border: "1px solid #E2E8F0" }}>
                <CardContent className="p-6">
                  <div className="h-16 rounded animate-pulse" style={{ background: "#F8FAFC" }} />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card style={{ border: "1px solid #E2E8F0" }} data-testid="card-total-clients">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.08)" }}>
                    <Users className="w-5 h-5" style={{ color: "#10B981" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "#94A3B8" }}>Total Clients</p>
                    <p className="text-2xl font-bold" style={{ color: "#0F172A" }}>{stats?.totalClients ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card style={{ border: "1px solid #E2E8F0" }} data-testid="card-active-clients">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(5,150,105,0.08)" }}>
                    <Activity className="w-5 h-5" style={{ color: "#059669" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "#94A3B8" }}>Active Machines</p>
                    <p className="text-2xl font-bold" style={{ color: "#0F172A" }}>{stats?.activeClients ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card style={{ border: "1px solid #E2E8F0" }} data-testid="card-total-runs">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.08)" }}>
                    <Zap className="w-5 h-5" style={{ color: "#10B981" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "#94A3B8" }}>Total Runs</p>
                    <p className="text-2xl font-bold" style={{ color: "#0F172A" }}>{stats?.totalRuns ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card style={{ border: "1px solid #E2E8F0" }}>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "#0F172A" }}>
              <Clock className="w-4 h-4" style={{ color: "#10B981" }} />
              Recent Runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!stats?.recentRuns?.length ? (
              <p className="text-sm py-4 text-center" style={{ color: "#94A3B8" }}>No runs recorded yet</p>
            ) : (
              <div className="space-y-2">
                {stats.recentRuns.map((run: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }} data-testid={`row-run-${i}`}>
                    <div>
                      <span className="text-sm font-medium" style={{ color: "#0F172A" }}>{run.id || `Run ${i + 1}`}</span>
                      <span className="text-xs ml-2" style={{ color: "#94A3B8" }}>{run.started_at ? new Date(run.started_at).toLocaleString() : ""}</span>
                    </div>
                    <span className="text-xs font-mono px-2 py-0.5 rounded" style={{
                      color: run.status === "completed" ? "#10B981" : run.status === "error" ? "#EF4444" : "#94A3B8",
                      background: run.status === "completed" ? "rgba(16,185,129,0.08)" : run.status === "error" ? "rgba(239,68,68,0.08)" : "rgba(148,163,184,0.08)",
                    }}>
                      {run.status || "unknown"}
                    </span>
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
