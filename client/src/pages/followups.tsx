import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, Clock, CalendarDays } from "lucide-react";

const metrics = [
  { label: "Overdue", value: "\u2014", icon: AlertCircle },
  { label: "Due Today", value: "\u2014", icon: Clock },
  { label: "Due This Week", value: "\u2014", icon: CalendarDays },
];

const headers = ["Company", "Last Call", "Next Follow-up", "Status"];

export default function FollowupsPage() {
  return (
    <AppLayout showBackToChip>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs font-mono text-muted-foreground tracking-wider uppercase">Call Engine</span>
        </div>
        <h1 className="text-2xl font-bold glow-text" data-testid="text-page-title">Follow-ups</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {metrics.map((m) => (
            <Card key={m.label} className="glow-card" data-testid={`card-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{m.label}</CardTitle>
                <m.icon className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid={`value-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>{m.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="glow-card">
          <CardContent className="p-0">
            <Table data-testid="table-followups">
              <TableHeader>
                <TableRow>
                  {headers.map((h) => (
                    <TableHead key={h} className="text-muted-foreground">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={headers.length} className="text-center text-muted-foreground py-8">
                    No data loaded yet
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
