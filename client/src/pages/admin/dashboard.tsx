import { useQuery, useMutation } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Users, Activity, Zap, Clock, Globe, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AdminStats {
  totalClients: number;
  activeClients: number;
  totalRuns: number;
  recentRuns: any[];
}

interface PlatformInsight {
  id: number;
  industry: string;
  title: string;
  conversionRate: number;
  sampleSize: number;
  reachedDmRate: number;
  lastUpdated: string;
}

export default function AdminDashboard() {
  const { toast } = useToast();

  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  const { data: insightsData, isLoading: insightsLoading } = useQuery<{ insights: PlatformInsight[] }>({
    queryKey: ["/api/admin/platform-insights"],
  });

  const aggregateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/platform-insights/aggregate"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-insights"] });
      toast({ title: "Aggregation complete", description: `${data.titlesUpdated} title insights from ${data.clientsScanned} clients` });
    },
    onError: () => {
      toast({ title: "Aggregation failed", description: "Check server logs for details", variant: "destructive" });
    },
  });

  const insights = insightsData?.insights || [];

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

        <Card style={{ border: "1px solid #E2E8F0" }} data-testid="card-cross-client-insights">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "#0F172A" }}>
              <Globe className="w-4 h-4" style={{ color: "#10B981" }} />
              Cross-Client Insights
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => aggregateMutation.mutate()}
              disabled={aggregateMutation.isPending}
              style={{ borderColor: "#E2E8F0", color: "#0F172A" }}
              data-testid="button-aggregate-insights"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${aggregateMutation.isPending ? "animate-spin" : ""}`} />
              {aggregateMutation.isPending ? "Aggregating..." : "Refresh Insights"}
            </Button>
          </CardHeader>
          <CardContent>
            {insightsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded animate-pulse" style={{ background: "#F8FAFC" }} />
                ))}
              </div>
            ) : insights.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm" style={{ color: "#94A3B8" }}>No cross-client insights yet</p>
                <p className="text-xs mt-1" style={{ color: "#94A3B8" }}>Click "Refresh Insights" to aggregate anonymized data across all client machines</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2 px-3 py-1.5">
                  <span className="text-xs font-medium" style={{ color: "#94A3B8" }}>Title Bucket</span>
                  <span className="text-xs font-medium text-center" style={{ color: "#94A3B8" }}>Effectiveness</span>
                  <span className="text-xs font-medium text-center" style={{ color: "#94A3B8" }}>DM Reach Rate</span>
                  <span className="text-xs font-medium text-right" style={{ color: "#94A3B8" }}>Sample Size</span>
                </div>
                {insights.map((insight) => {
                  const avgRate = insights.reduce((s, i) => s + i.conversionRate, 0) / insights.length;
                  const isAboveAvg = insight.conversionRate > avgRate;
                  return (
                    <div
                      key={insight.id}
                      className="grid grid-cols-4 gap-2 items-center px-3 py-2.5 rounded"
                      style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}
                      data-testid={`row-insight-${insight.id}`}
                    >
                      <div className="flex items-center gap-2">
                        {isAboveAvg ? (
                          <TrendingUp className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#10B981" }} />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#64748B" }} />
                        )}
                        <span className="text-sm font-medium truncate" style={{ color: "#0F172A" }}>{insight.title}</span>
                      </div>
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "#E2E8F0" }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(insight.conversionRate, 100)}%`,
                              background: isAboveAvg ? "#10B981" : "#94A3B8",
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono" style={{ color: isAboveAvg ? "#10B981" : "#64748B" }}>
                          {insight.conversionRate}%
                        </span>
                      </div>
                      <div className="text-center">
                        <span className="text-xs font-mono" style={{ color: "#64748B" }}>
                          {insight.reachedDmRate}%
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-mono" style={{ color: "#94A3B8" }}>
                          n={insight.sampleSize}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs pt-2" style={{ color: "#94A3B8" }}>
                  Anonymized title performance across {(stats?.activeClients ?? 0)} active client machines. Insights feed into DM fit scoring as cross-client adjustments.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
