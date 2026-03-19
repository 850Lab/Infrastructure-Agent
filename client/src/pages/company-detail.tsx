import { useState, useMemo, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Phone, PhoneCall, Mail, Linkedin, User, Check, Copy, Loader2,
  X, Calendar, MapPin, Building2, Clock, Target, Zap, Shield, Globe,
  MessageSquare, ChevronDown, ChevronUp, ExternalLink, AlertCircle,
  Play, SkipForward, Plus, Pencil, RotateCcw, FileText, Send,
  Mic, Volume2, Pause
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";
const ERROR = "#EF4444";
const PURPLE = "#8B5CF6";

const FLOW_CONFIG: Record<string, { label: string; short: string; color: string; icon: any }> = {
  gatekeeper: { label: "Gatekeeper Discovery", short: "GK", color: AMBER, icon: Phone },
  dm_call: { label: "DM Direct Call", short: "DM", color: EMERALD, icon: PhoneCall },
  email: { label: "Email Outreach", short: "Email", color: BLUE, icon: Mail },
  linkedin: { label: "LinkedIn", short: "LI", color: "#0A66C2", icon: Linkedin },
  nurture: { label: "Long-Term Nurture", short: "Nurture", color: PURPLE, icon: Calendar },
};

const TARGET_ROLES = [
  "Operations Manager", "Superintendent", "Project Manager",
  "Safety Manager", "Field Operations Lead", "Branch Manager",
  "Maintenance Manager", "Procurement Manager",
];

interface CompanyDetail {
  id: string;
  companyName: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  industry: string;
  category: string;
  bucket: string;
  leadStatus: string;
  finalPriority: number;
  timesCalled: number;
  lastOutcome: string;
  followupDue: string;
  gatekeeperName: string;
  dmCoverageStatus: string;
  enrichmentStatus: string;
  primaryDMName: string;
  primaryDMTitle: string;
  primaryDMEmail: string;
  primaryDMPhone: string;
  offerDMName: string;
  offerDMTitle: string;
  offerDMEmail: string;
  offerDMPhone: string;
  playbookOpener: string;
  playbookGatekeeper: string;
  playbookVoicemail: string;
  playbookFollowup: string;
  playbookEmailSubject: string;
  playbookEmailBody: string;
  playbookStrategyNotes: string;
  webIntel: string;
  rankReason: string;
  rankEvidence: string;
  todayCallList: boolean;
  touchCount: number;
}

interface Contact {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  seniority: string;
  department: string;
  source: string;
  linkedinUrl: string;
  isDM: boolean;
}

interface CompanyFlow {
  id: number;
  flowType: string;
  status: string;
  stage: number;
  attemptCount: number;
  maxAttempts: number;
  nextAction: string | null;
  nextDueAt: string | null;
  lastOutcome: string | null;
  lastAttemptAt: string | null;
  priority: number;
  contactName: string | null;
  notes: string | null;
}

interface FlowAttempt {
  id: number;
  flowId: number;
  companyId: string;
  companyName: string;
  contactId: string | null;
  contactName: string | null;
  channel: string;
  attemptNumber: number;
  outcome: string;
  notes: string | null;
  capturedInfo: string | null;
  createdAt: string;
  createdBy: string | null;
}

interface ActionItem {
  id: number;
  flowType: string;
  taskType: string;
  dueAt: string;
  priority: number;
  status: string;
  recommendationText: string | null;
  lastOutcome: string | null;
  attemptNumber: number;
}

interface RecordingData {
  callSid: string;
  recordingSid: string;
  duration: number | null;
  transcription: string | null;
  analysis: string | null;
  problemDetected: string | null;
  noAuthority: boolean | null;
  authorityReason: string | null;
  suggestedRole: string | null;
  followupDate: string | null;
  status: string | null;
  contactName: string | null;
  createdAt: string;
}

interface CallIntelligenceRecord {
  id: number;
  primaryOutcome: string;
  interestScore: number;
  summary: string | null;
  buyingSignals: string[];
  objections: string[];
  nextAction: string | null;
  suggestedFollowUpDate: string | null;
  createdAt: string;
}

interface DetailResponse {
  company: CompanyDetail;
  contacts: Contact[];
  flows: CompanyFlow[];
  attempts: FlowAttempt[];
  pendingActions: ActionItem[];
  nextAction: ActionItem | null;
}

function CopyBtn({ text, id }: { text: string; id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded transition-colors"
      style={{ color: copied ? EMERALD : MUTED }}
      data-testid={`copy-${id}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${color}15`, color, border: `1px solid ${color}25` }}>
      {label}
    </span>
  );
}

