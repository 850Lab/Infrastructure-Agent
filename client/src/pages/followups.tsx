import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PhoneCall, Clock, Loader2, AlertTriangle, Calendar } from "lucide-react";
import DealCard from "@/components/deal-card";
import type { Opportunity } from "@/components/deal-card";

const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const EMERALD = "#10B981";

interface Followup {
  id: string;
  company_name: string;
  followup_due: string;
  last_outcome: string;
  phone: string;
  offer_dm_name: string;
  bucket: string;
}

export default function FollowupsPage() {
  const { getToken } = useAuth();
  const token = getToken();

  const { data: followupsData, isLoading } = useQuery<{ followups: Followup[]; count: number }>({
    queryKey: ["/api/followups/due"],
    enabled: !!token,
  });

  const { data: oppsData } = useQuery<{ opportunities: Opportunity[]; count: number }>({
    queryKey: ["/api/opportunities"],
    enabled: !!token,
  });

  const oppByCompany = useMemo(() => {
    const map = new Map<string, Opportunity>();
    for (const opp of oppsData?.opportunities || []) {
      if (opp.company && opp.stage !== "Won" && opp.stage !== "Lost") {
        const key = opp.company.toLowerCase();
        if (!map.has(key)) map.set(key, opp);
      }
    }
    return map;
  }, [oppsData]);

  const followups = followupsData?.followups || [];
  const now = new Date();

  const overdue = followups.filter(f => new Date(f.followup_due) < now);
  const upcoming = followups.filter(f => new Date(f.followup_due) >= now);

  const metrics = [
    { label: "Total Due", value: followups.length, icon: Clock, color: TEXT },
    { label: "Overdue", value: overdue.length, icon: AlertTriangle, color: "#EF4444" },
    { label: "Today / Tomorrow", value: upcoming.length, icon: Calendar, color: EMERALD },
  ];

  const bucketColor = (bucket: string) => {
    switch (bucket) {
      case "Hot Follow-up": return "#EF4444";
      case "Working": return "#F59E0B";
      case "Fresh": return "#3B82F6";
      default: return MUTED;
    }
  };

  const outcomeColor = (outcome: string) => {
    switch (outcome) {
      case "Decision Maker": return EMERALD;
      case "Qualified": return "#059669";
      case "Gatekeeper": return "#3B82F6";
      case "Callback": return "#F59E0B";
      case "No Answer": return MUTED;
      case "Not Interested": return "#EF4444";
      default: return MUTED;
    }
  };

  const renderFollowup = (f: Followup, idx: number) => {
    const isOverdue = new Date(f.followup_due) < now;
    const opp = f.company_name ? oppByCompany.get(f.company_name.toLowerCase()) : undefined;

    return (
      <div
        key={f.id}
        className="rounded-xl p-4"
        style={{
          background: "#FFF",
          border: `1px solid ${isOverdue ? "#EF444430" : BORDER}`,
          boxShadow: isOverdue ? "0 0 0 1px rgba(239,68,68,0.08)" : "0 1px 2px rgba(0,0,0,0.04)",
        }}
        data-testid={`followup-row-${idx}`}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
            style={{ background: bucketColor(f.bucket) }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <p className="text-sm font-semibold" style={{ color: TEXT }} data-testid={`followup-company-${idx}`}>
                {f.company_name}
              </p>
              {f.last_outcome && (
                <Badge
                  className="text-xs"
                  style={{
                    background: `${outcomeColor(f.last_outcome)}12`,
                    color: outcomeColor(f.last_outcome),
                    border: `1px solid ${outcomeColor(f.last_outcome)}25`,
                  }}
                >
                  {f.last_outcome}
                </Badge>
              )}
              <span
                className="text-xs font-mono"
                style={{ color: isOverdue ? "#EF4444" : MUTED }}
                data-testid={`followup-due-${idx}`}
              >
                {isOverdue ? "OVERDUE " : ""}
                {new Date(f.followup_due).toLocaleDateString()}
              </span>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {f.offer_dm_name && (
                <span className="text-xs" style={{ color: MUTED }}>
                  Ask for: <span style={{ color: TEXT, fontWeight: 500 }}>{f.offer_dm_name}</span>
                </span>
              )}
              {f.phone && (
                <a
                  href={`tel:${f.phone.replace(/\s/g, "")}`}
                  className="flex items-center gap-1 text-xs font-semibold"
                  style={{ color: EMERALD }}
                  data-testid={`followup-call-${idx}`}
                >
                  <PhoneCall className="w-3 h-3" /> {f.phone}
                </a>
              )}
            </div>

            {opp && <DealCard opportunity={opp} />}
          </div>
        </div>
      </div>
    );
  };

  return (
    <AppLayout showBackToChip>
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <p className="text-xs font-mono tracking-wider uppercase mb-1" style={{ color: MUTED }}>Follow-up Queue</p>
          <h1 className="text-xl font-bold" style={{ color: TEXT }} data-testid="text-page-title">Follow-ups</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {metrics.map((m) => (
            <Card key={m.label} style={{ border: `1px solid ${BORDER}` }} data-testid={`card-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: MUTED }}>{m.label}</CardTitle>
                <m.icon className="w-4 h-4" style={{ color: m.color }} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" style={{ color: m.color }}>
                  {isLoading ? <Loader2 className="w-6 h-6 animate-spin" style={{ color: MUTED }} /> : m.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: MUTED }} />
          </div>
        )}

        {!isLoading && followups.length === 0 && (
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="py-10 text-center">
              <Clock className="w-8 h-8 mx-auto mb-3" style={{ color: MUTED }} />
              <p className="text-sm font-medium" style={{ color: TEXT }}>No follow-ups due</p>
              <p className="text-xs" style={{ color: MUTED }}>Log calls with outcomes to schedule follow-ups automatically.</p>
            </CardContent>
          </Card>
        )}

        {overdue.length > 0 && (
          <div>
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: "#EF4444" }}>
              <AlertTriangle className="w-4 h-4" /> Overdue ({overdue.length})
            </h2>
            <div className="space-y-2" data-testid="overdue-list">
              {overdue.map((f, i) => renderFollowup(f, i))}
            </div>
          </div>
        )}

        {upcoming.length > 0 && (
          <div>
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: TEXT }}>
              <Calendar className="w-4 h-4" style={{ color: EMERALD }} /> Upcoming ({upcoming.length})
            </h2>
            <div className="space-y-2" data-testid="upcoming-list">
              {upcoming.map((f, i) => renderFollowup(f, overdue.length + i))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
