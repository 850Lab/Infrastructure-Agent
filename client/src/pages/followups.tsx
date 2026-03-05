import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PhoneCall, BarChart3, Clock, Loader2 } from "lucide-react";
import { useLatestRun } from "@/lib/use-latest-run";

export default function FollowupsPage() {
  const { getStep, isLoading } = useLatestRun();

  const callStep = getStep("call_engine");
  const dmStep = getStep("dm_coverage");
  const playbookStep = getStep("playbooks");

  const callsProcessed = callStep?.stats?.calls_processed ?? 0;
  const companiesUpdated = callStep?.stats?.companies_updated ?? 0;
  const followupsScheduled = callStep?.stats?.followups_scheduled ?? 0;

  const callList: any[] = dmStep?.stats?.callList || [];
  const playbookDetails: any[] = playbookStep?.stats?.details || [];
  const playbookLookup = new Map<string, any>();
  playbookDetails.forEach((p: any) => {
    if (p.status === "generated") playbookLookup.set(p.companyName, p);
  });

  const metrics = [
    { label: "Calls Processed", value: callsProcessed, icon: PhoneCall },
    { label: "Companies Updated", value: companiesUpdated, icon: BarChart3 },
    { label: "Follow-ups Scheduled", value: followupsScheduled, icon: Clock },
  ];

  return (
    <AppLayout showBackToChip>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono tracking-wider uppercase" style={{ color: "#94A3B8" }}>Call Engine</span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: "#0F172A" }} data-testid="text-page-title">Follow-ups</h1>
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
          <CardHeader>
            <CardTitle className="text-lg font-bold" style={{ color: "#0F172A" }}>Call Playbooks</CardTitle>
            <p className="text-sm" style={{ color: "#94A3B8" }}>Generated call openers and gatekeeper scripts for your call list</p>
          </CardHeader>
          <CardContent className="p-0">
            <Table data-testid="table-followups">
              <TableHeader>
                <TableRow>
                  <TableHead style={{ color: "#64748B" }}>Company</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Status</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Call Opener</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Gatekeeper Script</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: "#94A3B8" }} />
                    </TableCell>
                  </TableRow>
                ) : playbookDetails.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8" style={{ color: "#94A3B8" }}>
                      No playbooks generated yet — run the engine from the dashboard
                    </TableCell>
                  </TableRow>
                ) : (
                  playbookDetails.map((p: any, i: number) => (
                    <TableRow key={i} data-testid={`row-playbook-${i}`}>
                      <TableCell className="font-medium" style={{ color: "#0F172A" }}>{p.companyName}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "generated" ? "default" : "secondary"} style={
                          p.status === "generated" ? { background: "#10B981", color: "#fff" } : {}
                        }>
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-sm truncate" style={{ color: "#334155" }} title={p.callOpener || ""}>
                          {p.callOpener || <span style={{ color: "#94A3B8" }}>—</span>}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-sm truncate" style={{ color: "#334155" }} title={p.gatekeeperAsk || ""}>
                          {p.gatekeeperAsk || <span style={{ color: "#94A3B8" }}>—</span>}
                        </p>
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
