import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import {
  Loader2, RefreshCw, ChevronDown, ChevronUp,
  Mail, Phone, Search, AlertTriangle, TrendingUp, Zap, Target, Shield,
  Microscope, ArrowRightLeft, Ban, Users, Globe,
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
  researchBlockerReasons: string | null;
  researchConvertedFrom: string | null;
  deepEnrichmentRan: boolean;
  deepResearchRan?: boolean;
  deepResearchBlockerReasons?: string | null;
  deepResearchSignals?: string | null;
  deepResearchBestInferredEmail?: string | null;
  deepResearchBestInferredEmailConfidence?: number | null;
  deepResearchSelectedRole?: string | null;
  discoveredContacts: string | null;
  phonePaths: string | null;
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

interface InferredContact {
  id: number;
  inferredEmail: string;
  emailConfidenceScore: number;
  decisionMakerRole: string;
  roleConfidenceScore: number;
  evidence: string | null;
  personName: string | null;
  personTitle: string | null;
}

function InferredContactRow({ contact }: { contact: InferredContact }) {
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <div className="text-[10px]">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Users className="w-3 h-3 shrink-0" style={{ color: BLUE }} />
        <span className="font-medium">{contact.personName || "Unknown"}</span>
        {contact.personTitle && <span style={{ color: MUTED }}>— {contact.personTitle}</span>}
        <span style={{ color: BLUE }}>{contact.inferredEmail}</span>
        <span className="px-1 py-0 rounded text-[9px] font-semibold" style={{ background: `${BLUE}15`, color: BLUE }}>{contact.emailConfidenceScore}</span>
      </div>
      {contact.evidence && (
        <button
          type="button"
          onClick={() => setShowEvidence(!showEvidence)}
          className="text-[9px] mt-0.5 font-medium"
          style={{ color: MUTED }}
        >
          {showEvidence ? "Hide evidence" : "Show evidence"}
        </button>
      )}
      {showEvidence && contact.evidence && (
        <div className="mt-0.5 p-1.5 rounded text-[9px]" style={{ background: `${BLUE}08`, color: TEXT }}>{contact.evidence}</div>
      )}
    </div>
  );
}

function parseDeepResearchSignals(signals: string | null | undefined): { roleConfidenceScore?: number; selectedRole?: string } {
  if (!signals || typeof signals !== "string") return {};
  try {
    const parsed = JSON.parse(signals) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const roleConfidenceScore = typeof parsed.roleConfidenceScore === "number" ? parsed.roleConfidenceScore : undefined;
    const selectedRole = typeof parsed.selectedRole === "string" ? parsed.selectedRole : undefined;
    return { roleConfidenceScore, selectedRole };
  } catch {
    return {};
  }
}

