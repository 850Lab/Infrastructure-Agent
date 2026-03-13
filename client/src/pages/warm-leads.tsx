import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, ChevronDown, ChevronUp, AlertTriangle, Calendar, FileText,
  MessageSquare, Phone, Mail, ArrowRight, Clock, User, MapPin, Flame,
  CheckCircle2, XCircle, Send, Handshake, Target, Activity, Brain,
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const ERROR = "#EF4444";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";
const PURPLE = "#8B5CF6";

const WARM_STAGES: Record<string, { label: string; color: string; icon: any; order: number }> = {
  initial_interest: { label: "Initial Interest", color: BLUE, icon: Target, order: 0 },
  proposal_sent: { label: "Proposal Sent", color: PURPLE, icon: FileText, order: 1 },
  meeting_scheduled: { label: "Meeting Scheduled", color: AMBER, icon: Calendar, order: 2 },
  negotiating: { label: "Negotiating", color: "#F97316", icon: Handshake, order: 3 },
  verbal_commit: { label: "Verbal Commit", color: EMERALD, icon: CheckCircle2, order: 4 },
  closed_won: { label: "Closed Won", color: EMERALD, icon: CheckCircle2, order: 5 },
  closed_lost: { label: "Closed Lost", color: ERROR, icon: XCircle, order: 6 },
};

const STAGE_PROGRESSION = ["initial_interest", "proposal_sent", "meeting_scheduled", "negotiating", "verbal_commit", "closed_won"];

interface WarmLead {
  flowId: number;
  companyId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  flowType: string;
  lastOutcome: string | null;
  outcomeSource: string | null;
  warmStage: string;
  warmStageUpdatedAt: string | null;
  nextAction: string | null;
  nextDueAt: string | null;
  lastAttemptAt: string | null;
  priority: number;
  verifiedQualityScore: number | null;
  verifiedQualityLabel: string | null;
  transcriptSummary: string | null;
  buyingSignals: string[];
  objections: string[];
  nextStepReason: string | null;
  notes: string | null;
  urgency: "critical" | "high" | "normal" | "low";
  isOverdue: boolean;
  daysSinceActivity: number | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  attemptCount: number;
}

interface TimelineEvent {
  type: string;
  channel: string;
  outcome?: string;
  notes?: string;
  contactName?: string;
  capturedInfo?: string;
  subject?: string;
  contactEmail?: string;
  status?: string;
  openCount?: number;
  clickCount?: number;
  replyDetectedAt?: string;
  touchNumber?: number;
  duration?: number;
  transcription?: string;
  analysis?: string;
  body?: string;
  fromNumber?: string;
  fromEmail?: string;
  snippet?: string;
  timestamp: string;
}

interface WarmLeadsResponse {
  leads: WarmLead[];
  stats: {
    total: number;
    overdue: number;
    meetingsToday: number;
    needsProposal: number;
    activeDeals: number;
  };
}

