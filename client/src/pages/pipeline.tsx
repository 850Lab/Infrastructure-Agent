import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Target,
  MapPin,
  FileText,
  Truck,
  Trophy,
  XCircle,
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";

const STAGE_META: Record<string, { label: string; color: string; icon: any }> = {
  Qualified: { label: "Qualified", color: "#3B82F6", icon: Target },
  SiteWalk: { label: "Site Walk", color: "#8B5CF6", icon: MapPin },
  QuoteSent: { label: "Quote Sent", color: "#F59E0B", icon: FileText },
  DeploymentScheduled: { label: "Deployment", color: "#F97316", icon: Truck },
  Won: { label: "Won", color: "#10B981", icon: Trophy },
  Lost: { label: "Lost", color: "#EF4444", icon: XCircle },
};

const ACTIVE_STAGES = ["Qualified", "SiteWalk", "QuoteSent", "DeploymentScheduled"];
const ALL_STAGES = [...ACTIVE_STAGES, "Won", "Lost"];

interface Opportunity {
  id: string;
  company: string;
  stage: string;
  next_action: string;
  next_action_due: string;
  owner: string;
  value_estimate: number | null;
  source: string;
  last_updated: string;
  notes: string;
}

interface Summary {
  stages: Record<string, { count: number; value: number }>;
  total_active: number;
  total_won: number;
  total_lost: number;
  total_value: number;
}

