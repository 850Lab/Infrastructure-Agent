import { useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import DealCard from "@/components/deal-card";
import type { Opportunity } from "@/components/deal-card";
import {
  Phone, Copy, ChevronDown, ChevronUp, Play, Zap, ClipboardList,
  Clock, CheckCircle2, User, Loader2, AlertCircle, PhoneCall,
  Target, FileText, BookOpen, Mail, MapPin, ExternalLink, ListChecks
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const ERROR_RED = "#EF4444";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";

const OUTCOMES = [
  { value: "Decision Maker", label: "DM", color: EMERALD },
  { value: "Gatekeeper", label: "GK", color: BLUE },
  { value: "No Answer", label: "N/A", color: MUTED },
  { value: "Qualified", label: "Qual", color: "#059669" },
  { value: "Callback", label: "CB", color: AMBER },
  { value: "Not Interested", label: "NI", color: ERROR_RED },
  { value: "NoAuthority", label: "Wrong Person", color: AMBER },
] as const;

const OUTCOME_FEEDBACK: Record<string, { title: string; description: string }> = {
  "Decision Maker": { title: "Signal captured", description: "DM reached. Targeting will improve." },
  "Gatekeeper": { title: "Intel gathered", description: "Gatekeeper mapped. Machine is learning." },
  "No Answer": { title: "Noted", description: "Follow-up queued. Machine will try again." },
  "Qualified": { title: "Opportunity created", description: "High-value target moved to pipeline." },
  "Callback": { title: "Callback locked", description: "Machine will remind you at the right time." },
  "Not Interested": { title: "Signal absorbed", description: "Targeting recalibrated. Moving on." },
  "NoAuthority": { title: "Wrong person flagged", description: "Machine will find the right decision maker." },
};

interface TodayCompany {
  id: string;
  company_name: string;
  phone: string;
  bucket: string;
  final_priority: number;
  lead_status: string;
  times_called: number;
  last_outcome: string;
  offer_dm_name: string;
  offer_dm_title: string;
  offer_dm_phone: string;
  offer_dm_email: string;
  rank_reason: string;
  rank_evidence: string;
  playbook_opener: string;
  playbook_gatekeeper: string;
  playbook_voicemail: string;
  playbook_followup: string;
  followup_due: string;
}

interface BriefingAction {
  type: string;
  title: string;
  reason: string;
  company_name?: string;
}

interface Briefing {
  recommended_actions: BriefingAction[];
  pipeline_ran_today: boolean;
}

const bucketMeta = (bucket: string) => {
  switch (bucket) {
    case "Hot Follow-up": return { color: ERROR_RED, bg: "rgba(239,68,68,0.06)", label: "Hot" };
    case "Working": return { color: AMBER, bg: "rgba(245,158,11,0.06)", label: "Working" };
    case "Fresh": return { color: BLUE, bg: "rgba(59,130,246,0.06)", label: "Fresh" };
    default: return { color: MUTED, bg: "rgba(148,163,184,0.06)", label: bucket || "New" };
  }
};

function PlaybookSection({ company, idx }: { company: TodayCompany; idx: number }) {
  const scripts = [
    { key: "opener", label: "Call Opener", content: company.playbook_opener, icon: Phone },
    { key: "gatekeeper", label: "Gatekeeper Script", content: company.playbook_gatekeeper, icon: User },
    { key: "voicemail", label: "Voicemail", content: company.playbook_voicemail, icon: Mail },
    { key: "followup", label: "Follow-up", content: company.playbook_followup, icon: Clock },
  ].filter(s => s.content);

  if (scripts.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5" data-testid={`playbooks-${idx}`}>
      {scripts.map(s => (
        <div key={s.key} className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-1.5 mb-2">
            <s.icon className="w-3 h-3" style={{ color: EMERALD }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EMERALD }}>{s.label}</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: TEXT }} data-testid={`playbook-${s.key}-${idx}`}>
            {s.content}
          </p>
        </div>
      ))}
    </div>
  );
}

