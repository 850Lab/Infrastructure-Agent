import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, CheckCircle, Loader2 } from "lucide-react";
import { useLatestRun } from "@/lib/use-latest-run";

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

export default function AnalyticsPage() {
  const { latestRun, allRuns, isLoading } = useLatestRun();

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
                    if (s.step === "opportunity_engine") keyStats = `${s.stats?.top_requested ?? 0} companies`;
                    else if (s.step === "dm_coverage") keyStats = `${s.stats?.dmResolution?.companiesWithDM ?? 0} DMs found`;
                    else if (s.step === "dm_fit") keyStats = `Avg fit: ${s.stats?.avgFitScore ?? 0}`;
                    else if (s.step === "playbooks") keyStats = `${s.stats?.generated ?? 0} generated`;
                    else if (s.step === "call_engine") keyStats = `${s.stats?.calls_processed ?? 0} calls`;
                    else if (s.step === "query_intel") keyStats = `${s.stats?.queriesGenerated ?? 0} queries`;
                    return (
                      <TableRow key={i} data-testid={`row-step-${i}`}>
                        <TableCell className="font-medium" style={{ color: "#0F172A" }}>{s.step}</TableCell>
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
