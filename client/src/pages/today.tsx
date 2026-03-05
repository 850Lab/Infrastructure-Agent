import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Users, UserCheck, BookOpen, Loader2 } from "lucide-react";
import { useLatestRun } from "@/lib/use-latest-run";

export default function TodayPage() {
  const { latestRun, getStep, isLoading } = useLatestRun();

  const oppStep = getStep("opportunity_engine");
  const dmStep = getStep("dm_coverage");
  const playbookStep = getStep("playbooks");

  const companiesOnList = oppStep?.stats?.top_requested ?? 0;
  const dmsResolved = dmStep?.stats?.dmResolution?.companiesWithDM ?? 0;
  const playbooksReady = playbookStep?.stats?.generated ?? 0;

  const details: any[] = oppStep?.stats?.details || [];
  const callList: any[] = dmStep?.stats?.callList || [];
  const playbookDetails: any[] = playbookStep?.stats?.details || [];

  const dmLookup = new Map<string, any>();
  callList.forEach((c: any) => dmLookup.set(c.companyName, c));
  const playbookLookup = new Map<string, string>();
  playbookDetails.forEach((p: any) => playbookLookup.set(p.companyName, p.status));

  const metrics = [
    { label: "Companies on List", value: companiesOnList, icon: Users },
    { label: "DMs Resolved", value: dmsResolved, icon: UserCheck },
    { label: "Playbooks Ready", value: playbooksReady, icon: BookOpen },
  ];

  return (
    <AppLayout showBackToChip>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono tracking-wider uppercase" style={{ color: "#94A3B8" }}>Opportunity Engine / Playbooks</span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: "#0F172A" }} data-testid="text-page-title">Today's Call List</h1>
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
            <Table data-testid="table-today">
              <TableHeader>
                <TableRow>
                  <TableHead style={{ color: "#64748B" }}>Company</TableHead>
                  <TableHead style={{ color: "#64748B" }}>DM</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Priority</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Bucket</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Playbook</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: "#94A3B8" }} />
                    </TableCell>
                  </TableRow>
                ) : details.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8" style={{ color: "#94A3B8" }}>
                      No data yet — run the engine from the dashboard
                    </TableCell>
                  </TableRow>
                ) : (
                  details.map((d: any, i: number) => {
                    const dm = dmLookup.get(d.companyName);
                    const pbStatus = playbookLookup.get(d.companyName) || "—";
                    return (
                      <TableRow key={i} data-testid={`row-company-${i}`}>
                        <TableCell className="font-medium" style={{ color: "#0F172A" }}>{d.companyName}</TableCell>
                        <TableCell style={{ color: "#334155" }}>
                          {dm?.primaryDMName || d.primaryDMName || <span style={{ color: "#94A3B8" }}>—</span>}
                          {(dm?.primaryDMTitle || d.primaryDMTitle) && (
                            <div className="text-xs" style={{ color: "#94A3B8" }}>{dm?.primaryDMTitle || d.primaryDMTitle}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" style={{
                            borderColor: d.finalPriority >= 60 ? "#10B981" : d.finalPriority >= 40 ? "#F59E0B" : "#94A3B8",
                            color: d.finalPriority >= 60 ? "#059669" : d.finalPriority >= 40 ? "#D97706" : "#64748B"
                          }}>
                            {d.finalPriority}
                          </Badge>
                        </TableCell>
                        <TableCell style={{ color: "#334155" }}>{d.bucket || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={pbStatus === "generated" ? "default" : "secondary"} style={
                            pbStatus === "generated" ? { background: "#10B981", color: "#fff" } : {}
                          }>
                            {pbStatus}
                          </Badge>
                        </TableCell>
                        <TableCell style={{ color: "#334155" }}>{d.phone || "—"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
