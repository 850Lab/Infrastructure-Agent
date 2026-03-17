import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import {
  Loader2, RefreshCw, ChevronDown, ChevronUp,
  Mail, Phone, Search, AlertTriangle, TrendingUp, Zap, Target, Shield,
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";
const PURPLE = "#8B5CF6";
const ERROR = "#EF4444";
const ORANGE = "#F97316";

interface FlowScore {
  id: number;
  companyId: string;
  companyName: string;
  contactName: string | null;
  status: string;
  revenuePotentialScore: number | null;
  reachabilityScore: number | null;
  heatRelevanceScore: number | null;
  contactConfidenceScore: number | null;
  compositeScore: number | null;
  bestChannel: string | null;
  routingReason: string | null;
  bestContactPath: string | null;
  scoringSignals: any;
  enrichmentStatus: string | null;
  lastEnrichedAt: string | null;
  warmStage: string | null;
  verifiedQualityScore: number | null;
  lastOutcome: string | null;
}

interface ScoresResponse {
  totalFlows: number;
  scored: number;
  unscored: number;
  avgCompositeScore: number;
  channelBreakdown: { email: number; call: number; research_more: number; discard: number };
  flows: FlowScore[];
}

const CHANNEL_ICONS: Record<string, any> = {
  email: Mail,
  call: Phone,
  research_more: Search,
  discard: AlertTriangle,
};

const CHANNEL_COLORS: Record<string, string> = {
  email: BLUE,
  call: EMERALD,
  research_more: AMBER,
  discard: ERROR,
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email First",
  call: "Call First",
  research_more: "Research More",
  discard: "Low Priority",
};

function ScoreBar({ value, color, label }: { value: number | null; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-[9px] font-medium w-14 text-right shrink-0" style={{ color: MUTED }}>{label}</div>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: `${color}15` }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value || 0}%`, background: color }} />
      </div>
      <div className="text-[10px] font-bold w-6 text-right" style={{ color: (value || 0) >= 70 ? color : MUTED }}>{value ?? "--"}</div>
    </div>
  );
}

function FlowCard({ flow }: { flow: FlowScore }) {
  const [expanded, setExpanded] = useState(false);
  const channelColor = CHANNEL_COLORS[flow.bestChannel || ""] || MUTED;
  const ChannelIcon = CHANNEL_ICONS[flow.bestChannel || ""] || Target;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: "white" }} data-testid={`intelligence-card-${flow.id}`}>
      <button
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`intelligence-toggle-${flow.id}`}
      >
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0" style={{
          background: (flow.compositeScore || 0) >= 70 ? EMERALD : (flow.compositeScore || 0) >= 40 ? AMBER : ERROR,
          color: "white",
        }}>
          {flow.compositeScore ?? "?"}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold truncate" style={{ color: TEXT }}>{flow.companyName}</div>
          <div className="text-[10px]" style={{ color: MUTED }}>
            {flow.contactName || "No contact"} {flow.lastOutcome ? `| ${flow.lastOutcome}` : ""}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold" style={{
            background: `${channelColor}12`,
            color: channelColor,
          }}>
            <ChannelIcon className="w-3 h-3" />
            {CHANNEL_LABELS[flow.bestChannel || ""] || "Pending"}
          </div>
          {flow.warmStage && (
            <div className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${PURPLE}12`, color: PURPLE }}>
              {flow.warmStage.replace(/_/g, " ")}
            </div>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: MUTED }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: MUTED }} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3" style={{ borderColor: BORDER }}>
          <div className="space-y-1.5">
            <ScoreBar value={flow.revenuePotentialScore} color={EMERALD} label="Revenue" />
            <ScoreBar value={flow.reachabilityScore} color={BLUE} label="Reach" />
            <ScoreBar value={flow.heatRelevanceScore} color={ORANGE} label="Heat" />
            <ScoreBar value={flow.contactConfidenceScore} color={PURPLE} label="Contact" />
          </div>

          {flow.routingReason && (
            <div className="text-[10px] p-2 rounded" style={{ background: `${BLUE}06`, border: `1px solid ${BLUE}15`, color: TEXT }}>
              <span className="font-bold" style={{ color: BLUE }}>Routing: </span>{flow.routingReason}
            </div>
          )}

          {flow.bestContactPath && (
            <div className="text-[10px] p-2 rounded" style={{ background: `${EMERALD}06`, border: `1px solid ${EMERALD}15`, color: TEXT }}>
              <span className="font-bold" style={{ color: EMERALD }}>Contact Path: </span>{flow.bestContactPath}
            </div>
          )}

          {flow.scoringSignals && (
            <div className="space-y-2">
              {Object.entries(flow.scoringSignals as Record<string, string[]>).map(([key, reasons]) => {
                if (!Array.isArray(reasons) || reasons.length === 0) return null;
                const labelMap: Record<string, { label: string; color: string }> = {
                  revenuePotentialReasons: { label: "Revenue Signals", color: EMERALD },
                  reachabilityReasons: { label: "Reachability", color: BLUE },
                  heatRelevanceReasons: { label: "Heat Relevance", color: ORANGE },
                  contactConfidenceReasons: { label: "Contact Quality", color: PURPLE },
                };
                const meta = labelMap[key];
                if (!meta) return null;
                return (
                  <div key={key}>
                    <div className="text-[9px] font-bold uppercase mb-0.5" style={{ color: meta.color }}>{meta.label}</div>
                    {reasons.map((r: string, i: number) => (
                      <div key={i} className="flex items-start gap-1.5 mb-0.5">
                        <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: meta.color }} />
                        <span className="text-[10px]" style={{ color: TEXT }}>{r}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 text-[9px]" style={{ color: MUTED }}>
            <span>Status: {flow.enrichmentStatus || "pending"}</span>
            {flow.lastEnrichedAt && <span>| Scored: {new Date(flow.lastEnrichedAt).toLocaleDateString()}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeadIntelligencePage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<ScoresResponse>({
    queryKey: ["/api/lead-intelligence/scores"],
  });

  const scoreMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/lead-intelligence/score-all");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-intelligence/scores"] });
      toast({ title: "Scoring complete", description: `${data.scored} flows scored, ${data.errors} errors` });
    },
    onError: (err: any) => {
      toast({ title: "Scoring failed", description: err.message, variant: "destructive" });
    },
  });

  const flows = data?.flows || [];
  const filtered = filter === "all" ? flows
    : filter === "unscored" ? flows.filter(f => f.compositeScore === null)
    : flows.filter(f => f.bestChannel === filter);

  return (
    <AppLayout title="Lead Intelligence">
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold" style={{ color: TEXT }} data-testid="page-title-intelligence">Lead Intelligence</h1>
            <p className="text-[12px]" style={{ color: MUTED }}>Multi-signal scoring, channel routing, and contact path analysis</p>
          </div>
          <Button
            onClick={() => scoreMutation.mutate()}
            disabled={scoreMutation.isPending}
            className="gap-2 text-[11px]"
            style={{ background: EMERALD }}
            data-testid="score-all-button"
          >
            {scoreMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Score All Flows
          </Button>
        </div>

        {data && (
          <div className="grid grid-cols-4 gap-3" data-testid="intelligence-summary">
            <div className="rounded-lg p-3" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="text-[10px] font-medium" style={{ color: MUTED }}>Active Flows</div>
              <div className="text-xl font-bold" style={{ color: TEXT }}>{data.totalFlows}</div>
              <div className="text-[10px]" style={{ color: MUTED }}>{data.scored} scored, {data.unscored} pending</div>
            </div>
            <div className="rounded-lg p-3" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="text-[10px] font-medium" style={{ color: MUTED }}>Avg Composite</div>
              <div className="text-xl font-bold" style={{ color: data.avgCompositeScore >= 60 ? EMERALD : data.avgCompositeScore >= 35 ? AMBER : ERROR }}>{data.avgCompositeScore}</div>
              <div className="text-[10px]" style={{ color: MUTED }}>across all scored flows</div>
            </div>
            <div className="rounded-lg p-3" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="text-[10px] font-medium" style={{ color: MUTED }}>Channel Split</div>
              <div className="flex items-center gap-1 mt-1">
                <div className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: BLUE }}>
                  <Mail className="w-3 h-3" /> {data.channelBreakdown.email}
                </div>
                <div className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: EMERALD }}>
                  <Phone className="w-3 h-3" /> {data.channelBreakdown.call}
                </div>
                <div className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: AMBER }}>
                  <Search className="w-3 h-3" /> {data.channelBreakdown.research_more}
                </div>
              </div>
            </div>
            <div className="rounded-lg p-3" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="text-[10px] font-medium" style={{ color: MUTED }}>Score Buckets</div>
              <div className="flex items-center gap-2 mt-1">
                {[
                  { label: "High", count: flows.filter(f => (f.compositeScore || 0) >= 70).length, color: EMERALD },
                  { label: "Med", count: flows.filter(f => (f.compositeScore || 0) >= 40 && (f.compositeScore || 0) < 70).length, color: AMBER },
                  { label: "Low", count: flows.filter(f => f.compositeScore !== null && (f.compositeScore || 0) < 40).length, color: ERROR },
                ].map(b => (
                  <div key={b.label} className="text-center">
                    <div className="text-[13px] font-bold" style={{ color: b.color }}>{b.count}</div>
                    <div className="text-[8px]" style={{ color: MUTED }}>{b.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap" data-testid="channel-filters">
          {[
            { key: "all", label: "All", icon: Target },
            { key: "email", label: "Email First", icon: Mail },
            { key: "call", label: "Call First", icon: Phone },
            { key: "research_more", label: "Research", icon: Search },
            { key: "unscored", label: "Unscored", icon: AlertTriangle },
          ].map(f => (
            <button
              key={f.key}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-semibold transition-all"
              style={{
                background: filter === f.key ? `${EMERALD}12` : "white",
                color: filter === f.key ? EMERALD : MUTED,
                border: `1px solid ${filter === f.key ? `${EMERALD}30` : BORDER}`,
              }}
              onClick={() => setFilter(f.key)}
              data-testid={`filter-${f.key}`}
            >
              <f.icon className="w-3 h-3" />
              {f.label}
              <span className="ml-0.5 px-1 py-0 rounded-full text-[9px]" style={{
                background: filter === f.key ? `${EMERALD}20` : `${MUTED}15`,
              }}>
                {f.key === "all" ? flows.length
                  : f.key === "unscored" ? flows.filter(fl => fl.compositeScore === null).length
                  : flows.filter(fl => fl.bestChannel === f.key).length}
              </span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Zap className="w-8 h-8 mx-auto mb-2" style={{ color: MUTED }} />
            <div className="text-[12px] font-medium" style={{ color: MUTED }}>
              {filter === "unscored" ? "All flows have been scored" : "No flows match this filter"}
            </div>
            {data?.unscored && data.unscored > 0 && (
              <Button
                onClick={() => scoreMutation.mutate()}
                className="mt-3 text-[11px]"
                style={{ background: EMERALD }}
                data-testid="score-empty-state"
              >
                Score {data.unscored} Flows
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(flow => <FlowCard key={flow.id} flow={flow} />)}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
