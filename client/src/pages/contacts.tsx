import { useMemo } from "react";
import { List } from "react-window";
import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail, Phone, Loader2 } from "lucide-react";
import { useLatestRun } from "@/lib/use-latest-run";
import type { CSSProperties, ReactElement } from "react";

const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 40;

interface ContactRowProps {
  contacts: any[];
}

function ContactRow(props: { index: number; style: CSSProperties } & ContactRowProps): ReactElement | null {
  const { index, style, contacts } = props;
  const c = contacts[index];
  if (!c) return null;

  return (
    <div
      style={style}
      className="flex items-center border-b"
      data-testid={`row-contact-${index}`}
    >
      <div className="flex-1 min-w-0 px-4 py-2 text-sm font-medium truncate" style={{ color: "#0F172A", flexBasis: "20%" }}>
        {c.primaryDMName}
      </div>
      <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ color: "#334155", flexBasis: "20%" }}>
        {c.primaryDMTitle || <span style={{ color: "#94A3B8" }}>—</span>}
      </div>
      <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ color: "#334155", flexBasis: "20%" }}>
        {c.companyName}
      </div>
      <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ flexBasis: "25%" }}>
        {c.primaryDMEmail ? (
          <a href={`mailto:${c.primaryDMEmail}`} className="underline" style={{ color: "#10B981" }}>{c.primaryDMEmail}</a>
        ) : <span style={{ color: "#94A3B8" }}>—</span>}
      </div>
      <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ color: "#334155", flexBasis: "15%" }}>
        {c.primaryDMPhone || <span style={{ color: "#94A3B8" }}>—</span>}
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const { getStep, isLoading } = useLatestRun();

  const dmStep = getStep("dm_coverage");
  const dmFitStep = getStep("dm_fit");

  const callList: any[] = dmStep?.stats?.callList || [];
  const contactsWithDM = useMemo(() => callList.filter((c: any) => c.primaryDMName), [callList]);
  const contactsWithEmail = callList.filter((c: any) => c.primaryDMEmail);
  const contactsWithPhone = callList.filter((c: any) => c.primaryDMPhone);

  const fitScore = dmFitStep?.stats?.avgFitScore ?? 0;

  const metrics = [
    { label: "Total DMs", value: contactsWithDM.length, icon: Users },
    { label: "With Email", value: contactsWithEmail.length, icon: Mail },
    { label: "With Phone", value: contactsWithPhone.length, icon: Phone },
  ];

  const useVirtualization = contactsWithDM.length > 50;
  const rowProps: ContactRowProps = useMemo(() => ({ contacts: contactsWithDM }), [contactsWithDM]);

  return (
    <AppLayout showBackToChip>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono tracking-wider uppercase" style={{ color: "#94A3B8" }}>Decision Maker Mapping / Buyer Selection</span>
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
            <div className="flex items-center border-b" style={{ height: HEADER_HEIGHT }}>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "20%" }}>Name</div>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "20%" }}>Title</div>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "20%" }}>Company</div>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "25%" }}>Email</div>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "#64748B", flexBasis: "15%" }}>Phone</div>
            </div>
            <div data-testid="table-contacts">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#94A3B8" }} />
                </div>
              ) : contactsWithDM.length === 0 ? (
                <div className="text-center py-8 text-sm" style={{ color: "#94A3B8" }}>
                  No decision makers found yet — run the engine from the dashboard
                </div>
              ) : useVirtualization ? (
                <List
                  rowComponent={ContactRow}
                  rowCount={contactsWithDM.length}
                  rowHeight={ROW_HEIGHT}
                  rowProps={rowProps}
                  overscanCount={10}
                  style={{ height: "calc(100vh - 420px)", minHeight: 300 }}
                />
              ) : (
                contactsWithDM.map((c: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center border-b"
                    style={{ height: ROW_HEIGHT }}
                    data-testid={`row-contact-${i}`}
                  >
                    <div className="flex-1 min-w-0 px-4 py-2 text-sm font-medium truncate" style={{ color: "#0F172A", flexBasis: "20%" }}>
                      {c.primaryDMName}
                    </div>
                    <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ color: "#334155", flexBasis: "20%" }}>
                      {c.primaryDMTitle || <span style={{ color: "#94A3B8" }}>—</span>}
                    </div>
                    <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ color: "#334155", flexBasis: "20%" }}>
                      {c.companyName}
                    </div>
                    <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ flexBasis: "25%" }}>
                      {c.primaryDMEmail ? (
                        <a href={`mailto:${c.primaryDMEmail}`} className="underline" style={{ color: "#10B981" }}>{c.primaryDMEmail}</a>
                      ) : <span style={{ color: "#94A3B8" }}>—</span>}
                    </div>
                    <div className="flex-1 min-w-0 px-4 py-2 text-sm truncate" style={{ color: "#334155", flexBasis: "15%" }}>
                      {c.primaryDMPhone || <span style={{ color: "#94A3B8" }}>—</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
