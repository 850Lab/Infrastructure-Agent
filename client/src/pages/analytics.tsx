import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, CheckCircle, Loader2, Target, Trophy, XCircle, Search, Users, Phone, TrendingUp } from "lucide-react";
import { useLatestRun } from "@/lib/use-latest-run";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";

const STEP_DISPLAY: Record<string, string> = {
  bootstrap: "System Boot",
  opportunity_engine: "Market Scanner",
  dm_coverage: "Decision Maker Mapping",
  dm_fit: "Buyer Selection",
  playbooks: "Script Generation",
  call_engine: "Signal Processing",
  query_intel: "Learning Engine",
  lead_feed: "Lead Expansion",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  return `${minutes}m ${remainingSecs}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

interface OppSummary {
  stages: Record<string, { count: number; value: number }>;
  total_active: number;
  total_won: number;
  total_lost: number;
  total_value: number;
}

interface ModeStats {
  leads: number;
  dm_found: number;
  dm_rate: number;
  positive_calls: number;
  positive_call_rate: number;
  opportunities: number;
  opportunity_rate: number;
}

interface QueryPerformanceData {
  ColdStart: ModeStats | null;
  QueryIntel: ModeStats | null;
  WinPattern: ModeStats | null;
  hasData: boolean;
}

const MODE_CONFIG: Record<string, { label: string; color: string; desc: string }> = {
  ColdStart: { label: "Cold Start", color: "#3B82F6", desc: "Industry-based seed queries" },
  QueryIntel: { label: "Query Intel", color: "#8B5CF6", desc: "Performance-optimized queries" },
  WinPattern: { label: "Win Pattern", color: "#10B981", desc: "Win-data driven queries" },
};

export default function AnalyticsPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const { latestRun, allRuns, isLoading } = useLatestRun();

  const { data: oppSummary } = useQuery<OppSummary>({
    queryKey: ["/api/opportunities/summary"],
    enabled: !!token,
  });

  const { data: queryPerf } = useQuery<QueryPerformanceData>({
    queryKey: ["/api/query-performance"],
    enabled: !!token,
  });

  const totalSteps = latestRun?.steps?.length ?? 0;
  const completedSteps = latestRun?.steps?.filter((s: any) => s.status === "ok").length ?? 0;
  const totalDuration = latestRun?.steps?.reduce((sum: number, s: any) => sum + (s.duration_ms || 0), 0) ?? 0;
  const errorCount = latestRun?.summary?.errors_count ?? latestRun?.errors?.length ?? 0;

  const metrics = [
    { label: "Total Runs", value: allRuns.length, icon: Activity },
    { label: "Last Run Duration", value: totalDuration > 0 ? formatDuration(totalDuration) : "—", icon: Clock },
    { label: "Steps Completed", value: `${completedSteps}/${totalSteps}`, icon: CheckCircle },
  ];

  return (
    <AppLayout showBackToChip>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono tracking-wider uppercase" style={{ color: "#94A3B8" }}>System Analytics</span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: "#0F172A" }} data-testid="text-page-title">Analytics</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {metrics.map((m) => (
            <Card key={m.label} data-testid={`card-${m.label.toLowerCase().replace(/\s+/g, "-")}`} style={{ border: "1px solid #E2E8F0" }}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: "#64748B" }}>{m.label}</CardTitle>
                <m.icon className="w-4 h-4" style={{ color: "#10B981" }} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" style={{ color: "#0F172A" }} data-testid={`value-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {isLoading ? <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#94A3B8" }} /> : m.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {oppSummary && (
          <Card style={{ border: "1px solid #E2E8F0" }} data-testid="card-opportunity-summary">
            <CardHeader>
              <CardTitle className="text-lg font-bold" style={{ color: "#0F172A" }}>Opportunity Pipeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {[
                  { stage: "Qualified", color: "#3B82F6" },
                  { stage: "SiteWalk", label: "Site Walk", color: "#8B5CF6" },
                  { stage: "QuoteSent", label: "Quote Sent", color: "#F59E0B" },
                  { stage: "DeploymentScheduled", label: "Deployment", color: "#F97316" },
                  { stage: "Won", color: "#10B981" },
                  { stage: "Lost", color: "#EF4444" },
                ].map(({ stage, label, color }) => (
                  <div key={stage} className="text-center rounded-lg p-3" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
                    <p className="text-xl font-bold font-mono" style={{ color }} data-testid={`opp-count-${stage.toLowerCase()}`}>
                      {oppSummary.stages?.[stage]?.count ?? 0}
                    </p>
                    <p className="text-xs" style={{ color: "#94A3B8" }}>{label || stage}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-4 pt-3" style={{ borderTop: "1px solid #E2E8F0" }}>
                <div className="flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" style={{ color: "#10B981" }} />
                  <span className="text-sm font-semibold" style={{ color: "#0F172A" }}>{oppSummary.total_active} active</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5" style={{ color: "#10B981" }} />
                  <span className="text-sm" style={{ color: "#64748B" }}>{oppSummary.total_won} won</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5" style={{ color: "#EF4444" }} />
                  <span className="text-sm" style={{ color: "#64748B" }}>{oppSummary.total_lost} lost</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {queryPerf?.hasData && (
          <Card style={{ border: "1px solid #E2E8F0" }} data-testid="card-query-strategy-performance">
            <CardHeader>
              <CardTitle className="text-lg font-bold" style={{ color: "#0F172A" }}>Query Strategy Performance</CardTitle>
              <p className="text-sm" style={{ color: "#94A3B8" }}>Compare lead quality across query generation modes</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {(["ColdStart", "QueryIntel", "WinPattern"] as const).map((mode) => {
                  const stats = queryPerf[mode];
                  const cfg = MODE_CONFIG[mode];
                  if (!stats) return (
                    <div key={mode} className="rounded-lg p-4" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }} data-testid={`card-mode-${mode.toLowerCase()}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: cfg.color }} />
                        <span className="text-sm font-semibold" style={{ color: "#0F172A" }}>{cfg.label}</span>
                      </div>
                      <p className="text-xs" style={{ color: "#94A3B8" }}>No data yet</p>
                    </div>
                  );

                  const allModes = (["ColdStart", "QueryIntel", "WinPattern"] as const)
                    .map(m => queryPerf[m])
                    .filter(Boolean) as ModeStats[];
                  const bestOpp = Math.max(...allModes.map(m => m.opportunity_rate));
                  const isBest = stats.opportunity_rate === bestOpp && stats.opportunity_rate > 0;

                  return (
                    <div key={mode} className="rounded-lg p-4 relative" style={{
                      background: isBest ? `${cfg.color}08` : "#F8FAFC",
                      border: `1px solid ${isBest ? cfg.color + "40" : "#E2E8F0"}`,
                    }} data-testid={`card-mode-${mode.toLowerCase()}`}>
                      {isBest && (
                        <div className="absolute top-2 right-2">
                          <Badge style={{ background: cfg.color, color: "#fff", fontSize: "10px" }} data-testid={`badge-best-${mode.toLowerCase()}`}>Best</Badge>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: cfg.color }} />
                        <span className="text-sm font-semibold" style={{ color: "#0F172A" }}>{cfg.label}</span>
                      </div>
                      <p className="text-xs mb-4" style={{ color: "#94A3B8" }}>{cfg.desc}</p>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Search className="w-3.5 h-3.5" style={{ color: "#94A3B8" }} />
                            <span className="text-xs" style={{ color: "#64748B" }}>Leads</span>
                          </div>
                          <span className="text-sm font-bold font-mono" style={{ color: "#0F172A" }} data-testid={`value-leads-${mode.toLowerCase()}`}>{stats.leads}</span>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5" style={{ color: "#94A3B8" }} />
                              <span className="text-xs" style={{ color: "#64748B" }}>DM Coverage</span>
                            </div>
                            <span className="text-sm font-bold font-mono" style={{ color: "#0F172A" }} data-testid={`value-dm-rate-${mode.toLowerCase()}`}>{stats.dm_rate}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full" style={{ background: "#E2E8F0" }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(stats.dm_rate, 100)}%`, background: cfg.color }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <Phone className="w-3.5 h-3.5" style={{ color: "#94A3B8" }} />
                              <span className="text-xs" style={{ color: "#64748B" }}>Positive Calls</span>
                            </div>
                            <span className="text-sm font-bold font-mono" style={{ color: "#0F172A" }} data-testid={`value-call-rate-${mode.toLowerCase()}`}>{stats.positive_call_rate}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full" style={{ background: "#E2E8F0" }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(stats.positive_call_rate, 100)}%`, background: cfg.color }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <TrendingUp className="w-3.5 h-3.5" style={{ color: "#94A3B8" }} />
                              <span className="text-xs" style={{ color: "#64748B" }}>Opportunities</span>
                            </div>
                            <span className="text-sm font-bold font-mono" style={{ color: "#0F172A" }} data-testid={`value-opp-rate-${mode.toLowerCase()}`}>{stats.opportunity_rate}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full" style={{ background: "#E2E8F0" }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(stats.opportunity_rate, 100)}%`, background: cfg.color }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {(() => {
                const activeModes = (["ColdStart", "QueryIntel", "WinPattern"] as const)
                  .filter(m => queryPerf[m] !== null)
                  .map(m => ({ mode: m, stats: queryPerf[m]! }));
                const totalLeads = activeModes.reduce((s, m) => s + m.stats.leads, 0);
                return (
                  <div className="flex items-center gap-4 pt-3" style={{ borderTop: "1px solid #E2E8F0" }}>
                    <div className="flex items-center gap-1.5">
                      <Search className="w-3.5 h-3.5" style={{ color: "#10B981" }} />
                      <span className="text-sm font-semibold" style={{ color: "#0F172A" }} data-testid="value-total-tracked-leads">{totalLeads} tracked leads</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm" style={{ color: "#64748B" }}>{activeModes.length} active strategies</span>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {latestRun && (
          <Card style={{ border: "1px solid #E2E8F0" }}>
            <CardHeader>
              <CardTitle className="text-lg font-bold" style={{ color: "#0F172A" }}>Latest Run — Step Breakdown</CardTitle>
              <p className="text-sm" style={{ color: "#94A3B8" }}>
                {formatTime(latestRun.started_at)} • {errorCount} error{errorCount !== 1 ? "s" : ""}
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <Table data-testid="table-analytics">
                <TableHeader>
                  <TableRow>
                    <TableHead style={{ color: "#64748B" }}>Step</TableHead>
                    <TableHead style={{ color: "#64748B" }}>Status</TableHead>
                    <TableHead style={{ color: "#64748B" }}>Duration</TableHead>
                    <TableHead style={{ color: "#64748B" }}>Key Stats</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestRun.steps.map((s: any, i: number) => {
                    let keyStats = "";
                    if (s.step === "opportunity_engine") keyStats = `${s.stats?.top_requested ?? 0} targets acquired`;
                    else if (s.step === "dm_coverage") keyStats = `${s.stats?.dmResolution?.companiesWithDM ?? 0} decision makers mapped`;
                    else if (s.step === "dm_fit") keyStats = `Avg fit: ${s.stats?.avgFitScore ?? 0}`;
                    else if (s.step === "playbooks") keyStats = `${s.stats?.generated ?? 0} scripts generated`;
                    else if (s.step === "call_engine") keyStats = `${s.stats?.calls_processed ?? 0} signals processed`;
                    else if (s.step === "query_intel") keyStats = `${s.stats?.queriesGenerated ?? 0} new searches queued`;
                    return (
                      <TableRow key={i} data-testid={`row-step-${i}`}>
                        <TableCell className="font-medium" style={{ color: "#0F172A" }}>{STEP_DISPLAY[s.step] || s.step}</TableCell>
                        <TableCell>
                          <Badge variant={s.status === "ok" ? "default" : "destructive"} style={
                            s.status === "ok" ? { background: "#10B981", color: "#fff" } : {}
                          }>
                            {s.status}
                          </Badge>
                        </TableCell>
                        <TableCell style={{ color: "#334155" }}>{s.duration_ms ? formatDuration(s.duration_ms) : "—"}</TableCell>
                        <TableCell style={{ color: "#334155" }}>{keyStats || "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {allRuns.length > 1 && (
          <Card style={{ border: "1px solid #E2E8F0" }}>
            <CardHeader>
              <CardTitle className="text-lg font-bold" style={{ color: "#0F172A" }}>Run History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table data-testid="table-run-history">
                <TableHeader>
                  <TableRow>
                    <TableHead style={{ color: "#64748B" }}>Run ID</TableHead>
                    <TableHead style={{ color: "#64748B" }}>Started</TableHead>
                    <TableHead style={{ color: "#64748B" }}>Status</TableHead>
                    <TableHead style={{ color: "#64748B" }}>Steps</TableHead>
                    <TableHead style={{ color: "#64748B" }}>Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allRuns.map((run: any, i: number) => (
                    <TableRow key={i} data-testid={`row-run-${i}`}>
                      <TableCell className="font-mono text-xs" style={{ color: "#64748B" }}>{run.run_id.slice(0, 16)}...</TableCell>
                      <TableCell style={{ color: "#334155" }}>{formatTime(run.started_at)}</TableCell>
                      <TableCell>
                        <Badge variant={run.status === "completed" ? "default" : "destructive"} style={
                          run.status === "completed" ? { background: "#10B981", color: "#fff" } : {}
                        }>
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell style={{ color: "#334155" }}>{run.steps?.length ?? 0}</TableCell>
                      <TableCell style={{ color: "#334155" }}>{run.summary?.errors_count ?? run.errors?.length ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {!latestRun && !isLoading && (
          <Card style={{ border: "1px solid #E2E8F0" }}>
            <CardContent className="py-8 text-center" style={{ color: "#94A3B8" }}>
              No runs yet — hit "Run Now" on the dashboard to generate data
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