function RecordingCard({ recording }: { recording: RecordingData }) {
  const [expanded, setExpanded] = useState(false);
  const duration = recording.duration ? `${Math.floor(recording.duration / 60)}:${String(recording.duration % 60).padStart(2, "0")}` : null;

  return (
    <div className="mt-2 rounded-lg overflow-hidden" style={{ background: `${BLUE}06`, border: `1px solid ${BLUE}15` }}
      data-testid={`recording-card-${recording.callSid}`}>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between text-left"
        data-testid={`recording-toggle-${recording.callSid}`}>
        <div className="flex items-center gap-2">
          <Mic className="w-3.5 h-3.5" style={{ color: BLUE }} />
          <span className="text-xs font-medium" style={{ color: TEXT }}>Call Recording</span>
          {duration && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${BLUE}12`, color: BLUE }}>
              {duration}
            </span>
          )}
          {recording.problemDetected && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${ERROR}10`, color: ERROR }}>
              Issue Detected
            </span>
          )}
          {recording.noAuthority && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${AMBER}10`, color: AMBER }}>
              No Authority
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: MUTED }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: MUTED }} />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {recording.analysis && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: BLUE }}>AI Analysis</div>
              <div className="text-xs leading-relaxed" style={{ color: TEXT }}>{recording.analysis}</div>
            </div>
          )}
          {recording.transcription && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Transcript</div>
              <div className="text-xs leading-relaxed max-h-40 overflow-y-auto" style={{ color: TEXT, whiteSpace: "pre-wrap" }}>
                {recording.transcription}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {recording.suggestedRole && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${PURPLE}10`, color: PURPLE }}>
                Role: {recording.suggestedRole}
              </span>
            )}
            {recording.authorityReason && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${AMBER}10`, color: AMBER }}>
                {recording.authorityReason}
              </span>
            )}
            {recording.followupDate && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${EMERALD}10`, color: EMERALD }}>
                Follow-up: {new Date(recording.followupDate).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CompanyDetailPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/machine/company/:id");
  const companyId = params?.id || "";
  const [activeTab, setActiveTab] = useState<"flows" | "timeline" | "intel">("flows");
  const [showCreateFlow, setShowCreateFlow] = useState(false);
  const [newFlowType, setNewFlowType] = useState("gatekeeper");

  const { data, isLoading, error } = useQuery<DetailResponse>({
    queryKey: ["/api/company-detail", companyId],
    enabled: !!companyId,
  });

  const companyName = data?.company?.companyName || "";
  const { data: recordings = [] } = useQuery<RecordingData[]>({
    queryKey: ["/api/twilio/recording-by-company", companyName],
    enabled: !!companyName,
  });

  const { data: callIntelData } = useQuery<{ records: CallIntelligenceRecord[] }>({
    queryKey: ["/api/call-intelligence/company", companyId],
    enabled: !!companyId,
  });
  const callIntelRecords = callIntelData?.records ?? [];

  const recordingsByDate = useMemo(() => {
    const map = new Map<string, RecordingData>();
    for (const rec of recordings) {
      const dateKey = new Date(rec.createdAt).toISOString().slice(0, 13);
      if (!map.has(dateKey)) map.set(dateKey, rec);
    }
    return map;
  }, [recordings]);

  const findRecordingForAttempt = useCallback((attempt: FlowAttempt): RecordingData | null => {
    if (attempt.channel !== "call" && attempt.channel !== "phone") return null;
    const attemptTime = new Date(attempt.createdAt).getTime();
    let best: RecordingData | null = null;
    let bestDiff = Infinity;
    for (const rec of recordings) {
      const recTime = new Date(rec.createdAt).getTime();
      const diff = Math.abs(recTime - attemptTime);
      if (diff < 3600000 && diff < bestDiff) {
        best = rec;
        bestDiff = diff;
      }
    }
    return best;
  }, [recordings]);

  const createFlowMutation = useMutation({
    mutationFn: async (flowType: string) => {
      if (!data) throw new Error("No data");
      const res = await apiRequest("POST", "/api/flows/create", {
        companyId: data.company.id,
        companyName: data.company.companyName,
        flowType,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-detail", companyId] });
      toast({ title: "Flow created", description: `New ${FLOW_CONFIG[newFlowType]?.label || newFlowType} flow started` });
      setShowCreateFlow(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create flow", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: SUBTLE }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: EMERALD }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: SUBTLE }}>
        <div className="text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: ERROR }} />
          <h2 className="text-lg font-bold mb-2" style={{ color: TEXT }}>Company Not Found</h2>
          <p className="text-sm mb-4" style={{ color: MUTED }}>Could not load company details.</p>
          <Button onClick={() => navigate("/machine/companies")} style={{ background: EMERALD, color: "white" }} data-testid="button-back-companies">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Companies
          </Button>
        </div>
      </div>
    );
  }

  const { company, contacts, flows, attempts, pendingActions, nextAction } = data;
  const bucketColor = company.bucket === "Hot Follow-up" ? ERROR : company.bucket === "Working" ? AMBER : EMERALD;
  const location = [company.city, company.state].filter(Boolean).join(", ");
  const activeFlows = flows.filter(f => f.status === "active");
  const existingFlowTypes = flows.map(f => f.flowType);

  return (
    <div className="min-h-screen" style={{ background: SUBTLE }}>
      <div className="sticky top-0 z-40 bg-white" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate("/machine/companies")} className="text-xs" style={{ color: MUTED }} data-testid="button-back">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Companies
          </Button>
          <div className="flex items-center gap-2">
            {company.todayCallList && <StatusBadge label="Today's List" color={EMERALD} />}
            <StatusBadge label={company.bucket || "Unclassified"} color={bucketColor} />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {nextAction && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl p-4"
            style={{ background: `${EMERALD}08`, border: `1px solid ${EMERALD}20` }}
            data-testid="section-next-action"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: EMERALD }}>Next Best Action</div>
                <div className="text-sm font-semibold" style={{ color: TEXT }}>
                  {nextAction.recommendationText || `${nextAction.taskType.replace(/_/g, " ")} — Attempt #${nextAction.attemptNumber}`}
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-xs flex items-center gap-1" style={{ color: MUTED }}>
                    <Clock className="w-3 h-3" />
                    {new Date(nextAction.dueAt) < new Date() ? "Overdue" : `Due ${new Date(nextAction.dueAt).toLocaleDateString()}`}
                  </span>
                  {(() => {
                    const fc = FLOW_CONFIG[nextAction.flowType];
                    return fc ? (
                      <span className="text-xs font-semibold" style={{ color: fc.color }}>{fc.label}</span>
                    ) : null;
                  })()}
                </div>
              </div>
              <Button size="sm" onClick={() => navigate("/machine/focus")} style={{ background: EMERALD, color: "white" }} data-testid="button-go-focus">
                <Play className="w-3.5 h-3.5 mr-1" /> Execute
              </Button>
            </div>
          </motion.div>
        )}

        <div className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}` }} data-testid="section-summary">
          <div className="px-6 py-5">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold" style={{ color: TEXT }} data-testid="text-company-name">{company.companyName}</h1>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {location && (
                    <span className="text-xs flex items-center gap-1" style={{ color: MUTED }}>
                      <MapPin className="w-3 h-3" /> {location}
                    </span>
                  )}
                  {(company.industry || company.category) && (
                    <span className="text-xs flex items-center gap-1" style={{ color: MUTED }}>
                      <Building2 className="w-3 h-3" /> {company.category || company.industry}
                    </span>
                  )}
                  {company.website && (
                    <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs flex items-center gap-1" style={{ color: BLUE }}
                      data-testid="link-website">
                      <Globe className="w-3 h-3" /> Website
                    </a>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs" style={{ color: MUTED }}>Priority</div>
                <div className="text-2xl font-bold" style={{ color: company.finalPriority >= 80 ? EMERALD : company.finalPriority >= 50 ? AMBER : MUTED }}>
                  P{company.finalPriority}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <InfoCard label="Phone" value={company.phone} icon={Phone} copyable />
              <InfoCard label="Status" value={company.leadStatus || "Unknown"} icon={Target} />
              <InfoCard label="Times Called" value={String(company.timesCalled)} icon={PhoneCall} />
              <InfoCard label="Last Outcome" value={company.lastOutcome || "None"} icon={MessageSquare} />
              <InfoCard label="Follow-up Due" value={company.followupDue || "Not set"} icon={Calendar} />
              <InfoCard label="Touch Count" value={String(company.touchCount)} icon={Zap} />
              <InfoCard label="DM Coverage" value={company.dmCoverageStatus || "Unknown"} icon={User} />
              <InfoCard label="Enrichment" value={company.enrichmentStatus || "Unknown"} icon={Shield} />
            </div>
          </div>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}` }} data-testid="section-target-roles">
          <div className="px-6 py-4">
            <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>Target Roles</div>
            <div className="flex flex-wrap gap-2">
              {TARGET_ROLES.map(role => {
                const matched = contacts.some(c => c.title.toLowerCase().includes(role.toLowerCase().split(" ")[0]));
                return (
                  <span key={role} className="px-2.5 py-1 rounded-full text-xs font-medium"
                    style={{
                      background: matched ? `${EMERALD}12` : `${MUTED}10`,
                      color: matched ? EMERALD : MUTED,
                      border: `1px solid ${matched ? `${EMERALD}25` : `${MUTED}15`}`,
                    }}>
                    {matched && <Check className="w-3 h-3 inline mr-1" />}
                    {role}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {callIntelRecords.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}` }} data-testid="section-call-intelligence">
            <div className="px-6 py-4">
              <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: BLUE }}>Call Intelligence</div>
              {callIntelRecords.slice(0, 3).map((rec) => (
                <div key={rec.id} className="mb-4 last:mb-0 p-3 rounded-lg" style={{ background: `${BLUE}06`, border: `1px solid ${BLUE}15` }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold" style={{ color: TEXT }}>
                      {new Date(rec.createdAt).toLocaleDateString()} — {rec.primaryOutcome.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: rec.interestScore >= 60 ? `${EMERALD}15` : rec.interestScore >= 40 ? `${AMBER}15` : `${MUTED}15`, color: rec.interestScore >= 60 ? EMERALD : rec.interestScore >= 40 ? AMBER : MUTED }}>
                      {rec.interestScore}/100
                    </span>
                  </div>
                  {rec.summary && <p className="text-xs mb-2" style={{ color: TEXT }}>{rec.summary}</p>}
                  {rec.buyingSignals.length > 0 && (
                    <div className="mb-1">
                      <span className="text-[10px] font-bold uppercase" style={{ color: EMERALD }}>Buying signals: </span>
                      <span className="text-xs" style={{ color: TEXT }}>{rec.buyingSignals.join("; ")}</span>
                    </div>
                  )}
                  {rec.objections.length > 0 && (
                    <div className="mb-1">
                      <span className="text-[10px] font-bold uppercase" style={{ color: AMBER }}>Objections: </span>
                      <span className="text-xs" style={{ color: TEXT }}>{rec.objections.join("; ")}</span>
                    </div>
                  )}
                  {rec.nextAction && (
                    <div className="text-[10px] font-semibold mt-1" style={{ color: BLUE }}>Next: {rec.nextAction.replace(/_/g, " ")}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}` }} data-testid="section-contacts">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                Contacts / Decision Makers ({contacts.length})
              </div>
            </div>
            {contacts.length === 0 ? (
              <div className="text-center py-6">
                <User className="w-8 h-8 mx-auto mb-2" style={{ color: `${MUTED}50` }} />
                <p className="text-sm" style={{ color: MUTED }}>No contacts found for this company</p>
                <p className="text-xs mt-1" style={{ color: `${MUTED}80` }}>Run DM enrichment or add contacts manually</p>
              </div>
            ) : (
              <div className="space-y-2">
                {contacts.map(contact => (
                  <ContactCard key={contact.id} contact={contact} company={company} />
                ))}
              </div>
            )}
            {company.primaryDMName && !contacts.some(c => c.name === company.primaryDMName) && (
              <div className="mt-3 rounded-lg p-3" style={{ background: `${AMBER}06`, border: `1px solid ${AMBER}15` }}>
                <div className="text-xs font-semibold mb-1" style={{ color: AMBER }}>Primary DM (from Airtable)</div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium" style={{ color: TEXT }}>{company.primaryDMName}</span>
                  {company.primaryDMTitle && <span className="text-xs" style={{ color: MUTED }}>{company.primaryDMTitle}</span>}
                  {company.primaryDMPhone && <span className="text-xs flex items-center gap-1" style={{ color: MUTED }}><Phone className="w-3 h-3" />{company.primaryDMPhone}</span>}
                  {company.primaryDMEmail && <span className="text-xs flex items-center gap-1" style={{ color: MUTED }}><Mail className="w-3 h-3" />{company.primaryDMEmail}</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mb-1" data-testid="section-tabs">
          {(["flows", "timeline", "intel"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
              style={{
                background: activeTab === tab ? `${EMERALD}12` : "white",
                color: activeTab === tab ? EMERALD : MUTED,
                border: `1px solid ${activeTab === tab ? `${EMERALD}30` : BORDER}`,
              }}
              data-testid={`tab-${tab}`}>
              {tab === "flows" ? `Flow Progress (${activeFlows.length})` :
               tab === "timeline" ? `Timeline (${attempts.length})` : "Notes & Intel"}
            </button>
          ))}
        </div>

        {activeTab === "flows" && (
          <div className="space-y-3" data-testid="section-flows">
            {flows.length === 0 && (
              <div className="rounded-xl p-6 text-center" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                <Target className="w-8 h-8 mx-auto mb-2" style={{ color: `${MUTED}50` }} />
                <p className="text-sm" style={{ color: MUTED }}>No flows created for this company</p>
                <p className="text-xs mt-1 mb-3" style={{ color: `${MUTED}80` }}>Start an outreach flow to begin tracking</p>
              </div>
            )}
            {flows.map(flow => {
              const fc = FLOW_CONFIG[flow.flowType] || FLOW_CONFIG.gatekeeper;
              const Icon = fc.icon;
              const progressPct = flow.maxAttempts > 0 ? Math.min((flow.attemptCount / flow.maxAttempts) * 100, 100) : 0;
              const isActive = flow.status === "active";
              const isOverdue = flow.nextDueAt && new Date(flow.nextDueAt) < new Date();
              return (
                <div key={flow.id} className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}`, opacity: isActive ? 1 : 0.6 }}>
                  <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${fc.color}15` }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${fc.color}15` }}>
                        <Icon className="w-4 h-4" style={{ color: fc.color }} />
                      </div>
                      <div>
                        <div className="text-sm font-semibold" style={{ color: TEXT }}>{fc.label}</div>
                        <div className="text-xs" style={{ color: MUTED }}>
                          {flow.contactName && `${flow.contactName} — `}
                          Stage {flow.stage} of {flow.maxAttempts}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge label={flow.status} color={isActive ? EMERALD : MUTED} />
                      {isOverdue && <StatusBadge label="Overdue" color={ERROR} />}
                    </div>
                  </div>
                  <div className="px-5 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-full mr-4">
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${fc.color}12` }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${progressPct}%`, background: fc.color }} />
                        </div>
                      </div>
                      <span className="text-xs font-mono whitespace-nowrap" style={{ color: MUTED }}>
                        {flow.attemptCount}/{flow.maxAttempts}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span style={{ color: MUTED }}>Last Outcome</span>
                        <div className="font-medium mt-0.5" style={{ color: TEXT }}>{flow.lastOutcome?.replace(/_/g, " ") || "None"}</div>
                      </div>
                      <div>
                        <span style={{ color: MUTED }}>Next Action</span>
                        <div className="font-medium mt-0.5" style={{ color: TEXT }}>{flow.nextAction?.replace(/_/g, " ") || "Pending"}</div>
                      </div>
                      <div>
                        <span style={{ color: MUTED }}>Next Due</span>
                        <div className="font-medium mt-0.5" style={{ color: isOverdue ? ERROR : TEXT }}>
                          {flow.nextDueAt ? new Date(flow.nextDueAt).toLocaleDateString() : "Not set"}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: MUTED }}>Priority</span>
                        <div className="font-medium mt-0.5" style={{ color: TEXT }}>P{flow.priority}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="rounded-xl p-4" style={{ background: "white", border: `1px dashed ${BORDER}` }}>
              {!showCreateFlow ? (
                <button onClick={() => setShowCreateFlow(true)} className="w-full flex items-center justify-center gap-2 text-xs font-semibold" style={{ color: EMERALD }}
                  data-testid="button-add-flow">
                  <Plus className="w-4 h-4" /> Start New Flow
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs font-semibold" style={{ color: TEXT }}>Select Flow Type</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.entries(FLOW_CONFIG).map(([type, config]) => {
                      const exists = existingFlowTypes.includes(type);
                      const Icon = config.icon;
                      return (
                        <button key={type} onClick={() => { setNewFlowType(type); createFlowMutation.mutate(type); }}
                          disabled={createFlowMutation.isPending}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                          style={{
                            background: exists ? `${MUTED}08` : `${config.color}08`,
                            border: `1px solid ${exists ? `${MUTED}20` : `${config.color}25`}`,
                            color: exists ? MUTED : TEXT,
                          }}
                          data-testid={`flow-create-${type}`}>
                          <Icon className="w-3.5 h-3.5" style={{ color: exists ? MUTED : config.color }} />
                          {config.short}
                          {exists && <span className="text-[10px]" style={{ color: MUTED }}>(exists)</span>}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => setShowCreateFlow(false)} className="text-xs" style={{ color: MUTED }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "timeline" && (
          <div className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}` }} data-testid="section-timeline">
            <div className="px-6 py-4">
              {attempts.length === 0 ? (
                <div className="text-center py-6">
                  <Clock className="w-8 h-8 mx-auto mb-2" style={{ color: `${MUTED}50` }} />
                  <p className="text-sm" style={{ color: MUTED }}>No activity recorded yet</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {attempts.map((attempt, i) => {
                    const fc = FLOW_CONFIG[getFlowTypeFromChannel(attempt.channel, flows, attempt.flowId)] || FLOW_CONFIG.gatekeeper;
                    const Icon = fc.icon;
                    const isLast = i === attempts.length - 1;
                    const recording = findRecordingForAttempt(attempt);
                    return (
                      <div key={attempt.id} className="flex gap-3" data-testid={`timeline-item-${attempt.id}`}>
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: `${fc.color}15`, border: `1px solid ${fc.color}25` }}>
                            <Icon className="w-3.5 h-3.5" style={{ color: fc.color }} />
                          </div>
                          {!isLast && <div className="w-px flex-1 my-1" style={{ background: BORDER }} />}
                        </div>
                        <div className={`flex-1 ${isLast ? "" : "pb-4"}`}>
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium" style={{ color: TEXT }}>
                              {attempt.outcome.replace(/_/g, " ")}
                            </div>
                            <div className="text-[10px]" style={{ color: MUTED }}>
                              {new Date(attempt.createdAt).toLocaleString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs" style={{ color: fc.color }}>{fc.short}</span>
                            <span className="text-xs" style={{ color: MUTED }}>
                              Attempt #{attempt.attemptNumber}
                            </span>
                            {attempt.contactName && (
                              <span className="text-xs" style={{ color: MUTED }}>
                                {attempt.contactName}
                              </span>
                            )}
                            {attempt.channel && (
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${MUTED}10`, color: MUTED }}>
                                {attempt.channel}
                              </span>
                            )}
                          </div>
                          {attempt.notes && (
                            <div className="text-xs mt-1 p-2 rounded" style={{ background: SUBTLE, color: TEXT }}>
                              {attempt.notes}
                            </div>
                          )}
                          {attempt.capturedInfo && (
                            <div className="text-xs mt-1 p-2 rounded" style={{ background: `${EMERALD}06`, color: EMERALD, border: `1px solid ${EMERALD}15` }}>
                              Captured: {attempt.capturedInfo}
                            </div>
                          )}
                          {recording && <RecordingCard recording={recording} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "intel" && (
          <div className="space-y-3" data-testid="section-intel">
            {company.gatekeeperName && (
              <IntelCard title="Gatekeeper" content={company.gatekeeperName} color={AMBER} icon={Shield} />
            )}
            {company.playbookStrategyNotes && (
              <IntelCard title="Strategy Notes" content={company.playbookStrategyNotes} color={BLUE} icon={FileText} />
            )}
            {company.playbookOpener && (
              <IntelCard title="Call Opener Script" content={company.playbookOpener} color={EMERALD} icon={PhoneCall} />
            )}
            {company.playbookGatekeeper && (
              <IntelCard title="Gatekeeper Script" content={company.playbookGatekeeper} color={AMBER} icon={Phone} />
            )}
            {company.playbookVoicemail && (
              <IntelCard title="Voicemail Script" content={company.playbookVoicemail} color={MUTED} icon={MessageSquare} />
            )}
            {company.playbookEmailSubject && (
              <IntelCard title="Email Subject" content={company.playbookEmailSubject} color={BLUE} icon={Mail} />
            )}
            {company.playbookEmailBody && (
              <IntelCard title="Email Body" content={company.playbookEmailBody} color={BLUE} icon={Mail} />
            )}
            {company.webIntel && (
              <IntelCard title="Web Intelligence" content={company.webIntel} color={PURPLE} icon={Globe} />
            )}
            {company.rankReason && (
              <IntelCard title="Rank Reason" content={company.rankReason} color={EMERALD} icon={Target} />
            )}
            {company.rankEvidence && (
              <IntelCard title="Rank Evidence" content={company.rankEvidence} color={EMERALD} icon={Zap} />
            )}
            {!company.gatekeeperName && !company.playbookStrategyNotes && !company.playbookOpener && !company.webIntel && (
              <div className="rounded-xl p-6 text-center" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                <FileText className="w-8 h-8 mx-auto mb-2" style={{ color: `${MUTED}50` }} />
                <p className="text-sm" style={{ color: MUTED }}>No intel or playbooks available</p>
                <p className="text-xs mt-1" style={{ color: `${MUTED}80` }}>Run enrichment or call the company to gather intel</p>
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}` }} data-testid="section-quick-actions">
          <div className="px-6 py-4">
            <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>Quick Actions</div>
            <div className="flex flex-wrap gap-2">
              <QuickAction label="Focus Mode" icon={Play} color={EMERALD} onClick={() => navigate("/machine/focus")} testId="quick-focus" />
              {company.phone && (
                <QuickAction label="Call" icon={Phone} color={EMERALD} onClick={() => window.open(`tel:${company.phone}`)} testId="quick-call" />
              )}
              {company.primaryDMEmail && (
                <QuickAction label="Email DM" icon={Mail} color={BLUE} onClick={() => window.open(`mailto:${company.primaryDMEmail}`)} testId="quick-email" />
              )}
              <QuickAction label="Start GK Flow" icon={Phone} color={AMBER}
                onClick={() => { setNewFlowType("gatekeeper"); createFlowMutation.mutate("gatekeeper"); }}
                disabled={existingFlowTypes.includes("gatekeeper") || createFlowMutation.isPending}
                testId="quick-gk" />
              <QuickAction label="Start DM Flow" icon={PhoneCall} color={EMERALD}
                onClick={() => { setNewFlowType("dm_call"); createFlowMutation.mutate("dm_call"); }}
                disabled={existingFlowTypes.includes("dm_call") || createFlowMutation.isPending}
                testId="quick-dm" />
              <QuickAction label="Start Email Flow" icon={Mail} color={BLUE}
                onClick={() => { setNewFlowType("email"); createFlowMutation.mutate("email"); }}
                disabled={existingFlowTypes.includes("email") || createFlowMutation.isPending}
                testId="quick-email-flow" />
              <QuickAction label="Start LinkedIn" icon={Linkedin} color="#0A66C2"
                onClick={() => { setNewFlowType("linkedin"); createFlowMutation.mutate("linkedin"); }}
                disabled={existingFlowTypes.includes("linkedin") || createFlowMutation.isPending}
                testId="quick-linkedin" />
              <QuickAction label="Move to Nurture" icon={Calendar} color={PURPLE}
                onClick={() => { setNewFlowType("nurture"); createFlowMutation.mutate("nurture"); }}
                disabled={existingFlowTypes.includes("nurture") || createFlowMutation.isPending}
                testId="quick-nurture" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getFlowTypeFromChannel(channel: string, flows: CompanyFlow[], flowId: number): string {
  const flow = flows.find(f => f.id === flowId);
  if (flow) return flow.flowType;
  if (channel === "email") return "email";
  if (channel === "linkedin") return "linkedin";
  return "gatekeeper";
}

function InfoCard({ label, value, icon: Icon, copyable }: { label: string; value: string; icon: any; copyable?: boolean }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: SUBTLE }}>
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className="w-3 h-3" style={{ color: MUTED }} />
        <span className="text-[10px] font-medium uppercase" style={{ color: MUTED }}>{label}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium truncate" style={{ color: TEXT }}>{value || "—"}</span>
        {copyable && value && <CopyBtn text={value} id={label.toLowerCase().replace(/\s/g, "-")} />}
      </div>
    </div>
  );
}

function ContactCard({ contact, company }: { contact: Contact; company: CompanyDetail }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${contact.isDM ? `${EMERALD}25` : BORDER}`, background: contact.isDM ? `${EMERALD}04` : "white" }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full px-4 py-2.5 flex items-center justify-between text-left" data-testid={`contact-${contact.id}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: contact.isDM ? `${EMERALD}15` : `${MUTED}10` }}>
            <User className="w-4 h-4" style={{ color: contact.isDM ? EMERALD : MUTED }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: TEXT }}>{contact.name}</span>
              {contact.isDM && <StatusBadge label="DM" color={EMERALD} />}
            </div>
            <span className="text-xs" style={{ color: MUTED }}>{contact.title || "No title"}</span>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" style={{ color: MUTED }} /> : <ChevronDown className="w-4 h-4" style={{ color: MUTED }} />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="grid grid-cols-2 gap-2 pt-2">
            {contact.phone && (
              <div className="flex items-center gap-2 text-xs">
                <Phone className="w-3 h-3" style={{ color: MUTED }} />
                <a href={`tel:${contact.phone}`} style={{ color: BLUE }}>{contact.phone}</a>
                <CopyBtn text={contact.phone} id={`contact-phone-${contact.id}`} />
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-2 text-xs">
                <Mail className="w-3 h-3" style={{ color: MUTED }} />
                <a href={`mailto:${contact.email}`} style={{ color: BLUE }}>{contact.email}</a>
                <CopyBtn text={contact.email} id={`contact-email-${contact.id}`} />
              </div>
            )}
            {contact.linkedinUrl && (
              <div className="flex items-center gap-2 text-xs">
                <Linkedin className="w-3 h-3" style={{ color: "#0A66C2" }} />
                <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#0A66C2" }}>Profile</a>
              </div>
            )}
            {contact.seniority && (
              <div className="text-xs" style={{ color: MUTED }}>Seniority: {contact.seniority}</div>
            )}
            {contact.department && (
              <div className="text-xs" style={{ color: MUTED }}>Dept: {contact.department}</div>
            )}
            {contact.source && (
              <div className="text-xs" style={{ color: MUTED }}>Source: {contact.source}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IntelCard({ title, content, color, icon: Icon }: { title: string; content: string; color: string; icon: any }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}` }}>
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${color}10` }}>
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color }} />
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{title}</span>
        </div>
        <button onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="text-[10px] px-2 py-0.5 rounded" style={{ color: copied ? EMERALD : MUTED }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="px-5 py-3 text-sm whitespace-pre-wrap" style={{ color: TEXT }}>{content}</div>
    </div>
  );
}

function QuickAction({ label, icon: Icon, color, onClick, disabled, testId }: {
  label: string; icon: any; color: string; onClick: () => void; disabled?: boolean; testId: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
      style={{
        background: disabled ? `${MUTED}08` : `${color}08`,
        border: `1px solid ${disabled ? `${MUTED}15` : `${color}25`}`,
        color: disabled ? MUTED : TEXT,
        opacity: disabled ? 0.5 : 1,
      }}
      data-testid={testId}>
      <Icon className="w-3.5 h-3.5" style={{ color: disabled ? MUTED : color }} />
      {label}
    </button>
  );
}