export default function PipelinePage() {
  const { getToken } = useAuth();
  const token = getToken();
  const [expandedOpp, setExpandedOpp] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery<Summary>({
    queryKey: ["/api/opportunities/summary"],
    enabled: !!token,
  });

  const queryUrl = stageFilter ? `/api/opportunities?stage=${stageFilter}` : "/api/opportunities";
  const { data: oppsData, isLoading: oppsLoading } = useQuery<{ opportunities: Opportunity[]; count: number }>({
    queryKey: ["/api/opportunities", stageFilter],
    queryFn: () => fetch(queryUrl, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: !!token,
  });

  const advanceMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      apiRequest("POST", `/api/opportunities/${id}/update`, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities/summary"] });
    },
  });

  const opportunities = oppsData?.opportunities || [];

  const nextStage = (current: string): string | null => {
    const idx = ACTIVE_STAGES.indexOf(current);
    if (idx === -1 || idx >= ACTIVE_STAGES.length - 1) return null;
    return ACTIVE_STAGES[idx + 1];
  };

  return (
    <AppLayout showBackToChip>
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <p className="text-xs font-mono tracking-wider uppercase mb-1" style={{ color: MUTED }}>Opportunity Pipeline</p>
          <h1 className="text-xl font-bold" style={{ color: TEXT }} data-testid="text-page-title">Pipeline</h1>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="pipeline-funnel">
          {ACTIVE_STAGES.map((stage) => {
            const meta = STAGE_META[stage];
            const count = summary?.stages?.[stage]?.count ?? 0;
            const isActive = stageFilter === stage;
            return (
              <button
                key={stage}
                onClick={() => setStageFilter(isActive ? null : stage)}
                className="rounded-xl p-4 text-left transition-all"
                style={{
                  background: isActive ? `${meta.color}10` : SUBTLE,
                  border: `1px solid ${isActive ? `${meta.color}40` : BORDER}`,
                }}
                data-testid={`funnel-${stage.toLowerCase()}`}
              >
                <meta.icon className="w-4 h-4 mb-2" style={{ color: meta.color }} />
                <p className="text-2xl font-bold font-mono" style={{ color: TEXT }}>{count}</p>
                <p className="text-xs font-medium" style={{ color: MUTED }}>{meta.label}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold font-mono" style={{ color: EMERALD }} data-testid="total-active">
                {summary?.total_active ?? 0}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>Active</p>
            </CardContent>
          </Card>
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold font-mono" style={{ color: "#10B981" }} data-testid="total-won">
                {summary?.total_won ?? 0}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>Won</p>
            </CardContent>
          </Card>
          <Card style={{ border: `1px solid ${BORDER}` }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold font-mono" style={{ color: "#EF4444" }} data-testid="total-lost">
                {summary?.total_lost ?? 0}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>Lost</p>
            </CardContent>
          </Card>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold" style={{ color: TEXT }}>
              {stageFilter ? STAGE_META[stageFilter]?.label || stageFilter : "All"} Opportunities
            </h2>
            {stageFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStageFilter(null)}
                className="text-xs"
                style={{ color: MUTED }}
                data-testid="clear-filter"
              >
                Show all
              </Button>
            )}
          </div>

          {(summaryLoading || oppsLoading) && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: MUTED }} />
            </div>
          )}

          {!oppsLoading && opportunities.length === 0 && (
            <Card style={{ border: `1px solid ${BORDER}` }}>
              <CardContent className="py-10 text-center">
                <Target className="w-8 h-8 mx-auto mb-3" style={{ color: MUTED }} />
                <p className="text-sm font-medium" style={{ color: TEXT }}>No opportunities yet</p>
                <p className="text-xs" style={{ color: MUTED }}>Log a Qualified or Won call to create one automatically.</p>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2" data-testid="opportunity-list">
            {opportunities.map((opp, idx) => {
              const meta = STAGE_META[opp.stage] || { label: opp.stage, color: MUTED, icon: Target };
              const isExpanded = expandedOpp === opp.id;
              const next = nextStage(opp.stage);
              const isOverdue = opp.next_action_due && new Date(opp.next_action_due) < new Date();

              return (
                <Card
                  key={opp.id}
                  className="overflow-hidden"
                  style={{ border: `1px solid ${BORDER}` }}
                  data-testid={`opportunity-row-${idx}`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
                        style={{ background: meta.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-sm font-semibold" style={{ color: TEXT }} data-testid={`opp-company-${idx}`}>
                            {opp.company}
                          </p>
                          <Badge
                            className="text-xs"
                            style={{ background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30` }}
                            data-testid={`opp-stage-${idx}`}
                          >
                            {meta.label}
                          </Badge>
                          {opp.value_estimate && (
                            <span className="text-xs font-mono" style={{ color: EMERALD }}>
                              ${opp.value_estimate.toLocaleString()}
                            </span>
                          )}
                        </div>

                        {opp.next_action && (
                          <p className="text-xs mb-1" style={{ color: isOverdue ? "#EF4444" : MUTED }} data-testid={`opp-action-${idx}`}>
                            {isOverdue ? "OVERDUE: " : ""}{opp.next_action}
                            {opp.next_action_due && (
                              <span className="ml-1 font-mono">
                                (due {new Date(opp.next_action_due).toLocaleDateString()})
                              </span>
                            )}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {next && (
                            <Button
                              size="sm"
                              onClick={() => advanceMutation.mutate({ id: opp.id, stage: next })}
                              disabled={advanceMutation.isPending}
                              className="rounded-lg text-xs font-semibold h-7 px-3"
                              style={{ background: STAGE_META[next].color, color: "#FFF" }}
                              data-testid={`advance-${idx}`}
                            >
                              <ArrowRight className="w-3 h-3 mr-1" />
                              {STAGE_META[next].label}
                            </Button>
                          )}
                          {opp.stage !== "Won" && opp.stage !== "Lost" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => advanceMutation.mutate({ id: opp.id, stage: "Won" })}
                              disabled={advanceMutation.isPending}
                              className="rounded-lg text-xs font-semibold h-7 px-3"
                              style={{ color: EMERALD }}
                              data-testid={`mark-won-${idx}`}
                            >
                              <Trophy className="w-3 h-3 mr-1" /> Won
                            </Button>
                          )}
                          <button
                            onClick={() => setExpandedOpp(isExpanded ? null : opp.id)}
                            className="ml-auto p-1 rounded"
                            style={{ color: MUTED }}
                            data-testid={`expand-opp-${idx}`}
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t" style={{ borderColor: BORDER }}>
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div className="rounded-lg p-3" style={{ background: SUBTLE }}>
                          <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: MUTED }}>Owner</p>
                          <p className="text-xs" style={{ color: TEXT }}>{opp.owner || "Unassigned"}</p>
                        </div>
                        <div className="rounded-lg p-3" style={{ background: SUBTLE }}>
                          <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: MUTED }}>Source</p>
                          <p className="text-xs" style={{ color: TEXT }}>{opp.source || "—"}</p>
                        </div>
                      </div>
                      {opp.notes && (
                        <div className="rounded-lg p-3 mt-3" style={{ background: SUBTLE }}>
                          <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: MUTED }}>Notes</p>
                          <p className="text-xs leading-relaxed whitespace-pre-line" style={{ color: TEXT }}>{opp.notes}</p>
                        </div>
                      )}
                      {opp.last_updated && (
                        <p className="text-xs font-mono mt-3" style={{ color: MUTED }}>
                          Last updated: {new Date(opp.last_updated).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
