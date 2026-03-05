import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Target,
  MapPin,
  FileText,
  Truck,
  Trophy,
  XCircle,
  ChevronRight,
  Loader2,
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";

const STAGE_META: Record<string, { label: string; color: string; icon: any; order: number }> = {
  Qualified: { label: "Qualified", color: "#3B82F6", icon: Target, order: 0 },
  SiteWalk: { label: "Site Walk", color: "#8B5CF6", icon: MapPin, order: 1 },
  QuoteSent: { label: "Quote Sent", color: "#F59E0B", icon: FileText, order: 2 },
  DeploymentScheduled: { label: "Deployment", color: "#F97316", icon: Truck, order: 3 },
  Won: { label: "Won", color: "#10B981", icon: Trophy, order: 4 },
  Lost: { label: "Lost", color: "#EF4444", icon: XCircle, order: 5 },
};

const ACTIVE_STAGES = ["Qualified", "SiteWalk", "QuoteSent", "DeploymentScheduled"];

export interface Opportunity {
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

interface DealCardProps {
  opportunity: Opportunity;
  compact?: boolean;
}

function invalidateOppQueries() {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey[0];
      return typeof key === "string" && key.startsWith("/api/opportunities");
    },
  });
}

export default function DealCard({ opportunity, compact = false }: DealCardProps) {
  const opp = opportunity;
  const meta = STAGE_META[opp.stage] || STAGE_META.Qualified;
  const [showStages, setShowStages] = useState(false);
  const [optimisticStage, setOptimisticStage] = useState<string | null>(null);

  const displayStage = optimisticStage || opp.stage;
  const displayMeta = STAGE_META[displayStage] || meta;
  const isTerminal = displayStage === "Won" || displayStage === "Lost";
  const isOverdue = opp.next_action_due && new Date(opp.next_action_due) < new Date();

  const currentIdx = ACTIVE_STAGES.indexOf(displayStage);
  const nextStage = currentIdx >= 0 && currentIdx < ACTIVE_STAGES.length - 1
    ? ACTIVE_STAGES[currentIdx + 1]
    : null;

  const advanceMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      apiRequest("POST", `/api/opportunities/${id}/update`, { stage }),
    onMutate: ({ stage }) => {
      setOptimisticStage(stage);
      setShowStages(false);
    },
    onSuccess: () => {
      invalidateOppQueries();
    },
    onSettled: () => {
      setOptimisticStage(null);
    },
  });

  const isPending = advanceMutation.isPending;

  return (
    <div
      className="rounded-lg p-2.5 mt-2"
      style={{
        background: `${displayMeta.color}06`,
        border: `1px solid ${displayMeta.color}20`,
      }}
      data-testid={`deal-card-${opp.id}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <displayMeta.icon className="w-3 h-3 flex-shrink-0" style={{ color: displayMeta.color }} />
        <span
          className="text-xs font-semibold px-1.5 py-0.5 rounded"
          style={{ background: `${displayMeta.color}15`, color: displayMeta.color }}
          data-testid={`deal-stage-${opp.id}`}
        >
          {displayMeta.label}
        </span>

        {!isTerminal && (
          <>
            {nextStage && (
              <button
                onClick={() => advanceMutation.mutate({ id: opp.id, stage: nextStage })}
                disabled={isPending}
                className="flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-md transition-all hover:opacity-80"
                style={{
                  background: `${STAGE_META[nextStage].color}12`,
                  color: STAGE_META[nextStage].color,
                  border: `1px solid ${STAGE_META[nextStage].color}25`,
                }}
                data-testid={`deal-advance-${opp.id}`}
              >
                {isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <>
                    <ChevronRight className="w-3 h-3" />
                    {STAGE_META[nextStage].label}
                  </>
                )}
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setShowStages(!showStages)}
                className="text-xs px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                style={{ color: MUTED, border: `1px solid ${BORDER}`, background: "#FFF" }}
                data-testid={`deal-more-${opp.id}`}
              >
                ···
              </button>

              {showStages && (
                <div
                  className="absolute top-full left-0 mt-1 rounded-lg shadow-lg py-1 z-20"
                  style={{ background: "#FFF", border: `1px solid ${BORDER}`, minWidth: 140 }}
                >
                  {ACTIVE_STAGES.filter(s => s !== displayStage).map(s => {
                    const sm = STAGE_META[s];
                    return (
                      <button
                        key={s}
                        onClick={() => advanceMutation.mutate({ id: opp.id, stage: s })}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50"
                        style={{ color: TEXT }}
                        data-testid={`deal-set-${s.toLowerCase()}-${opp.id}`}
                      >
                        <sm.icon className="w-3 h-3" style={{ color: sm.color }} />
                        {sm.label}
                      </button>
                    );
                  })}
                  <div style={{ borderTop: `1px solid ${BORDER}`, margin: "2px 0" }} />
                  <button
                    onClick={() => advanceMutation.mutate({ id: opp.id, stage: "Won" })}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50"
                    style={{ color: EMERALD }}
                    data-testid={`deal-won-${opp.id}`}
                  >
                    <Trophy className="w-3 h-3" /> Won
                  </button>
                  <button
                    onClick={() => advanceMutation.mutate({ id: opp.id, stage: "Lost" })}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50"
                    style={{ color: "#EF4444" }}
                    data-testid={`deal-lost-${opp.id}`}
                  >
                    <XCircle className="w-3 h-3" /> Lost
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {opp.value_estimate && (
          <span className="text-xs font-mono ml-auto" style={{ color: EMERALD }}>
            ${opp.value_estimate.toLocaleString()}
          </span>
        )}
      </div>

      {!compact && opp.next_action && (
        <p
          className="text-xs mt-1.5 pl-5"
          style={{ color: isOverdue ? "#EF4444" : MUTED }}
          data-testid={`deal-action-${opp.id}`}
        >
          {isOverdue ? "OVERDUE: " : ""}{opp.next_action}
          {opp.next_action_due && (
            <span className="font-mono ml-1">
              (due {new Date(opp.next_action_due).toLocaleDateString()})
            </span>
          )}
        </p>
      )}
    </div>
  );
}
