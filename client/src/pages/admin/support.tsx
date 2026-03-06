import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import AdminLayout from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, RefreshCw, Download, AlertTriangle, CheckCircle, Clock, Activity } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AdminSupport() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const clientId = new URLSearchParams(window.location.search).get("client");

  const { data: client, isLoading: clientLoading } = useQuery<{ client: any }>({
    queryKey: ["/api/admin/clients", clientId],
    enabled: !!clientId,
  });

  const { data: health, isLoading: healthLoading } = useQuery<any>({
    queryKey: ["/api/admin/clients", clientId, "health"],
    enabled: !!clientId,
  });

  const { data: usage } = useQuery<any>({
    queryKey: ["/api/admin/clients", clientId, "usage"],
    enabled: !!clientId,
  });

  const { data: users } = useQuery<{ users: any[] }>({
    queryKey: ["/api/admin/clients", clientId, "users"],
    enabled: !!clientId,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/clients/${clientId}/run`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Pipeline started", description: `Run ID: ${data.run_id}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clients", clientId, "health"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to start run", description: err.message, variant: "destructive" });
    },
  });

  const migrateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/clients/${clientId}/migrate`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Migration complete", description: `Tagged records across ${data.results?.length || 0} tables` });
    },
    onError: (err: any) => {
      toast({ title: "Migration failed", description: err.message, variant: "destructive" });
    },
  });

  if (!clientId) {
    return (
      <AdminLayout>
        <div className="py-12 text-center" style={{ color: "#94A3B8" }}>
          <p>No client selected. Go to Clients to pick one.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/admin/clients")} data-testid="button-go-clients">Go to Clients</Button>
        </div>
      </AdminLayout>
    );
  }

  const isLoading = clientLoading || healthLoading;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/clients")} data-testid="button-back-clients">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-bold" style={{ color: "#0F172A" }} data-testid="text-support-title">
                {client?.client?.clientName || "Loading..."}
              </h1>
              <p className="text-sm" style={{ color: "#94A3B8" }}>Support & Diagnostics</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => runMutation.mutate()} disabled={runMutation.isPending} data-testid="button-trigger-run">
              <RefreshCw className={`w-4 h-4 mr-1 ${runMutation.isPending ? "animate-spin" : ""}`} />
              Run Pipeline
            </Button>
            <Button variant="outline" size="sm" onClick={() => migrateMutation.mutate()} disabled={migrateMutation.isPending} data-testid="button-migrate">
              Tag Data
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 rounded-full" style={{ border: "2px solid #10B981", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card style={{ borderColor: "#E2E8F0" }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: "#64748B" }}>Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  {health?.lastRunStatus === "completed" ? (
                    <CheckCircle className="w-5 h-5" style={{ color: "#10B981" }} />
                  ) : health?.lastRunStatus === "error" ? (
                    <AlertTriangle className="w-5 h-5" style={{ color: "#EF4444" }} />
                  ) : (
                    <Activity className="w-5 h-5" style={{ color: "#94A3B8" }} />
                  )}
                  <span className="font-semibold" style={{ color: "#0F172A" }} data-testid="text-health-status">
                    {health?.lastRunStatus || "No runs yet"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card style={{ borderColor: "#E2E8F0" }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: "#64748B" }}>Last Run</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5" style={{ color: "#94A3B8" }} />
                  <span className="text-sm" style={{ color: "#0F172A" }} data-testid="text-last-run">
                    {health?.lastRunAt ? new Date(health.lastRunAt).toLocaleString() : "Never"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card style={{ borderColor: "#E2E8F0" }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: "#64748B" }}>Total Runs</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-2xl font-bold" style={{ color: "#0F172A" }} data-testid="text-total-runs">{health?.totalRuns || 0}</span>
              </CardContent>
            </Card>

            <Card style={{ borderColor: "#E2E8F0" }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: "#64748B" }}>Users</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-2xl font-bold" style={{ color: "#0F172A" }} data-testid="text-user-count">{users?.users?.length || 0}</span>
              </CardContent>
            </Card>
          </div>
        )}

        {health?.recentErrors?.length > 0 && (
          <Card style={{ borderColor: "#E2E8F0" }}>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2" style={{ color: "#EF4444" }}>
                <AlertTriangle className="w-4 h-4" />
                Recent Errors
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {health.recentErrors.map((err: string, i: number) => (
                  <div key={i} className="text-sm font-mono p-2 rounded" style={{ background: "#FEF2F2", color: "#991B1B" }} data-testid={`text-error-${i}`}>
                    {err}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {usage && (
          <Card style={{ borderColor: "#E2E8F0" }}>
            <CardHeader>
              <CardTitle className="text-sm font-medium" style={{ color: "#64748B" }}>Usage Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(usage.metrics || {}).length === 0 ? (
                <p className="text-sm" style={{ color: "#94A3B8" }}>No usage recorded yet.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(usage.metrics as Record<string, number>).map(([key, val]) => (
                    <div key={key}>
                      <p className="text-xs font-mono" style={{ color: "#94A3B8" }}>{key}</p>
                      <p className="text-lg font-bold" style={{ color: "#0F172A" }}>{val}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card style={{ borderColor: "#E2E8F0" }}>
          <CardHeader>
            <CardTitle className="text-sm font-medium" style={{ color: "#64748B" }}>Data Export</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {["companies", "calls", "decision_makers", "opportunities", "queries"].map((type) => (
                <a key={type} href={`/api/admin/clients/${clientId}/export/${type}`} download>
                  <Button variant="outline" size="sm" data-testid={`button-export-${type}`}>
                    <Download className="w-4 h-4 mr-1" />
                    {type.replace("_", " ")}
                  </Button>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        {users?.users && users.users.length > 0 && (
          <Card style={{ borderColor: "#E2E8F0" }}>
            <CardHeader>
              <CardTitle className="text-sm font-medium" style={{ color: "#64748B" }}>Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {users.users.map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between p-2 rounded" style={{ background: "#F8FAFC" }} data-testid={`row-user-${u.id}`}>
                    <div>
                      <span className="font-medium text-sm" style={{ color: "#0F172A" }}>{u.email}</span>
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full" style={{ background: u.role === "client_admin" ? "rgba(16,185,129,0.1)" : "rgba(100,116,139,0.1)", color: u.role === "client_admin" ? "#10B981" : "#64748B" }}>
                        {u.role}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
