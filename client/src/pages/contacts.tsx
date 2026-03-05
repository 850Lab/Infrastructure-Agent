import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Users, Mail, Phone, Loader2 } from "lucide-react";
import { useLatestRun } from "@/lib/use-latest-run";

export default function ContactsPage() {
  const { getStep, isLoading } = useLatestRun();

  const dmStep = getStep("dm_coverage");
  const dmFitStep = getStep("dm_fit");

  const callList: any[] = dmStep?.stats?.callList || [];
  const contactsWithDM = callList.filter((c: any) => c.primaryDMName);
  const contactsWithEmail = callList.filter((c: any) => c.primaryDMEmail);
  const contactsWithPhone = callList.filter((c: any) => c.primaryDMPhone);

  const fitScore = dmFitStep?.stats?.avgFitScore ?? 0;

  const metrics = [
    { label: "Total DMs", value: contactsWithDM.length, icon: Users },
    { label: "With Email", value: contactsWithEmail.length, icon: Mail },
    { label: "With Phone", value: contactsWithPhone.length, icon: Phone },
  ];

  return (
    <AppLayout showBackToChip>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono tracking-wider uppercase" style={{ color: "#94A3B8" }}>DM Coverage / DM Fit</span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: "#0F172A" }} data-testid="text-page-title">Contacts</h1>
        {fitScore > 0 && (
          <div className="text-sm" style={{ color: "#64748B" }}>
            Average DM Fit Score: <span className="font-bold" style={{ color: "#10B981" }}>{fitScore}</span>
          </div>
        )}
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
            <Table data-testid="table-contacts">
              <TableHeader>
                <TableRow>
                  <TableHead style={{ color: "#64748B" }}>Name</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Title</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Company</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Email</TableHead>
                  <TableHead style={{ color: "#64748B" }}>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: "#94A3B8" }} />
                    </TableCell>
                  </TableRow>
                ) : contactsWithDM.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8" style={{ color: "#94A3B8" }}>
                      No decision makers found yet — run the engine from the dashboard
                    </TableCell>
                  </TableRow>
                ) : (
                  contactsWithDM.map((c: any, i: number) => (
                    <TableRow key={i} data-testid={`row-contact-${i}`}>
                      <TableCell className="font-medium" style={{ color: "#0F172A" }}>{c.primaryDMName}</TableCell>
                      <TableCell style={{ color: "#334155" }}>{c.primaryDMTitle || <span style={{ color: "#94A3B8" }}>—</span>}</TableCell>
                      <TableCell style={{ color: "#334155" }}>{c.companyName}</TableCell>
                      <TableCell>
                        {c.primaryDMEmail ? (
                          <a href={`mailto:${c.primaryDMEmail}`} className="underline" style={{ color: "#10B981" }}>{c.primaryDMEmail}</a>
                        ) : <span style={{ color: "#94A3B8" }}>—</span>}
                      </TableCell>
                      <TableCell style={{ color: "#334155" }}>{c.primaryDMPhone || <span style={{ color: "#94A3B8" }}>—</span>}</TableCell>
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