function CompanyCard({
  company, idx, isExpanded, hasLogged, loggedOutcome,
  copiedId, opp, isPending, onToggleExpand, onCopyPhone, onOutcome,
}: {
  company: TodayCompany;
  idx: number;
  isExpanded: boolean;
  hasLogged: boolean;
  loggedOutcome: string | undefined;
  copiedId: string | null;
  opp: Opportunity | undefined;
  isPending: boolean;
  onToggleExpand: (id: string) => void;
  onCopyPhone: (phone: string, id: string) => void;
  onOutcome: (name: string, outcome: string) => void;
}) {
  const callPhone = company.offer_dm_phone || company.phone;
  const isMobile = /^\+?\d[\d\s()-]{7,}$/.test(callPhone);
  const bkt = bucketMeta(company.bucket);

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: "#FFF",
        border: `1px solid ${hasLogged ? "rgba(16,185,129,0.25)" : BORDER}`,
        boxShadow: hasLogged ? "0 0 0 1px rgba(16,185,129,0.08)" : "0 1px 3px rgba(0,0,0,0.04)",
      }}
      data-testid={`company-row-${idx}`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
            <div className="w-2 h-2 rounded-full" style={{ background: bkt.color }} title={company.bucket} />
            <span className="text-[9px] font-bold" style={{ color: bkt.color }}>{company.final_priority}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-sm font-bold truncate" style={{ color: TEXT }} data-testid={`company-name-${idx}`}>
                {company.company_name}
              </span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: bkt.bg, color: bkt.color }}
              >
                {bkt.label}
              </span>
              {hasLogged && (
                <span className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: EMERALD }}>
                  <CheckCircle2 className="w-3 h-3" /> {loggedOutcome}
                </span>
              )}
            </div>

            {company.offer_dm_name && (
              <div className="flex items-center gap-1.5 mb-2">
                <User className="w-3 h-3" style={{ color: MUTED }} />
                <span className="text-xs font-medium" style={{ color: TEXT }} data-testid={`dm-name-${idx}`}>
                  Ask for: {company.offer_dm_name}
                </span>
                {company.offer_dm_title && (
                  <span className="text-[11px]" style={{ color: MUTED }}>({company.offer_dm_title})</span>
                )}
              </div>
            )}

            {opp && <DealCard opportunity={opp} compact />}

            <div className="flex items-center gap-2 flex-wrap">
              {callPhone ? (
                isMobile ? (
                  <a
                    href={`tel:${callPhone.replace(/\s/g, "")}`}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                    style={{ background: "rgba(16,185,129,0.08)", color: EMERALD, border: "1px solid rgba(16,185,129,0.15)" }}
                    data-testid={`call-button-${idx}`}
                  >
                    <Phone className="w-3 h-3" /> Call
                  </a>
                ) : (
                  <button
                    onClick={() => onCopyPhone(callPhone, company.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                    style={{ background: "rgba(16,185,129,0.08)", color: EMERALD, border: "1px solid rgba(16,185,129,0.15)" }}
                    data-testid={`call-button-${idx}`}
                  >
                    {copiedId === company.id ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedId === company.id ? "Copied" : callPhone}
                  </button>
                )
              ) : (
                <span className="text-xs" style={{ color: MUTED }}>No phone</span>
              )}

              {!hasLogged && (
                <div className="flex items-center gap-1 flex-wrap" data-testid={`outcome-buttons-${idx}`}>
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.value}
                      onClick={() => onOutcome(company.company_name, o.value)}
                      disabled={isPending}
                      className="px-2 py-1 rounded-md text-[11px] font-semibold transition-all hover:opacity-80"
                      style={{
                        background: `${o.color}12`,
                        color: o.color,
                        border: `1px solid ${o.color}20`,
                      }}
                      data-testid={`outcome-${o.value.toLowerCase().replace(/\s+/g, "-")}-${idx}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={() => onToggleExpand(company.id)}
                className="ml-auto p-1.5 rounded-lg transition-colors hover:bg-gray-50"
                style={{ color: MUTED }}
                data-testid={`expand-${idx}`}
              >
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pt-0" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mt-3">
            <PlaybookSection company={company} idx={idx} />
          </div>

          {(company.rank_reason || company.rank_evidence) && (
            <div className="mt-3 rounded-lg p-3" style={{ background: "rgba(16,185,129,0.03)", border: `1px solid rgba(16,185,129,0.12)` }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Target className="w-3 h-3" style={{ color: EMERALD }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EMERALD }}>Rank Evidence</span>
              </div>
              {company.rank_reason && (
                <p className="text-xs leading-relaxed" style={{ color: TEXT }}>{company.rank_reason}</p>
              )}
              {company.rank_evidence && (
                <p className="text-xs leading-relaxed mt-1" style={{ color: MUTED }}>{company.rank_evidence}</p>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {company.times_called > 0 && (
              <span className="text-[11px]" style={{ color: MUTED }}>Called {company.times_called}x</span>
            )}
            {company.last_outcome && (
              <span className="text-[11px]" style={{ color: company.last_outcome === "NoAuthority" ? AMBER : MUTED }} data-testid={`outcome-badge-${company.id}`}>
                Last: {company.last_outcome === "NoAuthority" ? "Wrong Person" : company.last_outcome}
              </span>
            )}
            {company.lead_status && (
              <span className="text-[11px]" style={{ color: MUTED }}>Status: {company.lead_status}</span>
            )}
            {company.followup_due && (
              <span className="text-[11px] font-medium" style={{ color: AMBER }}>
                Follow-up: {new Date(company.followup_due).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TodayPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [loggedCalls, setLoggedCalls] = useState<Map<string, string>>(new Map());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [callListOpen, setCallListOpen] = useState(false);

  const { data: todayData, isFetching } = useQuery<{ companies: TodayCompany[]; count: number }>({
    queryKey: ["/api/today-list"],
    enabled: !!token,
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
  });

  const { data: briefing } = useQuery<Briefing>({
    queryKey: ["/api/briefing"],
    enabled: !!token,
    placeholderData: (prev) => prev,
  });

  const { data: followupsData } = useQuery<{ followups: any[]; count: number }>({
    queryKey: ["/api/followups/due"],
    enabled: !!token,
    placeholderData: (prev) => prev,
  });

  const { data: oppsData } = useQuery<{ opportunities: Opportunity[]; count: number }>({
    queryKey: ["/api/opportunities"],
    enabled: !!token,
    placeholderData: (prev) => prev,
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

  const runPipelineMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/action/run-pipeline"),
    onMutate: () => {
      toast({ title: "Engine activated", description: "Machine is scanning the territory. Stand by.", duration: 3000 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/today-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
  });

  const logCallMutation = useMutation({
    mutationFn: (data: { company_name: string; outcome: string }) =>
      apiRequest("POST", "/api/calls/log", data),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["/api/today-list"] });
      setLoggedCalls(prev => new Map(prev).set(vars.company_name, vars.outcome));
    },
    onSuccess: (_res, vars) => {
      const fb = OUTCOME_FEEDBACK[vars.outcome];
      if (fb) toast({ title: fb.title, description: fb.description, duration: 2500 });
      queryClient.invalidateQueries({ queryKey: ["/api/today-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/confidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
    onError: (_err, vars) => {
      setLoggedCalls(prev => {
        const next = new Map(prev);
        next.delete(vars.company_name);
        return next;
      });
      toast({ title: "Signal lost", description: "Failed to log call. Try again.", variant: "destructive", duration: 4000 });
    },
  });

  const companies = todayData?.companies || [];
  const topAction = briefing?.recommended_actions?.[0];
  const followupCount = followupsData?.count ?? 0;
  const callsLogged = loggedCalls.size;

  const hotCount = companies.filter(c => c.bucket === "Hot Follow-up").length;
  const withDM = companies.filter(c => c.offer_dm_name).length;
  const withPlaybook = companies.filter(c => c.playbook_opener).length;

  const handleCopyPhone = useCallback((phone: string, companyId: string) => {
    navigator.clipboard.writeText(phone).catch(() => {});
    setCopiedId(companyId);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleOutcome = useCallback((companyName: string, outcome: string) => {
    logCallMutation.mutate({ company_name: companyName, outcome });
  }, [logCallMutation]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedCompany(prev => prev === id ? null : id);
  }, []);

  return (
    <AppLayout showBackToChip>
      <div className="p-4 md:p-6 max-w-[1200px] mx-auto" style={{ minHeight: "calc(100vh - 56px)" }}>

        <div className="mb-6">
          <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: MUTED }}>
            Today / Mission Control
          </span>
          <div className="flex items-center justify-between mt-1">
            <div>
              <h1 className="text-xl font-bold" style={{ color: TEXT }} data-testid="text-page-title">
                Mission Control
              </h1>
              <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                {companies.length} companies on today's list · {callsLogged} calls logged
              </p>
            </div>
            <div className="flex items-center gap-2">
              {companies.length > 0 && (
                <Button
                  onClick={() => navigate("/machine/outreach")}
                  className="rounded-lg text-xs font-bold px-4 h-8 gap-1.5"
                  style={{ background: TEXT, color: "#FFF" }}
                  data-testid="button-enter-outreach"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Outreach
                </Button>
              )}
            </div>
          </div>
        </div>

        {topAction && (
          <div
            className="rounded-xl p-4 mb-5 flex items-center gap-3"
            style={{
              background: topAction.type === "RUN_PIPELINE" ? "rgba(15,23,42,0.03)" : "rgba(16,185,129,0.04)",
              border: `1px solid ${topAction.type === "RUN_PIPELINE" ? "rgba(15,23,42,0.1)" : "rgba(16,185,129,0.15)"}`,
            }}
            data-testid="next-best-action"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: topAction.type === "RUN_PIPELINE" ? TEXT : EMERALD }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: TEXT }} data-testid="nba-title">{topAction.title}</p>
              <p className="text-xs" style={{ color: MUTED }}>{topAction.reason}</p>
            </div>
            {topAction.type === "RUN_PIPELINE" && (
              <Button
                size="sm"
                onClick={() => runPipelineMutation.mutate()}
                disabled={runPipelineMutation.isPending}
                className="rounded-lg text-xs font-bold px-3 h-8"
                style={{ background: TEXT, color: "#FFF" }}
                data-testid="nba-run-button"
              >
                {runPipelineMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Run Now"}
              </Button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Call List", value: companies.length, icon: ListChecks, color: TEXT },
            { label: "Hot", value: hotCount, icon: Zap, color: ERROR_RED },
            { label: "With DM", value: withDM, icon: User, color: EMERALD },
            { label: "Follow-ups", value: followupCount, icon: Clock, color: AMBER },
          ].map(s => (
            <div
              key={s.label}
              className="rounded-xl p-3.5"
              style={{ background: "#FFF", border: `1px solid ${BORDER}` }}
              data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: MUTED }}>{s.label}</span>
                <s.icon className="w-3.5 h-3.5" style={{ color: s.color }} />
              </div>
              <span className="text-2xl font-bold" style={{ color: TEXT }}>{s.value}</span>
            </div>
          ))}
        </div>

        <div
          className="rounded-xl mb-5 overflow-hidden"
          style={{ background: "#FFF", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
          data-testid="panel-call-list"
        >
          <button
            onClick={() => setCallListOpen(!callListOpen)}
            className="w-full flex items-center justify-between p-4 transition-colors hover:bg-gray-50/50"
            data-testid="button-toggle-call-list"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.12)" }}>
                <PhoneCall className="w-4 h-4" style={{ color: EMERALD }} />
              </div>
              <div className="text-left">
                <span className="text-sm font-bold block" style={{ color: TEXT }}>Today's Call List</span>
                <span className="text-[11px]" style={{ color: MUTED }}>
                  {companies.length} companies · {withPlaybook} with playbooks · {callsLogged} logged
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {callsLogged > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.08)", color: EMERALD }}>
                  {callsLogged}/{companies.length}
                </span>
              )}
              {callListOpen ? <ChevronUp className="w-4 h-4" style={{ color: MUTED }} /> : <ChevronDown className="w-4 h-4" style={{ color: MUTED }} />}
            </div>
          </button>

          {callListOpen && (
            <div style={{ borderTop: `1px solid ${BORDER}` }}>
              {!todayData && isFetching && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
                </div>
              )}

              {todayData && companies.length === 0 && (
                <div className="text-center py-12 px-4">
                  <Play className="w-8 h-8 mx-auto mb-3" style={{ color: MUTED }} />
                  <p className="text-sm font-medium" style={{ color: TEXT }}>No companies on today's list</p>
                  <p className="text-xs mb-4" style={{ color: MUTED }}>Run the pipeline to generate your call list.</p>
                  <Button
                    onClick={() => runPipelineMutation.mutate()}
                    disabled={runPipelineMutation.isPending}
                    className="rounded-lg text-xs font-bold px-6 h-9"
                    style={{ background: TEXT, color: "#FFF" }}
                    data-testid="empty-run-button"
                  >
                    {runPipelineMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Run Pipeline"}
                  </Button>
                </div>
              )}

              {companies.length > 0 && (
                <div className="p-3 space-y-2" data-testid="company-list">
                  {companies.map((company, idx) => (
                    <CompanyCard
                      key={company.id}
                      company={company}
                      idx={idx}
                      isExpanded={expandedCompany === company.id}
                      hasLogged={loggedCalls.has(company.company_name)}
                      loggedOutcome={loggedCalls.get(company.company_name)}
                      copiedId={copiedId}
                      opp={company.company_name ? oppByCompany.get(company.company_name.toLowerCase()) : undefined}
                      isPending={logCallMutation.isPending}
                      onToggleExpand={handleToggleExpand}
                      onCopyPhone={handleCopyPhone}
                      onOutcome={handleOutcome}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {!callListOpen && !todayData && isFetching && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: MUTED }} />
          </div>
        )}

        {!callListOpen && todayData && companies.length === 0 && (
          <div
            className="text-center py-16 rounded-xl"
            style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
          >
            <Play className="w-8 h-8 mx-auto mb-3" style={{ color: MUTED }} />
            <p className="text-sm font-medium" style={{ color: TEXT }}>No companies on today's list</p>
            <p className="text-xs mb-4" style={{ color: MUTED }}>Run the pipeline to generate your call list.</p>
            <Button
              onClick={() => runPipelineMutation.mutate()}
              disabled={runPipelineMutation.isPending}
              className="rounded-lg text-xs font-bold px-6 h-10"
              style={{ background: TEXT, color: "#FFF" }}
              data-testid="empty-run-button-main"
            >
              {runPipelineMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Run Pipeline"}
            </Button>
          </div>
        )}

        {!callListOpen && companies.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div
              className="rounded-xl p-4 cursor-pointer transition-colors hover:bg-gray-50/50"
              style={{ background: "#FFF", border: `1px solid ${BORDER}` }}
              onClick={() => setCallListOpen(true)}
              data-testid="card-quick-call"
            >
              <div className="flex items-center gap-2 mb-2">
                <Phone className="w-4 h-4" style={{ color: EMERALD }} />
                <span className="text-sm font-bold" style={{ color: TEXT }}>Start Calling</span>
              </div>
              <p className="text-xs" style={{ color: MUTED }}>
                {companies.length - callsLogged} remaining · {hotCount > 0 ? `${hotCount} hot leads` : "Open call list"}
              </p>
            </div>

            <div
              className="rounded-xl p-4 cursor-pointer transition-colors hover:bg-gray-50/50"
              style={{ background: "#FFF", border: `1px solid ${BORDER}` }}
              onClick={() => setCallListOpen(true)}
              data-testid="card-quick-playbooks"
            >
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-4 h-4" style={{ color: BLUE }} />
                <span className="text-sm font-bold" style={{ color: TEXT }}>Playbooks</span>
              </div>
              <p className="text-xs" style={{ color: MUTED }}>
                {withPlaybook} scripts ready · Expand companies for scripts
              </p>
            </div>

            <div
              className="rounded-xl p-4 cursor-pointer transition-colors hover:bg-gray-50/50"
              style={{ background: "#FFF", border: `1px solid ${BORDER}` }}
              onClick={() => navigate("/machine/outreach")}
              data-testid="card-quick-outreach"
            >
              <div className="flex items-center gap-2 mb-2">
                <Mail className="w-4 h-4" style={{ color: AMBER }} />
                <span className="text-sm font-bold" style={{ color: TEXT }}>Outreach</span>
              </div>
              <p className="text-xs" style={{ color: MUTED }}>
                View pipeline and send follow-ups
              </p>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