function StatCard({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon: any }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: `${color}06`, border: `1px solid ${color}20` }} data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}12` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div>
        <div className="text-2xl font-bold" style={{ color: TEXT }}>{value}</div>
        <div className="text-[11px] font-medium" style={{ color: MUTED }}>{label}</div>
      </div>
    </div>
  );
}

function StageProgressBar({ currentStage }: { currentStage: string }) {
  const currentOrder = WARM_STAGES[currentStage]?.order ?? 0;
  const activeStages = STAGE_PROGRESSION.slice(0, -1);
  return (
    <div className="flex items-center gap-0.5 w-full">
      {activeStages.map((stage, i) => {
        const meta = WARM_STAGES[stage];
        const isActive = meta.order <= currentOrder && currentStage !== "closed_lost";
        const isCurrent = stage === currentStage;
        return (
          <div key={stage} className="flex-1 relative group">
            <div
              className="h-2 rounded-full transition-all"
              style={{
                background: isActive ? meta.color : `${BORDER}`,
                boxShadow: isCurrent ? `0 0 0 2px ${meta.color}40` : "none",
              }}
            />
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: TEXT, color: "white" }}>{meta.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineItem({ event }: { event: TimelineEvent }) {
  const channelConfig: Record<string, { icon: any; color: string; label: string }> = {
    call: { icon: Phone, color: EMERALD, label: "Call" },
    email: { icon: Mail, color: BLUE, label: "Email" },
    sms: { icon: MessageSquare, color: PURPLE, label: "SMS" },
    linkedin: { icon: Send, color: "#0A66C2", label: "LinkedIn" },
  };

  const config = channelConfig[event.channel] || channelConfig.call;
  const Icon = config.icon;
  const date = new Date(event.timestamp);
  const timeStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " at " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  let title = "";
  let detail = "";

  if (event.type === "attempt") {
    title = `${config.label} ${event.outcome || "attempt"}`;
    detail = event.notes || "";
    if (event.capturedInfo) detail += (detail ? " — " : "") + event.capturedInfo;
  } else if (event.type === "email_sent") {
    title = `Email sent: ${event.subject || "(no subject)"}`;
    const parts = [];
    if (event.openCount && event.openCount > 0) parts.push(`opened ${event.openCount}x`);
    if (event.clickCount && event.clickCount > 0) parts.push(`clicked ${event.clickCount}x`);
    if (event.replyDetectedAt) parts.push("replied");
    detail = parts.join(", ") || `Touch #${event.touchNumber || "?"}`;
  } else if (event.type === "call_recording") {
    title = `Call recorded (${event.duration ? Math.round(event.duration / 60) + "m" : "?"})`;
    detail = event.transcription || "";
  } else if (event.type === "sms_inbound") {
    title = `SMS received from ${event.fromNumber || "unknown"}`;
    detail = event.body || "";
  } else if (event.type === "email_reply") {
    title = `Email reply from ${event.fromEmail || "unknown"}`;
    detail = event.snippet || "";
  }

  return (
    <div className="flex gap-3 relative" data-testid={`timeline-event-${event.type}`}>
      <div className="flex flex-col items-center">
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `${config.color}12`, border: `1px solid ${config.color}25` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
        </div>
        <div className="flex-1 w-px mt-1" style={{ background: BORDER }} />
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: TEXT }}>{title}</span>
          {event.outcome && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${config.color}10`, color: config.color }}>{event.outcome}</span>
          )}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: MUTED }}>{timeStr}</div>
        {detail && <div className="text-[11px] mt-1 leading-relaxed line-clamp-3" style={{ color: "#475569" }}>{detail}</div>}
      </div>
    </div>
  );
}

function WarmLeadRow({ lead }: { lead: WarmLead }) {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState("");
  const { toast } = useToast();

  const stageMeta = WARM_STAGES[lead.warmStage] || WARM_STAGES.initial_interest;
  const StageIcon = stageMeta.icon;

  const { data: timeline, isLoading: timelineLoading } = useQuery<{ events: TimelineEvent[] }>({
    queryKey: ["/api/warm-leads", lead.companyId, "timeline"],
    enabled: expanded,
  });

  const stageMutation = useMutation({
    mutationFn: async (stage: string) => {
      const res = await apiRequest("PATCH", `/api/warm-leads/${lead.flowId}/stage`, { stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/warm-leads"] });
      toast({ title: "Stage updated" });
    },
  });

  const noteMutation = useMutation({
    mutationFn: async (note: string) => {
      const res = await apiRequest("POST", `/api/warm-leads/${lead.flowId}/notes`, { note });
      return res.json();
    },
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/warm-leads"] });
      toast({ title: "Note added" });
    },
  });

  const currentOrder = stageMeta.order;
  const nextStage = STAGE_PROGRESSION.find(s => WARM_STAGES[s].order === currentOrder + 1);

  const urgencyConfig: Record<string, { color: string; label: string }> = {
    critical: { color: ERROR, label: "OVERDUE" },
    high: { color: AMBER, label: "FOLLOW UP" },
    normal: { color: EMERALD, label: "ON TRACK" },
    low: { color: MUTED, label: "CLOSED" },
  };

  const urg = urgencyConfig[lead.urgency];

  return (
    <div className="rounded-xl overflow-hidden transition-all" style={{ border: `1px solid ${lead.urgency === "critical" ? `${ERROR}40` : BORDER}`, background: lead.urgency === "critical" ? `${ERROR}02` : "white" }} data-testid={`warm-lead-${lead.flowId}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50/50 transition-colors"
        data-testid={`expand-warm-lead-${lead.flowId}`}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${stageMeta.color}10`, border: `1px solid ${stageMeta.color}20` }}>
          <StageIcon className="w-4 h-4" style={{ color: stageMeta.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold truncate" style={{ color: TEXT }}>{lead.companyName}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold shrink-0" style={{ background: `${urg.color}10`, color: urg.color, border: `1px solid ${urg.color}25` }}>{urg.label}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {lead.contactName && <span className="text-[10px] flex items-center gap-1" style={{ color: MUTED }}><User className="w-3 h-3" />{lead.contactName}</span>}
            {(lead.city || lead.state) && <span className="text-[10px] flex items-center gap-1" style={{ color: MUTED }}><MapPin className="w-3 h-3" />{[lead.city, lead.state].filter(Boolean).join(", ")}</span>}
            <span className="text-[10px]" style={{ color: MUTED }}>{lead.attemptCount} touches</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${stageMeta.color}10`, color: stageMeta.color }}>{stageMeta.label}</div>
            {lead.nextDueAt && (
              <div className="text-[9px] mt-0.5 flex items-center gap-1 justify-end" style={{ color: lead.isOverdue ? ERROR : MUTED }}>
                <Clock className="w-3 h-3" />
                {new Date(lead.nextDueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
            )}
          </div>
          {lead.verifiedQualityScore !== null && (
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold" style={{
              background: lead.verifiedQualityScore >= 7 ? EMERALD : lead.verifiedQualityScore >= 4 ? AMBER : ERROR,
              color: "white",
            }}>{lead.verifiedQualityScore}</div>
          )}
          {expanded ? <ChevronUp className="w-4 h-4" style={{ color: MUTED }} /> : <ChevronDown className="w-4 h-4" style={{ color: MUTED }} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 pb-4 space-y-4" style={{ borderColor: BORDER }}>
          <div className="pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: MUTED }}>Deal Stage</div>
            <StageProgressBar currentStage={lead.warmStage} />
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {nextStage && lead.warmStage !== "closed_won" && lead.warmStage !== "closed_lost" && (
                <Button
                  size="sm"
                  className="text-[11px] h-7 gap-1"
                  style={{ background: WARM_STAGES[nextStage].color, color: "white" }}
                  onClick={() => stageMutation.mutate(nextStage)}
                  disabled={stageMutation.isPending}
                  data-testid={`advance-stage-${lead.flowId}`}
                >
                  {stageMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                  Advance to {WARM_STAGES[nextStage].label}
                </Button>
              )}
              {lead.warmStage !== "closed_won" && lead.warmStage !== "closed_lost" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[11px] h-7 gap-1"
                    style={{ borderColor: `${EMERALD}40`, color: EMERALD }}
                    onClick={() => stageMutation.mutate("closed_won")}
                    disabled={stageMutation.isPending}
                    data-testid={`close-won-${lead.flowId}`}
                  >
                    <CheckCircle2 className="w-3 h-3" /> Close Won
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[11px] h-7 gap-1"
                    style={{ borderColor: `${ERROR}40`, color: ERROR }}
                    onClick={() => stageMutation.mutate("closed_lost")}
                    disabled={stageMutation.isPending}
                    data-testid={`close-lost-${lead.flowId}`}
                  >
                    <XCircle className="w-3 h-3" /> Close Lost
                  </Button>
                </>
              )}
            </div>
          </div>

          {(lead.transcriptSummary || lead.buyingSignals.length > 0 || lead.objections.length > 0) && (
            <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: MUTED }}>Transcript Intelligence</div>
              {lead.transcriptSummary && <div className="text-[11px] leading-relaxed mb-2" style={{ color: TEXT }}>{lead.transcriptSummary}</div>}
              <div className="grid grid-cols-2 gap-3">
                {lead.buyingSignals.length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold uppercase mb-1" style={{ color: EMERALD }}>Buying Signals</div>
                    {lead.buyingSignals.map((s, i) => (
                      <div key={i} className="flex items-start gap-1 mb-0.5">
                        <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: EMERALD }} />
                        <span className="text-[10px]" style={{ color: TEXT }}>{s}</span>
                      </div>
                    ))}
                  </div>
                )}
                {lead.objections.length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold uppercase mb-1" style={{ color: ERROR }}>Objections</div>
                    {lead.objections.map((s, i) => (
                      <div key={i} className="flex items-start gap-1 mb-0.5">
                        <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: ERROR }} />
                        <span className="text-[10px]" style={{ color: TEXT }}>{s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {lead.nextStepReason && (
                <div className="mt-2 text-[10px] p-2 rounded" style={{ background: `${BLUE}06`, border: `1px solid ${BLUE}15`, color: TEXT }}>
                  <span className="font-bold" style={{ color: BLUE }}>Next Step: </span>{lead.nextStepReason}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: MUTED }}>Relationship Timeline</div>
            {timelineLoading ? (
              <div className="flex items-center gap-2 py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: MUTED }} />
                <span className="text-xs" style={{ color: MUTED }}>Loading timeline...</span>
              </div>
            ) : timeline?.events && timeline.events.length > 0 ? (
              <div className="max-h-80 overflow-y-auto pr-2" data-testid={`timeline-${lead.companyId}`}>
                {timeline.events.map((ev, i) => (
                  <TimelineItem key={i} event={ev} />
                ))}
              </div>
            ) : (
              <div className="text-xs py-3 text-center" style={{ color: MUTED }}>No interaction history yet</div>
            )}
          </div>

          {lead.notes && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Notes</div>
              <div className="text-[11px] whitespace-pre-wrap leading-relaxed p-2 rounded" style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }}>{lead.notes}</div>
            </div>
          )}

          <div className="flex gap-2">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note..."
              className="text-xs min-h-[36px] h-9 resize-none flex-1"
              style={{ borderColor: BORDER }}
              data-testid={`note-input-${lead.flowId}`}
            />
            <Button
              size="sm"
              className="h-9 px-3"
              style={{ background: EMERALD, color: "white" }}
              disabled={!noteText.trim() || noteMutation.isPending}
              onClick={() => noteText.trim() && noteMutation.mutate(noteText.trim())}
              data-testid={`add-note-${lead.flowId}`}
            >
              {noteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface DeepAnalysisResult {
  totalRecords: number;
  analyzed: number;
  contactsExtracted: number;
  qualityAnalyzed: number;
  pipelineUpdated: number;
  flowsUpdated: number;
  details: { company: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; extractedNotes: string; qualityScore: number | null }[];
  errors: string[];
}

export default function WarmLeadsPage() {
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<DeepAnalysisResult | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<WarmLeadsResponse>({
    queryKey: ["/api/warm-leads"],
  });

  const deepAnalysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/warm-leads/deep-analysis");
      return res.json();
    },
    onSuccess: (data: DeepAnalysisResult) => {
      setAnalysisResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/warm-leads"] });
      toast({ title: `Analyzed ${data.analyzed} records`, description: `${data.contactsExtracted} contacts extracted, ${data.pipelineUpdated} pipeline records updated` });
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const leads = data?.leads || [];
  const stats = data?.stats || { total: 0, overdue: 0, meetingsToday: 0, needsProposal: 0, activeDeals: 0 };

  const filtered = stageFilter ? leads.filter(l => l.warmStage === stageFilter) : leads;

  return (
    <AppLayout>
      <div className="min-h-screen" style={{ background: SUBTLE }}>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: TEXT }} data-testid="page-title">Warm Leads</h1>
              <p className="text-sm mt-0.5" style={{ color: MUTED }}>Active deals and relationship management</p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                className="text-[11px] h-8 gap-1.5"
                style={{ background: PURPLE, color: "white" }}
                onClick={() => deepAnalysisMutation.mutate()}
                disabled={deepAnalysisMutation.isPending}
                data-testid="deep-analysis-btn"
              >
                {deepAnalysisMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                {deepAnalysisMutation.isPending ? "Analyzing..." : "Analyze All Transcripts"}
              </Button>
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5" style={{ color: AMBER }} />
                <span className="text-sm font-bold" style={{ color: TEXT }}>{stats.activeDeals} active</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-testid="warm-stats">
            <StatCard label="Overdue Follow-ups" value={stats.overdue} color={ERROR} icon={AlertTriangle} />
            <StatCard label="Meetings Today" value={stats.meetingsToday} color={BLUE} icon={Calendar} />
            <StatCard label="Needs Proposal" value={stats.needsProposal} color={PURPLE} icon={FileText} />
            <StatCard label="Active Deals" value={stats.activeDeals} color={EMERALD} icon={Activity} />
          </div>

          {analysisResult && (
            <div className="rounded-xl p-4 mb-6" style={{ background: `${PURPLE}04`, border: `1px solid ${PURPLE}20` }} data-testid="analysis-results">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4" style={{ color: PURPLE }} />
                  <span className="text-sm font-bold" style={{ color: TEXT }}>Deep Analysis Results</span>
                </div>
                <button onClick={() => setAnalysisResult(null)} className="text-xs px-2 py-0.5 rounded" style={{ color: MUTED }}>Dismiss</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div className="text-center p-2 rounded-lg" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="text-lg font-bold" style={{ color: TEXT }}>{analysisResult.analyzed}</div>
                  <div className="text-[10px]" style={{ color: MUTED }}>Records Analyzed</div>
                </div>
                <div className="text-center p-2 rounded-lg" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="text-lg font-bold" style={{ color: EMERALD }}>{analysisResult.contactsExtracted}</div>
                  <div className="text-[10px]" style={{ color: MUTED }}>Contacts Found</div>
                </div>
                <div className="text-center p-2 rounded-lg" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="text-lg font-bold" style={{ color: BLUE }}>{analysisResult.pipelineUpdated}</div>
                  <div className="text-[10px]" style={{ color: MUTED }}>Pipeline Updated</div>
                </div>
                <div className="text-center p-2 rounded-lg" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="text-lg font-bold" style={{ color: PURPLE }}>{analysisResult.qualityAnalyzed}</div>
                  <div className="text-[10px]" style={{ color: MUTED }}>Transcripts Scored</div>
                </div>
              </div>
              {analysisResult.details.length > 0 && (
                <div className="space-y-1.5">
                  {analysisResult.details.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg text-xs" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                      <span className="font-bold flex-shrink-0" style={{ color: TEXT }}>{d.company}</span>
                      {d.contactName && <span className="flex items-center gap-1" style={{ color: EMERALD }}><User className="w-3 h-3" />{d.contactName}</span>}
                      {d.contactEmail && <span className="flex items-center gap-1" style={{ color: BLUE }}><Mail className="w-3 h-3" />{d.contactEmail}</span>}
                      {d.contactPhone && <span className="flex items-center gap-1" style={{ color: PURPLE }}><Phone className="w-3 h-3" />{d.contactPhone}</span>}
                      {d.qualityScore !== null && (
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0" style={{
                          background: d.qualityScore >= 7 ? EMERALD : d.qualityScore >= 4 ? AMBER : ERROR, color: "white",
                        }}>{d.qualityScore}</span>
                      )}
                      <span className="text-[10px] flex-1 truncate" style={{ color: MUTED }}>{d.extractedNotes}</span>
                    </div>
                  ))}
                </div>
              )}
              {analysisResult.errors.length > 0 && (
                <div className="mt-2 text-[10px]" style={{ color: ERROR }}>{analysisResult.errors.length} errors: {analysisResult.errors.slice(0, 3).join("; ")}</div>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5 mb-4 flex-wrap" data-testid="stage-filters">
            <button
              onClick={() => setStageFilter(null)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
              style={{
                background: stageFilter === null ? TEXT : `${BORDER}60`,
                color: stageFilter === null ? "white" : MUTED,
              }}
              data-testid="filter-all"
            >
              All ({leads.length})
            </button>
            {Object.entries(WARM_STAGES).map(([key, meta]) => {
              const count = leads.filter(l => l.warmStage === key).length;
              if (count === 0) return null;
              return (
                <button
                  key={key}
                  onClick={() => setStageFilter(stageFilter === key ? null : key)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                  style={{
                    background: stageFilter === key ? meta.color : `${meta.color}10`,
                    color: stageFilter === key ? "white" : meta.color,
                    border: `1px solid ${stageFilter === key ? meta.color : `${meta.color}25`}`,
                  }}
                  data-testid={`filter-${key}`}
                >
                  {meta.label} ({count})
                </button>
              );
            })}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 rounded-xl" style={{ background: "white", border: `1px solid ${BORDER}` }} data-testid="empty-state">
              <Flame className="w-10 h-10 mx-auto mb-3" style={{ color: MUTED }} />
              <div className="text-sm font-bold" style={{ color: TEXT }}>No warm leads yet</div>
              <div className="text-xs mt-1" style={{ color: MUTED }}>Leads show up here when they respond to outreach, answer calls, or show interest</div>
            </div>
          ) : (
            <div className="space-y-2" data-testid="warm-leads-list">
              {filtered.map(lead => (
                <WarmLeadRow key={lead.flowId} lead={lead} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
