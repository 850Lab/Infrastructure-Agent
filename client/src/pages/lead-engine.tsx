import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Zap, Search, TrendingUp, Loader2 } from "lucide-react";
import { useLatestRun } from "@/lib/use-latest-run";

export default function LeadEnginePage() {
  const { getStep, isLoading } = useLatestRun();

  const queryStep = getStep("query_intel");
  const oppStep = getStep("opportunity_engine");

  const freshCount = queryStep?.stats?.freshCount ?? 0;
  const queriesGenerated = queryStep?.stats?.queriesGenerated ?? 0;
  const queriesInserted = queryStep?.stats?.queriesInserted ?? 0;
  const winFlagUpdated = queryStep?.stats?.winFlagUpdated ?? 0;

  const freshSelected = oppStep?.stats?.fresh_selected ?? 0;
  const hotSelected = oppStep?.stats?.hot_selected ?? 0;
  const workingSelected = oppStep?.stats?.working_selected ?? 0;

  const metrics = [
    { label: "Fresh Pool", value: freshCount, icon: Zap },
    { label: "Queries Generated", value: queriesGenerated, icon: Search },
    { label: "Leads Selected Today", value: freshSelected + hotSelected + workingSelected, icon: TrendingUp },
  ];

  const queryRows = [
    { metric: "Fresh Leads Available", value: freshCount, status: freshCount > 50 ? "healthy" : "low" },
    { metric: "Queries Generated", value: queriesGenerated, status: "active" },
    { metric: "Queries Inserted", value: queriesInserted, status: "active" },
    { metric: "Duplicate Queries Skipped", value: queryStep?.stats?.queriesSkippedDuplicates ?? 0, status: "info" },
    { metric: "Queries Retired", value: queryStep?.stats?.queriesRetired ?? 0, status: "info" },
    { metric: "Win Flags Updated", value: winFlagUpdated, status: winFlagUpdated > 0 ? "success" : "info" },
    { metric: "Fresh Selected for List", value: freshSelected, status: "active" },
    { metric: "Hot Leads Selected", value: hotSelected, status: hotSelected > 0 ? "success" : "info" },
    { metric: "Working Leads Selected", value: workingSelected, status: workingSelected > 0 ? "success" : "info" },
  ];

  return (
    <AppLayout showBackToChip>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono tracking-wider uppercase" style={{ color: "#94A3B8" }}>Lead Feed / Query Intel</span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: "#0F172A" }} data-testid="text-page-title">Lead Engine</h1>
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
        <Card style={{ border: "1px solid #E2E8F0" }}>
          <CardContent className="p-0">
            <Table data-testid="table-lead-engine">
              <TableHeader>
                <TableRow>
                  <TableHead style={{ color: "#64748B" }}>Metric</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Value</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: "#94A3B8" }} />
                    </TableCell>
                  </TableRow>
                ) : !queryStep && !oppStep ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8" style={{ color: "#94A3B8" }}>
                      No data yet — run the engine from the dashboard
                    </TableCell>
                  </TableRow>
                ) : (
                  queryRows.map((r, i) => (
                    <TableRow key={i} data-testid={`row-query-${i}`}>
                      <TableCell className="font-medium" style={{ color: "#0F172A" }}>{r.metric}</TableCell>
                      <TableCell className="font-bold" style={{ color: "#0F172A" }}>{r.value}</TableCell>
                      <TableCell>
                        <Badge variant="outline" style={{
                          borderColor: r.status === "healthy" || r.status === "success" ? "#10B981" :
                            r.status === "low" ? "#F59E0B" :
                            r.status === "active" ? "#3B82F6" : "#94A3B8",
                          color: r.status === "healthy" || r.status === "success" ? "#059669" :
                            r.status === "low" ? "#D97706" :
                            r.status === "active" ? "#2563EB" : "#64748B",
                        }}>
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