function FlowCard({ flow }: { flow: FlowScore }) {
  const [expanded, setExpanded] = useState(false);
  const channelColor = CHANNEL_COLORS[flow.bestChannel || ""] || MUTED;
  const ChannelIcon = CHANNEL_ICONS[flow.bestChannel || ""] || Target;

  const { data: inferredData } = useQuery<{ contacts: InferredContact[] }>({
    queryKey: ["/api/lead-intelligence/inferred", flow.companyId],
    enabled: expanded && !!flow.companyId,
  });
  const inferredContacts = inferredData?.contacts || [];

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

          {flow.deepResearchRan && (
            <div className="flex flex-wrap gap-1.5">
              {flow.deepResearchBestInferredEmailConfidence != null && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${BLUE}12`, color: BLUE }}>
                  Email {flow.deepResearchBestInferredEmailConfidence}%
                </span>
              )}
              {flow.deepResearchSelectedRole && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${PURPLE}12`, color: PURPLE }}>
                  {flow.deepResearchSelectedRole}
                </span>
              )}
              {(() => {
                const { roleConfidenceScore } = parseDeepResearchSignals(flow.deepResearchSignals);
                if (roleConfidenceScore != null) {
                  return (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${ORANGE}12`, color: ORANGE }}>
                      Role {roleConfidenceScore}%
                    </span>
                  );
                }
                return null;
              })()}
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

          {flow.researchConvertedFrom && (
            <div className="flex items-center gap-1.5 text-[10px] p-2 rounded" style={{ background: `${EMERALD}06`, border: `1px solid ${EMERALD}15`, color: TEXT }}>
              <ArrowRightLeft className="w-3 h-3" style={{ color: EMERALD }} />
              <span className="font-bold" style={{ color: EMERALD }}>Converted from research_more</span>
            </div>
          )}

          {flow.researchBlockerReasons && (() => {
            try {
              const reasons: string[] = JSON.parse(flow.researchBlockerReasons);
              if (!Array.isArray(reasons) || reasons.length === 0) return null;
              return (
                <div className="p-2 rounded space-y-1" style={{ background: `${AMBER}06`, border: `1px solid ${AMBER}15` }}>
                  <div className="text-[9px] font-bold uppercase" style={{ color: AMBER }}>Research Blockers</div>
                  {reasons.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]" style={{ color: TEXT }}>
                      <Ban className="w-3 h-3 shrink-0" style={{ color: AMBER }} />
                      {BLOCKER_LABELS[r] || r}
                    </div>
                  ))}
                </div>
              );
            } catch { return null; }
          })()}

          {flow.deepResearchBlockerReasons && (() => {
            try {
              const reasons: string[] = JSON.parse(flow.deepResearchBlockerReasons);
              if (!Array.isArray(reasons) || reasons.length === 0) return null;
              return (
                <div className="p-2 rounded space-y-1" style={{ background: `${PURPLE}06`, border: `1px solid ${PURPLE}15` }}>
                  <div className="text-[9px] font-bold uppercase" style={{ color: PURPLE }}>Deep Research Blockers</div>
                  {reasons.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]" style={{ color: TEXT }}>
                      <Ban className="w-3 h-3 shrink-0" style={{ color: PURPLE }} />
                      {BLOCKER_LABELS[r] || r}
                    </div>
                  ))}
                </div>
              );
            } catch { return null; }
          })()}

          {flow.discoveredContacts && (() => {
            try {
              const contacts = JSON.parse(flow.discoveredContacts);
              if (!Array.isArray(contacts) || contacts.length === 0) return null;
              return (
                <div className="p-2 rounded space-y-1" style={{ background: `${PURPLE}06`, border: `1px solid ${PURPLE}15` }}>
                  <div className="text-[9px] font-bold uppercase" style={{ color: PURPLE }}>Discovered Contacts</div>
                  {contacts.map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]" style={{ color: TEXT }}>
                      <Users className="w-3 h-3 shrink-0" style={{ color: PURPLE }} />
                      <span className="font-medium">{c.name}</span>
                      <span style={{ color: MUTED }}>- {c.title}</span>
                      {c.email && <span style={{ color: BLUE }}>{c.email}</span>}
                    </div>
                  ))}
                </div>
              );
            } catch { return null; }
          })()}

          {flow.phonePaths && (() => {
            try {
              const paths = JSON.parse(flow.phonePaths);
              if (!Array.isArray(paths) || paths.length === 0) return null;
              return (
                <div className="p-2 rounded space-y-1" style={{ background: `${EMERALD}06`, border: `1px solid ${EMERALD}15` }}>
                  <div className="text-[9px] font-bold uppercase" style={{ color: EMERALD }}>Phone Paths</div>
                  {paths.map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]" style={{ color: TEXT }}>
                      <Phone className="w-3 h-3 shrink-0" style={{ color: EMERALD }} />
                      <span className="font-medium">{p.label}</span>
                      <span style={{ color: MUTED }}>{p.phone}</span>
                    </div>
                  ))}
                </div>
              );
            } catch { return null; }
          })()}

          {inferredContacts.length > 0 && (
            <div className="p-2 rounded space-y-1" style={{ background: `${BLUE}06`, border: `1px solid ${BLUE}15` }}>
              <div className="text-[9px] font-bold uppercase" style={{ color: BLUE }}>Inferred Contacts</div>
              {inferredContacts.slice(0, 5).map((c) => (
                <InferredContactRow key={c.id} contact={c} />
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 text-[9px]" style={{ color: MUTED }}>
            <span>Status: {flow.enrichmentStatus || "pending"}</span>
            {flow.deepEnrichmentRan && <span>| Deep Enriched</span>}
            {flow.lastEnrichedAt && <span>| Scored: {new Date(flow.lastEnrichedAt).toLocaleDateString()}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const BLOCKER_LABELS: Record<string, string> = {
  no_website: "No website found",
  no_usable_domain: "Could not extract domain from website",
  website_unreachable: "Website unreachable or offline",
  no_named_contacts: "No named contacts discovered",
  no_contact_info_found: "No email or phone found anywhere",
  phone_only_no_email: "Phone found but no email addresses",
  generic_email_only: "Only generic emails (info@, office@)",
  contact_form_only: "Only a contact form — no direct emails",
  weak_operational_evidence: "Minimal operational evidence on site",
};

interface ResearchStatus {
  totalActive: number;
  researchBacklog: number;
  convertedToEmail: number;
  convertedToCall: number;
  totalConverted: number;
  deepEnriched: number;
  blocked: number;
  blockerBreakdown: Record<string, number>;
}

interface DeepResearchStatus {
  totalActive: number;
  remainingBacklog: number;
  convertedToEmail: number;
  convertedToCall: number;
  totalConverted: number;
  deepResearched: number;
  blocked: number;
  blockerBreakdown: Record<string, number>;
}

interface WebsiteFinderStatus {
  processed: number;
  websitesFound: number;
  stillBlocked: number;
  notFound: number;
  candidateStored: number;
  lowConfidence: number;
  blockedUrl: number;
  sourceUnavailable: number;
  breakdown: Record<string, number>;
  filterCounts?: {
    researchMoreFlows: number;
    withPipelineRow: number;
    withWebsiteNull: number;
    notRecentlyLookedUp: number;
    finalSelected: number;
  };
}

export default function LeadIntelligencePage() {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<ScoresResponse>({
    queryKey: ["/api/lead-intelligence/scores"],
    enabled: isAuthenticated,
  });

  const { data: researchStatus } = useQuery<ResearchStatus>({
    queryKey: ["/api/research-engine/status"],
    enabled: isAuthenticated,
  });

  const { data: deepResearchStatus } = useQuery<DeepResearchStatus>({
    queryKey: ["/api/deep-research-engine/status"],
    enabled: isAuthenticated,
  });

  const {
    data: websiteFinderStatus,
    isLoading: websiteFinderLoading,
    isError: websiteFinderError,
    refetch: refetchWebsiteFinder,
  } = useQuery<WebsiteFinderStatus>({
    queryKey: ["/api/website-finder-engine/status"],
    enabled: isAuthenticated,
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

  const researchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/research-engine/run");
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-intelligence/scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/research-engine/status"] });
      toast({
        title: "Research engine complete",
        description: `${result.totalProcessed} processed: ${result.convertedToEmail} email, ${result.convertedToCall} call, ${result.remainingResearch} still researching`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Research engine failed", description: err.message, variant: "destructive" });
    },
  });

  const deepResearchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/deep-research-engine/run");
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-intelligence/scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deep-research-engine/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-intelligence/inferred"] });
      toast({
        title: "Deep research complete",
        description: result.totalProcessed != null ? `${result.totalProcessed} processed` : "Run finished",
      });
    },
    onError: (err: any) => {
      toast({ title: "Deep research failed", description: err.message, variant: "destructive" });
    },
  });

  const websiteFinderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/website-finder-engine/run");
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-intelligence/scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/website-finder-engine/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/research-engine/status"] });
      toast({
        title: "Website finder complete",
        description: result.processed != null ? `${result.websitesFound} found, ${result.stillBlocked} blocked` : "Run finished",
      });
    },
    onError: (err: any) => {
      toast({ title: "Website finder failed", description: err.message, variant: "destructive" });
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

        {researchStatus && (researchStatus.researchBacklog > 0 || researchStatus.totalConverted > 0) && (
          <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: "white" }} data-testid="research-engine-panel">
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: BORDER }}>
              <div className="flex items-center gap-2">
                <Microscope className="w-4 h-4" style={{ color: AMBER }} />
                <div>
                  <div className="text-[12px] font-bold" style={{ color: TEXT }}>Research-to-Reachable Engine</div>
                  <div className="text-[10px]" style={{ color: MUTED }}>Deep website enrichment converts research_more flows into actionable outreach</div>
                </div>
              </div>
              <Button
                onClick={() => researchMutation.mutate()}
                disabled={researchMutation.isPending || researchStatus.researchBacklog === 0}
                className="gap-1.5 text-[11px]"
                style={{ background: AMBER }}
                data-testid="run-research-engine"
              >
                {researchMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                Run Deep Enrichment ({researchStatus.researchBacklog})
              </Button>
            </div>

            <div className="grid grid-cols-5 gap-3 p-4">
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: AMBER }}>{researchStatus.researchBacklog}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Research Backlog</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: BLUE }}>{researchStatus.convertedToEmail}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Converted to Email</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: EMERALD }}>{researchStatus.convertedToCall}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Converted to Call</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: PURPLE }}>{researchStatus.deepEnriched}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Deep Enriched</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: ERROR }}>{researchStatus.blocked}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Blocked</div>
              </div>
            </div>

            {Object.keys(researchStatus.blockerBreakdown).length > 0 && (
              <div className="px-4 pb-4">
                <div className="text-[9px] font-bold uppercase mb-2" style={{ color: AMBER }}>Blocker Breakdown</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(researchStatus.blockerBreakdown).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                    <div key={reason} className="flex items-center gap-1 px-2 py-1 rounded text-[10px]" style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}20`, color: TEXT }}>
                      <Ban className="w-3 h-3" style={{ color: AMBER }} />
                      {BLOCKER_LABELS[reason] || reason}
                      <span className="font-bold ml-0.5" style={{ color: AMBER }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(websiteFinderStatus || websiteFinderLoading || (researchStatus?.researchBacklog ?? 0) > 0) && (
          <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: "white" }} data-testid="website-finder-panel">
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: BORDER }}>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4" style={{ color: BLUE }} />
                <div>
                  <div className="text-[12px] font-bold" style={{ color: TEXT }}>Website Finder</div>
                  <div className="text-[10px]" style={{ color: MUTED }}>Source official websites for research_more flows missing pipeline.website</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {websiteFinderError && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[10px]"
                    onClick={() => refetchWebsiteFinder()}
                    data-testid="website-finder-retry"
                  >
                    Retry
                  </Button>
                )}
                <Button
                  onClick={() => websiteFinderMutation.mutate()}
                  disabled={websiteFinderMutation.isPending}
                  className="gap-1.5 text-[11px]"
                  style={{ background: BLUE }}
                  data-testid="run-website-finder"
                >
                  {websiteFinderMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                  Run Website Finder
                </Button>
              </div>
            </div>
            {websiteFinderLoading ? (
              <div className="flex items-center justify-center gap-2 py-8" style={{ color: MUTED }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-[11px]">Loading status...</span>
              </div>
            ) : websiteFinderError ? (
              <div className="py-6 text-center">
                <span className="text-[11px]" style={{ color: MUTED }}>Unable to load status. </span>
                <button
                  type="button"
                  onClick={() => refetchWebsiteFinder()}
                  className="text-[11px] font-medium"
                  style={{ color: BLUE }}
                >
                  Retry
                </button>
              </div>
            ) : websiteFinderStatus ? (
            <>
            <div className="grid grid-cols-5 gap-3 p-4">
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: TEXT }}>{websiteFinderStatus.processed}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Processed</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: EMERALD }}>{websiteFinderStatus.websitesFound}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Found</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: AMBER }}>{websiteFinderStatus.stillBlocked}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Blocked</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: PURPLE }}>{websiteFinderStatus.candidateStored}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Candidates</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: ERROR }}>{websiteFinderStatus.notFound}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Not Found</div>
              </div>
            </div>
            {websiteFinderStatus.filterCounts && (
              <div className="px-4 pb-4 pt-0">
                <div className="text-[9px]" style={{ color: MUTED }}>
                  Filter funnel: research_more={websiteFinderStatus.filterCounts.researchMoreFlows} → pipeline={websiteFinderStatus.filterCounts.withPipelineRow} → website_null={websiteFinderStatus.filterCounts.withWebsiteNull} → not_recent={websiteFinderStatus.filterCounts.notRecentlyLookedUp} → final={websiteFinderStatus.filterCounts.finalSelected}
                </div>
              </div>
            )}
            </>
            ) : null}
          </div>
        )}

        {deepResearchStatus && (deepResearchStatus.remainingBacklog > 0 || deepResearchStatus.totalConverted > 0) && (
          <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: "white" }} data-testid="deep-research-panel">
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: BORDER }}>
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4" style={{ color: PURPLE }} />
                <div>
                  <div className="text-[12px] font-bold" style={{ color: TEXT }}>Deep Research Engine</div>
                  <div className="text-[10px]" style={{ color: MUTED }}>Contact inference and role scoring for research_more flows</div>
                </div>
              </div>
              <Button
                onClick={() => deepResearchMutation.mutate()}
                disabled={deepResearchMutation.isPending || deepResearchStatus.remainingBacklog === 0}
                className="gap-1.5 text-[11px]"
                style={{ background: PURPLE }}
                data-testid="run-deep-research"
              >
                {deepResearchMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Run Deep Research ({deepResearchStatus.remainingBacklog})
              </Button>
            </div>
            <div className="grid grid-cols-5 gap-3 p-4">
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: PURPLE }}>{deepResearchStatus.remainingBacklog}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Backlog</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: BLUE }}>{deepResearchStatus.convertedToEmail}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>→ Email</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: EMERALD }}>{deepResearchStatus.convertedToCall}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>→ Call</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: PURPLE }}>{deepResearchStatus.deepResearched}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Researched</div>
              </div>
              <div className="text-center">
                <div className="text-[16px] font-bold" style={{ color: ERROR }}>{deepResearchStatus.blocked}</div>
                <div className="text-[9px]" style={{ color: MUTED }}>Blocked</div>
              </div>
            </div>
            {Object.keys(deepResearchStatus.blockerBreakdown || {}).length > 0 && (
              <div className="px-4 pb-4">
                <div className="text-[9px] font-bold uppercase mb-2" style={{ color: PURPLE }}>Deep Research Blockers</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(deepResearchStatus.blockerBreakdown || {}).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                    <div key={reason} className="flex items-center gap-1 px-2 py-1 rounded text-[10px]" style={{ background: `${PURPLE}08`, border: `1px solid ${PURPLE}20`, color: TEXT }}>
                      <Ban className="w-3 h-3" style={{ color: PURPLE }} />
                      {BLOCKER_LABELS[reason] || reason}
                      <span className="font-bold ml-0.5" style={{ color: PURPLE }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
