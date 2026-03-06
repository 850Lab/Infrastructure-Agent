import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, CheckCircle, Loader2, Target, Trophy, XCircle, Search, Users, Phone, TrendingUp, BarChart3 } from "lucide-react";
import { useLatestRun } from "@/lib/use-latest-run";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useMemo } from "react";

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

interface AuthorityTrendPoint {
  id: number;
  clientId: string;
  title: string;
  snapshotDate: string;
  conversionRate: number;
  sampleSize: number;
}

const TREND_COLORS = [
  "#10B981", "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444",
  "#06B6D4", "#EC4899", "#F97316", "#14B8A6", "#6366F1",
];

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

  const { data: trendsData } = useQuery<{ trends: AuthorityTrendPoint[] }>({
    queryKey: ["/api/authority-trends"],
    enabled: !!token,
  });

  const trendChart = useMemo(() => {
    const trends = trendsData?.trends || [];
    if (trends.length === 0) return null;

    const titles = [...new Set(trends.map(t => t.title))];
    const dates = [...new Set(trends.map(t => t.snapshotDate))].sort();

    if (dates.length < 1) return null;

    const seriesMap = new Map<string, { date: string; rate: number }[]>();
    for (const title of titles) {
      const points = dates.map(d => {
        const match = trends.find(t => t.title === title && t.snapshotDate === d);
        return { date: d, rate: match?.conversionRate ?? -1 };
      }).filter(p => p.rate >= 0);
      if (points.length > 0) seriesMap.set(title, points);
    }

    const maxRate = Math.max(...trends.map(t => t.conversionRate), 10);
    const yMax = Math.ceil(maxRate / 10) * 10 || 100;

    const latestDate = dates[dates.length - 1];
    const latestScores = titles
      .map(title => {
        const pt = trends.find(t => t.title === title && t.snapshotDate === latestDate);
        return pt ? { title, rate: pt.conversionRate } : null;
      })
      .filter(Boolean) as { title: string; rate: number }[];
    latestScores.sort((a, b) => b.rate - a.rate);
    const topTitle = latestScores[0]?.title;

    let insight = "";
    if (dates.length >= 2 && latestScores.length > 0) {
      const prevDate = dates[dates.length - 2];
      const prevScores = titles
        .map(title => {
          const pt = trends.find(t => t.title === title && t.snapshotDate === prevDate);
          return pt ? { title, rate: pt.conversionRate } : null;
        })
        .filter(Boolean) as { title: string; rate: number }[];
      prevScores.sort((a, b) => b.rate - a.rate);
      const prevTop = prevScores[0]?.title;
      if (prevTop && prevTop !== topTitle) {
        insight = `${prevTop} led previously, ${topTitle} leads now.`;
      } else if (topTitle) {
        insight = `${topTitle} continues to lead in effectiveness.`;
      }
    } else if (topTitle) {
      insight = `${topTitle} currently has the highest effectiveness score.`;
    }

    return { titles, dates, seriesMap, yMax, topTitle, insight };
  }, [trendsData]);

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

        {trendChart && (
          <Card style={{ border: "1px solid #E2E8F0" }} data-testid="card-authority-trends">
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2" style={{ color: "#0F172A" }}>
                <BarChart3 className="w-5 h-5" style={{ color: "#10B981" }} />
                Decision Maker Effectiveness Over Time
              </CardTitle>
              <p className="text-sm" style={{ color: "#94A3B8" }}>How targeting evolves across daily runs</p>
            </CardHeader>
            <CardContent>
              {trendChart.insight && (
                <div className="rounded-lg px-3 py-2 mb-4" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }} data-testid="text-trend-insight">
                  <p className="text-sm" style={{ color: "#0F172A" }}>{trendChart.insight}</p>
                </div>
              )}

              <div className="relative" style={{ height: 240 }}>
                <svg width="100%" height="100%" viewBox="0 0 600 220" preserveAspectRatio="xMidYMid meet">
                  {[0, 25, 50, 75, 100].map(pct => {
                    const y = 200 - (pct / trendChart.yMax) * 180;
                    if (y < 10 || y > 200) return null;
                    return (
                      <g key={pct}>
                        <line x1="50" y1={y} x2="580" y2={y} stroke="#E2E8F0" strokeWidth="1" />
                        <text x="45" y={y + 4} textAnchor="end" fill="#94A3B8" fontSize="10">{pct}%</text>
                      </g>
                    );
                  })}

                  {trendChart.dates.map((d, i) => {
                    const x = trendChart.dates.length === 1
                      ? 315
                      : 60 + (i / (trendChart.dates.length - 1)) * 520;
                    const label = new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    return (
                      <text key={d} x={x} y={215} textAnchor="middle" fill="#94A3B8" fontSize="10">{label}</text>
                    );
                  })}

                  {[...trendChart.seriesMap.entries()].map(([title, points], si) => {
                    const color = TREND_COLORS[si % TREND_COLORS.length];
                    const pathPoints = points.map(p => {
                      const di = trendChart.dates.indexOf(p.date);
                      const x = trendChart.dates.length === 1
                        ? 315
                        : 60 + (di / (trendChart.dates.length - 1)) * 520;
                      const y = 200 - (p.rate / trendChart.yMax) * 180;
                      return { x, y };
                    });

                    const pathD = pathPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

                    return (
                      <g key={title}>
                        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        {pathPoints.map((p, i) => (
                          <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />
                        ))}
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="flex flex-wrap gap-3 mt-3 pt-3" style={{ borderTop: "1px solid #E2E8F0" }}>
                {[...trendChart.seriesMap.keys()].map((title, i) => (
                  <div key={title} className="flex items-center gap-1.5" data-testid={`legend-${title.toLowerCase().replace(/[\s\/]+/g, "-")}`}>
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: TREND_COLORS[i % TREND_COLORS.length] }} />
                    <span className="text-xs" style={{ color: "#64748B" }}>{title}</span>
                  </div>
                ))}
              </div>
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
