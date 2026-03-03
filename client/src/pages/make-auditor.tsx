import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Activity,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Radio,
  RefreshCw,
  Cpu,
  Play,
  Pause,
  ArrowLeft,
  Upload,
  Layers,
  BarChart3,
  Shield,
  Zap,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
    critical: { variant: "destructive", className: "" },
    high: { variant: "destructive", className: "bg-orange-600 hover:bg-orange-700" },
    medium: { variant: "secondary", className: "" },
    low: { variant: "outline", className: "" },
  };
  const { variant, className } = config[severity] || { variant: "outline" as const, className: "" };
  return (
    <Badge variant={variant} className={className} data-testid={`badge-severity-${severity}`}>
      {severity}
    </Badge>
  );
}

export default function MakeAuditor() {
  const [blueprintJson, setBlueprintJson] = useState("");
  const [showBlueprint, setShowBlueprint] = useState(false);
  const { toast } = useToast();

  const healthQuery = useQuery<{
    connected: boolean;
    region?: string;
    orgId?: number;
    orgName?: string;
    error?: string;
  }>({
    queryKey: ["/api/make/health"],
    refetchInterval: 60000,
  });

  const syncResultQuery = useQuery<any>({
    queryKey: ["/api/make/sync-result"],
  });

  const syncMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await apiRequest("POST", `/api/make/scenarios/sync?dryRun=${dryRun}`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/make/sync-result"] });
      toast({
        title: data.dryRun ? "Dry run complete" : "Sync complete",
        description: `${data.summary.totalScenarios} scenarios, ${data.summary.totalFindings} findings`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (json: string) => {
      const res = await apiRequest("POST", "/api/make/blueprint/import", { blueprintJson: json, dryRun: true });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Blueprint imported",
        description: `${data.scenarios.length} scenarios analyzed`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const health = healthQuery.data;
  const syncResult = syncMutation.data || syncResultQuery.data;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="p-2 bg-primary/10 rounded-md">
              <Cpu className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">Make Scenario Auditor</h1>
              <p className="text-xs text-muted-foreground">Read-only audit of Make.com scenarios & automation health</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {health && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className={`h-2 w-2 rounded-full ${health.connected ? "bg-green-500" : "bg-red-500"}`} />
                <span data-testid="text-make-status">
                  {health.connected ? `Connected: ${health.orgName}` : "Disconnected"}
                </span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/make/health"] });
                queryClient.invalidateQueries({ queryKey: ["/api/make/sync-result"] });
              }}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1" data-testid="card-make-health">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                Make.com Connection
              </CardTitle>
              <CardDescription>API access & organization info</CardDescription>
            </CardHeader>
            <CardContent>
              {healthQuery.isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : health ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${health.connected ? "bg-green-500" : "bg-red-500"}`} />
                      <span className="text-sm font-medium">API</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {health.connected ? "Connected" : health.error || "Failed"}
                    </span>
                  </div>
                  {health.connected && (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-muted-foreground">Organization</span>
                        <span className="text-sm font-medium" data-testid="text-make-org">{health.orgName}</span>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-muted-foreground">Region</span>
                        <span className="text-xs font-mono text-muted-foreground">{health.region?.replace("https://", "").replace("/api/v2", "")}</span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">Unable to check connection</p>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2" data-testid="card-sync-controls">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Sync & Audit Controls
              </CardTitle>
              <CardDescription>
                Fetch scenarios from Make.com and run audit (read-only)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Button
                  onClick={() => syncMutation.mutate(true)}
                  disabled={syncMutation.isPending || !health?.connected}
                  variant="outline"
                  data-testid="button-dry-run"
                >
                  {syncMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="mr-2 h-4 w-4" />
                  )}
                  Dry Run (Preview Only)
                </Button>
                <Button
                  onClick={() => syncMutation.mutate(false)}
                  disabled={syncMutation.isPending || !health?.connected}
                  data-testid="button-full-sync"
                >
                  {syncMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Full Sync to Airtable
                </Button>
              </div>

              <Separator />

              <div>
                <button
                  onClick={() => setShowBlueprint(!showBlueprint)}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-toggle-blueprint"
                >
                  <Upload className="h-4 w-4" />
                  Blueprint JSON Fallback
                  {showBlueprint ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                {showBlueprint && (
                  <div className="mt-3 space-y-2">
                    <Textarea
                      placeholder='Paste Make.com blueprint JSON export here...'
                      value={blueprintJson}
                      onChange={(e) => setBlueprintJson(e.target.value)}
                      className="min-h-[120px] font-mono text-xs"
                      data-testid="textarea-blueprint"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => importMutation.mutate(blueprintJson)}
                      disabled={!blueprintJson.trim() || importMutation.isPending}
                      data-testid="button-import-blueprint"
                    >
                      {importMutation.isPending ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-3 w-3" />
                      )}
                      Analyze Blueprint
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {syncResult && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card data-testid="card-stat-scenarios">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Scenarios</p>
                      <p className="text-2xl font-semibold tabular-nums mt-1">{syncResult.summary?.totalScenarios || 0}</p>
                    </div>
                    <div className="p-2.5 bg-muted rounded-md">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {syncResult.summary?.activeScenarios || 0} active, {syncResult.summary?.disabledScenarios || 0} disabled
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-stat-modules">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Modules</p>
                      <p className="text-2xl font-semibold tabular-nums mt-1">{syncResult.summary?.totalModules || 0}</p>
                    </div>
                    <div className="p-2.5 bg-primary/10 rounded-md">
                      <Cpu className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-stat-runs">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Runs Analyzed</p>
                      <p className="text-2xl font-semibold tabular-nums mt-1">{syncResult.summary?.totalRuns || 0}</p>
                    </div>
                    <div className="p-2.5 bg-muted rounded-md">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-stat-findings">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Findings</p>
                      <p className="text-2xl font-semibold tabular-nums mt-1">{syncResult.summary?.totalFindings || 0}</p>
                    </div>
                    <div className="p-2.5 bg-destructive/10 rounded-md">
                      <Shield className="h-4 w-4 text-destructive" />
                    </div>
                  </div>
                  {syncResult.summary?.findingsBySeverity && (
                    <div className="flex gap-1 mt-1">
                      {syncResult.summary.findingsBySeverity.critical > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          {syncResult.summary.findingsBySeverity.critical} critical
                        </Badge>
                      )}
                      {syncResult.summary.findingsBySeverity.high > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 bg-orange-600">
                          {syncResult.summary.findingsBySeverity.high} high
                        </Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {syncResult.dryRun && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
                <span className="text-sm text-yellow-700 dark:text-yellow-400">
                  Dry run mode — data shown below was not written to Airtable. Use "Full Sync" to persist.
                </span>
              </div>
            )}

            <Card data-testid="card-machine-map">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Machine Map — Top Scenarios by Importance
                </CardTitle>
                <CardDescription>Ranked by activity, error rate, and audit findings</CardDescription>
              </CardHeader>
              <CardContent>
                {syncResult.machineMap?.length > 0 ? (
                  <div className="space-y-2">
                    {syncResult.machineMap.map((item: any, i: number) => (
                      <div
                        key={item.scenarioId}
                        className="flex items-center justify-between p-3 border border-border rounded-md"
                        data-testid={`row-scenario-${item.scenarioId}`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="text-xs text-muted-foreground font-mono w-6 text-right">#{i + 1}</span>
                          {item.isActive ? (
                            <Play className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                          ) : (
                            <Pause className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{item.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {item.schedule}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0 text-xs">
                          <div className="text-center">
                            <p className="text-muted-foreground">Runs</p>
                            <p className="font-medium tabular-nums">{item.totalRuns}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-muted-foreground">Errors</p>
                            <p className={`font-medium tabular-nums ${parseInt(item.errorRate) > 20 ? "text-destructive" : ""}`}>
                              {item.errorRate}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-muted-foreground">Findings</p>
                            <p className="font-medium tabular-nums">{item.findings}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">No scenarios found</p>
                )}
              </CardContent>
            </Card>

            {syncResult.findings?.length > 0 && (
              <Card data-testid="card-findings">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    Audit Findings
                  </CardTitle>
                  <CardDescription>Issues detected across your Make.com scenarios</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {syncResult.findings.map((f: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 p-3 border border-border rounded-md"
                        data-testid={`row-finding-${i}`}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          <SeverityBadge severity={f.severity} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-[10px]">{f.findingType.replace(/_/g, " ")}</Badge>
                          </div>
                          <p className="text-sm">{f.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {syncResult.scenarios?.length > 0 && (
              <Card data-testid="card-all-scenarios">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    All Scenarios
                  </CardTitle>
                  <CardDescription>Complete inventory from Make.com</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="p-2 font-medium text-muted-foreground">Name</th>
                          <th className="p-2 font-medium text-muted-foreground">Status</th>
                          <th className="p-2 font-medium text-muted-foreground">Schedule</th>
                          <th className="p-2 font-medium text-muted-foreground text-right">Modules</th>
                          <th className="p-2 font-medium text-muted-foreground text-right">Runs</th>
                          <th className="p-2 font-medium text-muted-foreground text-right">Errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncResult.scenarios.map((s: any) => (
                          <tr key={s.id} className="border-b border-border/50" data-testid={`row-scenario-detail-${s.id}`}>
                            <td className="p-2 font-medium truncate max-w-[200px]">{s.name}</td>
                            <td className="p-2">
                              {s.isEnabled ? (
                                <Badge variant="default" className="text-[10px]">
                                  <Play className="mr-1 h-2.5 w-2.5" />Active
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[10px]">
                                  <Pause className="mr-1 h-2.5 w-2.5" />Disabled
                                </Badge>
                              )}
                            </td>
                            <td className="p-2 text-muted-foreground text-xs">{s.schedule}</td>
                            <td className="p-2 text-right tabular-nums">{s.moduleCount}</td>
                            <td className="p-2 text-right tabular-nums">{s.runCount}</td>
                            <td className={`p-2 text-right tabular-nums ${s.errorCount > 0 ? "text-destructive font-medium" : ""}`}>
                              {s.errorCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {importMutation.data && (
          <Card data-testid="card-import-result">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4 text-primary" />
                Blueprint Import Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-sm">
                  Imported {importMutation.data.scenarios?.length || 0} scenario(s)
                </p>
                {importMutation.data.findings?.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Findings</h4>
                    {importMutation.data.findings.map((f: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 p-2 border border-border rounded-md text-sm">
                        <SeverityBadge severity={f.severity} />
                        <span>{f.description}</span>
                      </div>
                    ))}
                  </div>
                )}
                {importMutation.data.findings?.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    No issues found in imported blueprint
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {!syncResult && !importMutation.data && (
          <Card data-testid="card-empty-state">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-3 bg-muted/50 rounded-full mb-3">
                <Cpu className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No audit data yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click "Dry Run" to preview or "Full Sync" to audit and write to Airtable
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
