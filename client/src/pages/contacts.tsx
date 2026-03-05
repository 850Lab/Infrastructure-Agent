import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Mail, Phone } from "lucide-react";

const metrics = [
  { label: "Total DMs", value: "\u2014", icon: Users },
  { label: "With Email", value: "\u2014", icon: Mail },
  { label: "With Phone", value: "\u2014", icon: Phone },
];

const headers = ["Name", "Title", "Company", "Email", "Phone", "Fit Score"];

export default function ContactsPage() {
  return (
    <AppLayout showBackToChip>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono tracking-wider uppercase" style={{ color: "#94A3B8" }}>DM Coverage / DM Fit</span>
        </div>
        <h1 className="text-2xl font-bold glow-text" data-testid="text-page-title">Contacts</h1>
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
            <Table data-testid="table-contacts">
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
