import { useState, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { List } from "react-window";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import DealCard from "@/components/deal-card";
import type { Opportunity } from "@/components/deal-card";
import {
  Phone,
  Copy,
  ChevronDown,
  ChevronUp,
  Play,
  Zap,
  ClipboardList,
  Clock,
  CheckCircle2,
  User,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { CSSProperties, ReactElement } from "react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const ERROR_RED = "#EF4444";

const COLLAPSED_ROW_HEIGHT = 110;
const EXPANDED_ROW_HEIGHT = 380;

const OUTCOMES = [
  { value: "Decision Maker", label: "DM", color: "#10B981" },
  { value: "Gatekeeper", label: "GK", color: "#3B82F6" },
  { value: "No Answer", label: "N/A", color: "#94A3B8" },
  { value: "Qualified", label: "Qual", color: "#059669" },
  { value: "Callback", label: "CB", color: "#F59E0B" },
  { value: "Not Interested", label: "NI", color: "#EF4444" },
  { value: "NoAuthority", label: "Wrong Person", color: "#F59E0B" },
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

const STEP_CHIPS = [
  { id: "run", label: "Run Pipeline", icon: Play },
  { id: "call", label: "Call Hot", icon: Zap },
  { id: "log", label: "Log Outcome", icon: ClipboardList },
  { id: "followup", label: "Follow Up", icon: Clock },
] as const;

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

const bucketColor = (bucket: string) => {
  switch (bucket) {
    case "Hot Follow-up": return ERROR_RED;
    case "Working": return "#F59E0B";
    case "Fresh": return "#3B82F6";
    default: return MUTED;
  }
};

interface CompanyRowInnerProps {
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
}

function CompanyRowInner({
  company, idx, isExpanded, hasLogged, loggedOutcome,
  copiedId, opp, isPending, onToggleExpand, onCopyPhone, onOutcome,
}: CompanyRowInnerProps) {
  const callPhone = company.offer_dm_phone || company.phone;
  const isMobile = /^\+?\d[\d\s()-]{7,}$/.test(callPhone);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "#FFF",
        border: `1px solid ${hasLogged ? `${EMERALD}30` : BORDER}`,
        boxShadow: hasLogged ? `0 0 0 1px ${EMERALD}15` : "0 1px 2px rgba(0,0,0,0.04)",
      }}
      data-testid={`company-row-${idx}`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
            style={{ background: bucketColor(company.bucket) }}
            title={company.bucket}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold truncate" style={{ color: TEXT }} data-testid={`company-name-${idx}`}>
                {company.company_name}
              </p>
              <span
                className="text-xs font-mono px-1.5 py-0.5 rounded"
                style={{
                  background: company.final_priority >= 60 ? `${EMERALD}12` : company.final_priority >= 40 ? "#F59E0B12" : `${MUTED}12`,
                  color: company.final_priority >= 60 ? EMERALD : company.final_priority >= 40 ? "#D97706" : MUTED,
                }}
              >
                P{company.final_priority}
              </span>
              {company.bucket && (
                <span className="text-xs font-mono" style={{ color: bucketColor(company.bucket) }}>
                  {company.bucket}
                </span>
              )}
              {hasLogged && (
                <span className="flex items-center gap-0.5 text-xs" style={{ color: EMERALD }}>
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
                  <span className="text-xs" style={{ color: MUTED }}>({company.offer_dm_title})</span>
                )}
              </div>
            )}

            {opp && <DealCard opportunity={opp} compact />}

            <div className="flex items-center gap-2 flex-wrap">
              {callPhone ? (
                <>
                  {isMobile ? (
                    <a
                      href={`tel:${callPhone.replace(/\s/g, "")}`}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors"
                      style={{ background: `${EMERALD}12`, color: EMERALD }}
                      data-testid={`call-button-${idx}`}
                    >
                      <Phone className="w-3 h-3" /> Call
                    </a>
                  ) : (
                    <button
                      onClick={() => onCopyPhone(callPhone, company.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors"
                      style={{ background: `${EMERALD}12`, color: EMERALD }}
                      data-testid={`call-button-${idx}`}
                    >
                      {copiedId === company.id ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedId === company.id ? "Copied" : callPhone}
                    </button>
                  )}
                </>
              ) : (
                <span className="text-xs font-mono" style={{ color: MUTED }}>No phone</span>
              )}

              {!hasLogged && (
                <div className="flex items-center gap-1" data-testid={`outcome-buttons-${idx}`}>
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.value}
                      onClick={() => onOutcome(company.company_name, o.value)}
                      disabled={isPending}
                      className="px-2 py-1 rounded-md text-xs font-semibold transition-all hover:opacity-80"
                      style={{
                        background: `${o.color}12`,
                        color: o.color,
                        border: `1px solid ${o.color}25`,
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
                className="ml-auto p-1 rounded"
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
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-0 border-t" style={{ borderColor: BORDER }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              {company.playbook_opener && (
                <div className="rounded-lg p-3" style={{ background: SUBTLE }}>
                  <p className="text-xs font-mono tracking-widest uppercase mb-1.5" style={{ color: MUTED }}>Call Opener</p>
                  <p className="text-xs leading-relaxed" style={{ color: TEXT }} data-testid={`playbook-opener-${idx}`}>
                    {company.playbook_opener}
                  </p>
                </div>
              )}
              {company.playbook_gatekeeper && (
                <div className="rounded-lg p-3" style={{ background: SUBTLE }}>
                  <p className="text-xs font-mono tracking-widest uppercase mb-1.5" style={{ color: MUTED }}>Gatekeeper Script</p>
                  <p className="text-xs leading-relaxed" style={{ color: TEXT }} data-testid={`playbook-gatekeeper-${idx}`}>
                    {company.playbook_gatekeeper}
                  </p>
                </div>
              )}
              {company.playbook_voicemail && (
                <div className="rounded-lg p-3" style={{ background: SUBTLE }}>
                  <p className="text-xs font-mono tracking-widest uppercase mb-1.5" style={{ color: MUTED }}>Voicemail</p>
                  <p className="text-xs leading-relaxed" style={{ color: TEXT }}>
                    {company.playbook_voicemail}
                  </p>
                </div>
              )}
              {company.playbook_followup && (
                <div className="rounded-lg p-3" style={{ background: SUBTLE }}>
                  <p className="text-xs font-mono tracking-widest uppercase mb-1.5" style={{ color: MUTED }}>Follow-up</p>
                  <p className="text-xs leading-relaxed" style={{ color: TEXT }}>
                    {company.playbook_followup}
                  </p>
                </div>
              )}
            </div>

            {(company.rank_reason || company.rank_evidence) && (
              <div className="mt-3 rounded-lg p-3" style={{ background: `${EMERALD}06`, border: `1px solid ${EMERALD}15` }}>
                <p className="text-xs font-mono tracking-widest uppercase mb-1.5" style={{ color: EMERALD }}>Rank Evidence</p>
                {company.rank_reason && (
                  <p className="text-xs leading-relaxed mb-1" style={{ color: TEXT }}>
                    {company.rank_reason}
                  </p>
                )}
                {company.rank_evidence && (
                  <p className="text-xs leading-relaxed" style={{ color: MUTED }}>
                    {company.rank_evidence}
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {company.times_called > 0 && (
                <span className="text-xs font-mono" style={{ color: MUTED }}>
                  Called {company.times_called}x
                </span>
              )}
              {company.last_outcome && (
                <span className="text-xs font-mono" style={{
                  color: company.last_outcome === "NoAuthority" ? "#F59E0B" : MUTED
                }} data-testid={`outcome-badge-${company.id}`}>
                  Last: {company.last_outcome === "NoAuthority" ? "Wrong Person" : company.last_outcome}
                </span>
              )}
              {company.lead_status && (
                <span className="text-xs font-mono" style={{ color: MUTED }}>
                  Status: {company.lead_status}
                </span>
              )}
              {company.followup_due && (
                <span className="text-xs font-mono" style={{ color: "#F59E0B" }}>
                  Follow-up: {new Date(company.followup_due).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface VirtualRowProps {
  companies: TodayCompany[];
  expandedCompany: string | null;
  loggedCalls: Map<string, string>;
  copiedId: string | null;
  oppByCompany: Map<string, Opportunity>;
  isPending: boolean;
  onToggleExpand: (id: string) => void;
  onCopyPhone: (phone: string, id: string) => void;
  onOutcome: (name: string, outcome: string) => void;
}

function VirtualRow(props: { index: number; style: CSSProperties } & VirtualRowProps): ReactElement | null {
  const { index, style, companies, expandedCompany, loggedCalls, copiedId, oppByCompany, isPending, onToggleExpand, onCopyPhone, onOutcome } = props;
  const company = companies[index];
  if (!company) return null;

  return (
    <div style={{ ...style, paddingBottom: 8 }}>
      <CompanyRowInner
        company={company}
        idx={index}
        isExpanded={expandedCompany === company.id}
        hasLogged={loggedCalls.has(company.company_name)}
        loggedOutcome={loggedCalls.get(company.company_name)}
        copiedId={copiedId}
        opp={company.company_name ? oppByCompany.get(company.company_name.toLowerCase()) : undefined}
        isPending={isPending}
        onToggleExpand={onToggleExpand}
        onCopyPhone={onCopyPhone}
        onOutcome={onOutcome}
      />
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
  const [activeStep, setActiveStep] = useState<string>("call");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: todayData, isLoading: isQueryLoading, isFetching } = useQuery<{ companies: TodayCompany[]; count: number }>({
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
    mutationFn: (data: { company_name: string; outcome: string; notes?: string; gatekeeper_name?: string }) =>
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

  const getRowHeight = useCallback((index: number) => {
    const company = companies[index];
    if (!company) return COLLAPSED_ROW_HEIGHT;
    return expandedCompany === company.id ? EXPANDED_ROW_HEIGHT : COLLAPSED_ROW_HEIGHT;
  }, [companies, expandedCompany]);

  const useVirtualization = companies.length > 30;

  const rowProps: VirtualRowProps = useMemo(() => ({
    companies,
    expandedCompany,
    loggedCalls,
    copiedId,
    oppByCompany,
    isPending: logCallMutation.isPending,
    onToggleExpand: handleToggleExpand,
    onCopyPhone: handleCopyPhone,
    onOutcome: handleOutcome,
  }), [companies, expandedCompany, loggedCalls, copiedId, oppByCompany, logCallMutation.isPending, handleToggleExpand, handleCopyPhone, handleOutcome]);

  return (
    <AppLayout showBackToChip>
      <div className="p-4 md:p-6" style={{ minHeight: "calc(100vh - 56px)" }}>
        {topAction && (
          <div
            className="rounded-xl p-4 mb-5 flex items-center gap-3"
            style={{
              background: topAction.type === "RUN_PIPELINE" ? `${TEXT}08` : `${EMERALD}08`,
              border: `1px solid ${topAction.type === "RUN_PIPELINE" ? `${TEXT}20` : `${EMERALD}25`}`,
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
                className="rounded-lg text-xs font-semibold px-3 h-8"
                style={{ background: TEXT, color: "#FFF" }}
                data-testid="nba-run-button"
              >
                {runPipelineMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Run Now"}
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mb-5 overflow-x-auto" data-testid="step-chips">
          {STEP_CHIPS.map((chip) => {
            const isActive = activeStep === chip.id;
            let badge = "";
            if (chip.id === "call") badge = `${companies.length}`;
            if (chip.id === "log") badge = `${callsLogged}`;
            if (chip.id === "followup") badge = `${followupCount}`;

            return (
              <button
                key={chip.id}
                onClick={() => {
                  setActiveStep(chip.id);
                  if (chip.id === "run") runPipelineMutation.mutate();
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
                style={{
                  background: isActive ? `${EMERALD}12` : SUBTLE,
                  border: `1px solid ${isActive ? `${EMERALD}35` : BORDER}`,
                  color: isActive ? EMERALD : TEXT,
                }}
                data-testid={`step-chip-${chip.id}`}
              >
                <chip.icon className="w-3.5 h-3.5" />
                {chip.label}
                {badge && (
                  <span
                    className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-mono"
                    style={{ background: isActive ? `${EMERALD}20` : `${TEXT}08`, fontSize: "10px" }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold" style={{ color: TEXT }} data-testid="text-page-title">
              Mission Control
            </h1>
            <p className="text-xs font-mono" style={{ color: MUTED }}>
              {companies.length} companies · {callsLogged} calls logged today
            </p>
          </div>
          {companies.length > 0 && (
            <Button
              onClick={() => navigate("/machine/call-mode")}
              className="rounded-lg text-sm font-semibold px-5 h-9 gap-2"
              style={{ background: TEXT, color: "#FFF" }}
              data-testid="button-enter-call-mode"
            >
              <Phone className="w-4 h-4" />
              Call Mode
            </Button>
          )}
        </div>

        {!todayData && isFetching && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: MUTED }} />
          </div>
        )}

        {todayData && companies.length === 0 && (
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
              className="rounded-lg text-sm font-semibold px-6 h-10"
              style={{ background: TEXT, color: "#FFF" }}
              data-testid="empty-run-button"
            >
              {runPipelineMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Run Pipeline"}
            </Button>
          </div>
        )}

        <div data-testid="company-list">
          {companies.length > 0 && useVirtualization ? (
            <List
              rowComponent={VirtualRow}
              rowCount={companies.length}
              rowHeight={getRowHeight}
              rowProps={rowProps}
              overscanCount={5}
              style={{ height: "calc(100vh - 320px)", minHeight: 400 }}
            />
          ) : (
            <div className="space-y-2">
              {companies.map((company, idx) => (
                <CompanyRowInner
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
      </div>
    </AppLayout>
  );
}
