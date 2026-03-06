import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Phone, Copy, Check, ChevronLeft, ChevronRight, X, Mail, Globe,
  MapPin, User, Shield, FileText, MessageSquare, Loader2, Calendar,
  ArrowLeft, Zap, ClipboardList,
} from "lucide-react";

const EMERALD = "#10B981";
const EMERALD_DARK = "#059669";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const ERROR_RED = "#EF4444";
const WARN = "#F59E0B";
const BLUE = "#3B82F6";

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
  playbook_email_subject: string;
  playbook_email_body: string;
  followup_due: string;
  website: string;
  city: string;
  gatekeeper_name: string;
}

const OUTCOMES = [
  { value: "Decision Maker", label: "DM", color: EMERALD, icon: User, desc: "Spoke with decision maker" },
  { value: "Gatekeeper", label: "Gatekeeper", color: BLUE, icon: Shield, desc: "Spoke with gatekeeper" },
  { value: "No Answer", label: "No Answer", color: MUTED, icon: Phone, desc: "No one picked up" },
  { value: "Qualified", label: "Qualified", color: EMERALD_DARK, icon: Zap, desc: "Qualified opportunity" },
  { value: "Callback", label: "Callback", color: WARN, icon: Calendar, desc: "Schedule callback" },
  { value: "Not Interested", label: "Not Interested", color: ERROR_RED, icon: X, desc: "Not a fit" },
] as const;

const SIGNAL_MAP: Record<string, { title: string; description: string }> = {
  "Decision Maker": { title: "Signal captured", description: "DM reached. Targeting will improve." },
  "Gatekeeper": { title: "Intel gathered", description: "Gatekeeper mapped. Machine is learning." },
  "No Answer": { title: "Noted", description: "Follow-up queued. Machine will try again." },
  "Qualified": { title: "Opportunity created", description: "High-value target moved to pipeline." },
  "Callback": { title: "Callback locked", description: "Machine will remind you at the right time." },
  "Not Interested": { title: "Signal absorbed", description: "Targeting recalibrated. Moving on." },
};

export default function CallModePage() {
  const { getToken } = useAuth();
  const token = getToken();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [currentIdx, setCurrentIdx] = useState(0);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [activePanel, setActivePanel] = useState<"info" | "scripts">("info");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [showGkPrompt, setShowGkPrompt] = useState(false);
  const [gkName, setGkName] = useState("");

  const [showQualPrompt, setShowQualPrompt] = useState(false);
  const [qualNotes, setQualNotes] = useState("");

  const [showCbPrompt, setShowCbPrompt] = useState(false);
  const [cbDate, setCbDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [cbNotes, setCbNotes] = useState("");

  const { data: todayData, isLoading } = useQuery<{ companies: TodayCompany[]; count: number }>({
    queryKey: ["/api/today-list"],
    enabled: !!token,
  });

  const companies = todayData?.companies || [];
  const safeIdx = Math.min(currentIdx, Math.max(0, companies.length - 1));
  const company = companies.length > 0 ? companies[safeIdx] : null;
  const completedCount = companies.filter(c => completedIds.has(c.id)).length;
  const remaining = companies.length - completedCount;

  const logCallMutation = useMutation({
    mutationFn: (data: { company_name: string; outcome: string; notes?: string; gatekeeper_name?: string }) =>
      apiRequest("POST", "/api/calls/log", data),
    onSuccess: (_res, vars) => {
      if (company) {
        setCompletedIds(prev => new Set(prev).add(company.id));
      }

      const fb = SIGNAL_MAP[vars.outcome];
      toast({
        title: fb?.title || `Signal: ${vars.outcome}`,
        description: fb?.description || `${vars.company_name} logged.`,
        duration: 2500,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/today-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });

      setTimeout(() => {
        if (safeIdx < companies.length - 1) {
          setCurrentIdx(safeIdx + 1);
        }
      }, 600);
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to log call",
        description: err.message || "Something went wrong. Try again.",
        variant: "destructive",
        duration: 4000,
      });
    },
  });

  const logOutcome = useCallback((outcome: string, extras?: { notes?: string; gatekeeper_name?: string }) => {
    if (!company) return;
    logCallMutation.mutate({
      company_name: company.company_name,
      outcome,
      notes: extras?.notes,
      gatekeeper_name: extras?.gatekeeper_name,
    });
  }, [company, logCallMutation]);

  const handleOutcome = useCallback((outcome: string) => {
    if (!company) return;

    if (outcome === "Gatekeeper") {
      setGkName(company.gatekeeper_name || "");
      setShowGkPrompt(true);
      return;
    }
    if (outcome === "Qualified") {
      setShowQualPrompt(true);
      return;
    }
    if (outcome === "Callback") {
      setShowCbPrompt(true);
      return;
    }

    logOutcome(outcome);
  }, [company, logOutcome]);

  const submitGatekeeper = () => {
    logOutcome("Gatekeeper", { gatekeeper_name: gkName || undefined });
    setShowGkPrompt(false);
    setGkName("");
  };

  const submitQualified = () => {
    logOutcome("Qualified", { notes: qualNotes || undefined });
    setShowQualPrompt(false);
    setQualNotes("");
  };

  const submitCallback = () => {
    const notes = `Callback date: ${cbDate}${cbNotes ? `. ${cbNotes}` : ""}`;
    logOutcome("Callback", { notes });
    setShowCbPrompt(false);
    setCbNotes("");
  };

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1500);
    });
  }, []);

  const callPhone = company?.offer_dm_phone || company?.phone || "";
  const askFor = company?.offer_dm_name
    ? `${company.offer_dm_name}${company.offer_dm_title ? ` (${company.offer_dm_title})` : ""}`
    : "Safety Manager / Site Superintendent";

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (showGkPrompt || showQualPrompt || showCbPrompt) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (logCallMutation.isPending) return;
      if (e.key === "ArrowRight" && safeIdx < companies.length - 1) { e.preventDefault(); setCurrentIdx(safeIdx + 1); }
      if (e.key === "ArrowLeft" && safeIdx > 0) { e.preventDefault(); setCurrentIdx(safeIdx - 1); }
      if (e.key === "1") handleOutcome("Decision Maker");
      if (e.key === "2") handleOutcome("Gatekeeper");
      if (e.key === "3") handleOutcome("No Answer");
      if (e.key === "4") handleOutcome("Qualified");
      if (e.key === "5") handleOutcome("Callback");
      if (e.key === "6") handleOutcome("Not Interested");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [safeIdx, companies.length, handleOutcome, showGkPrompt, showQualPrompt, showCbPrompt, logCallMutation.isPending]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: TEXT }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: EMERALD }} />
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: TEXT }}>
        <ClipboardList className="w-12 h-12" style={{ color: MUTED }} />
        <p className="text-lg font-semibold" style={{ color: "#FFF" }}>No companies on today's list</p>
        <p className="text-sm" style={{ color: MUTED }}>Run the pipeline first to populate the call list.</p>
        <Button onClick={() => navigate("/machine/today")} className="mt-4" style={{ background: EMERALD, color: "#FFF" }} data-testid="button-back-today">
          Back to Mission Control
        </Button>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: TEXT }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: EMERALD }} />
      </div>
    );
  }

  const isCompleted = completedIds.has(company.id);

  const CopyBtn = ({ text, label, id }: { text: string; label: string; id: string }) => (
    <button
      onClick={() => copyToClipboard(text, id)}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors"
      style={{
        background: copiedField === id ? `${EMERALD}15` : `${SUBTLE}`,
        color: copiedField === id ? EMERALD : MUTED,
        border: `1px solid ${copiedField === id ? `${EMERALD}30` : BORDER}`,
      }}
      data-testid={`copy-${id}`}
    >
      {copiedField === id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copiedField === id ? "Copied" : label}
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: TEXT }} data-testid="call-mode-page">
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid rgba(255,255,255,0.08)` }}
      >
        <button
          onClick={() => navigate("/machine/today")}
          className="flex items-center gap-2 text-sm font-mono"
          style={{ color: MUTED }}
          data-testid="button-exit-call-mode"
        >
          <ArrowLeft className="w-4 h-4" /> Exit Call Mode
        </button>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono" style={{ color: EMERALD }} data-testid="text-completed-count">
              {completedCount} done
            </span>
            <span className="text-xs font-mono" style={{ color: MUTED }}>|</span>
            <span className="text-xs font-mono" style={{ color: MUTED }} data-testid="text-remaining-count">
              {remaining} left
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentIdx(Math.max(0, safeIdx - 1))}
              disabled={safeIdx === 0}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: safeIdx === 0 ? "rgba(255,255,255,0.15)" : "#FFF" }}
              data-testid="button-prev-company"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-mono px-2" style={{ color: "#FFF" }} data-testid="text-card-position">
              {safeIdx + 1}/{companies.length}
            </span>
            <button
              onClick={() => setCurrentIdx(Math.min(companies.length - 1, safeIdx + 1))}
              disabled={safeIdx === companies.length - 1}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: safeIdx === companies.length - 1 ? "rgba(255,255,255,0.15)" : "#FFF" }}
              data-testid="button-next-company"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div
          className="w-32 h-1.5 rounded-full overflow-hidden"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ background: EMERALD, width: `${(completedCount / companies.length) * 100}%` }}
            data-testid="progress-bar"
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={safeIdx}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.25 }}
            className="flex-1 flex flex-col overflow-y-auto"
          >
            <div className="flex-1 p-4 md:p-6 lg:p-8 max-w-3xl mx-auto w-full">
              <div className="mb-6">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <h1
                      className="text-2xl md:text-3xl font-bold"
                      style={{ color: "#FFF" }}
                      data-testid="text-company-name"
                    >
                      {company.company_name}
                    </h1>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {company.city && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: MUTED }}>
                          <MapPin className="w-3 h-3" /> {company.city}
                        </span>
                      )}
                      {company.website && (
                        <a
                          href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs"
                          style={{ color: BLUE }}
                          data-testid="link-website"
                        >
                          <Globe className="w-3 h-3" /> Website
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="px-2 py-0.5 rounded text-xs font-mono font-bold"
                      style={{
                        background: company.bucket === "Hot Follow-up" ? `${ERROR_RED}20` : company.bucket === "Working" ? `${WARN}20` : `${BLUE}20`,
                        color: company.bucket === "Hot Follow-up" ? ERROR_RED : company.bucket === "Working" ? WARN : BLUE,
                      }}
                      data-testid="badge-bucket"
                    >
                      {company.bucket}
                    </span>
                    {isCompleted && (
                      <span className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: `${EMERALD}20`, color: EMERALD }}>
                        Done
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="rounded-xl p-4 mb-4"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-mono uppercase tracking-widest" style={{ color: MUTED }}>Contact</span>
                  <div className="flex gap-1.5">
                    {callPhone && <CopyBtn text={callPhone} label="Phone" id="phone" />}
                    {company.offer_dm_email && <CopyBtn text={company.offer_dm_email} label="Email" id="email" />}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" style={{ color: EMERALD }} />
                    <span className="text-sm font-semibold" style={{ color: "#FFF" }} data-testid="text-ask-for">
                      Ask for: {askFor}
                    </span>
                  </div>

                  {callPhone && (
                    <a
                      href={`tel:${callPhone.replace(/\s/g, "")}`}
                      className="flex items-center gap-2 text-lg font-bold"
                      style={{ color: EMERALD }}
                      data-testid="link-call-phone"
                    >
                      <Phone className="w-5 h-5" /> {callPhone}
                    </a>
                  )}

                  {company.offer_dm_email && (
                    <a
                      href={`mailto:${company.offer_dm_email}`}
                      className="flex items-center gap-2 text-sm"
                      style={{ color: BLUE }}
                      data-testid="link-email"
                    >
                      <Mail className="w-4 h-4" /> {company.offer_dm_email}
                    </a>
                  )}

                  {(company.gatekeeper_name) && (
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4" style={{ color: WARN }} />
                      <span className="text-sm" style={{ color: MUTED }}>
                        Gatekeeper: <span style={{ color: "#FFF", fontWeight: 500 }}>{company.gatekeeper_name}</span>
                      </span>
                    </div>
                  )}

                  {company.times_called > 0 && (
                    <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
                      <span>Called {company.times_called}x</span>
                      {company.last_outcome && <span>Last: {company.last_outcome}</span>}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setActivePanel("info")}
                  className="flex-1 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-colors"
                  style={{
                    background: activePanel === "info" ? "rgba(255,255,255,0.08)" : "transparent",
                    color: activePanel === "info" ? "#FFF" : MUTED,
                    border: `1px solid ${activePanel === "info" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)"}`,
                  }}
                  data-testid="tab-info"
                >
                  Intel
                </button>
                <button
                  onClick={() => setActivePanel("scripts")}
                  className="flex-1 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-colors"
                  style={{
                    background: activePanel === "scripts" ? "rgba(255,255,255,0.08)" : "transparent",
                    color: activePanel === "scripts" ? "#FFF" : MUTED,
                    border: `1px solid ${activePanel === "scripts" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)"}`,
                  }}
                  data-testid="tab-scripts"
                >
                  Scripts
                </button>
              </div>

              {activePanel === "info" && (
                <div className="space-y-3">
                  {company.rank_reason && (
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <p className="text-xs font-mono uppercase tracking-widest mb-2" style={{ color: MUTED }}>Why This Company</p>
                      <p className="text-sm leading-relaxed" style={{ color: "#E2E8F0" }} data-testid="text-rank-reason">
                        {company.rank_reason}
                      </p>
                    </div>
                  )}
                  {company.rank_evidence && (
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <p className="text-xs font-mono uppercase tracking-widest mb-2" style={{ color: MUTED }}>Evidence</p>
                      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#94A3B8" }} data-testid="text-rank-evidence">
                        {company.rank_evidence}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {activePanel === "scripts" && (
                <div className="space-y-3">
                  {company.playbook_opener && (
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-mono uppercase tracking-widest" style={{ color: EMERALD }}>Call Opener</p>
                        <CopyBtn text={company.playbook_opener} label="Copy" id="opener" />
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: "#E2E8F0" }} data-testid="text-script-opener">
                        {company.playbook_opener}
                      </p>
                    </div>
                  )}
                  {company.playbook_gatekeeper && (
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-mono uppercase tracking-widest" style={{ color: WARN }}>Gatekeeper Script</p>
                        <CopyBtn text={company.playbook_gatekeeper} label="Copy" id="gatekeeper-script" />
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: "#E2E8F0" }} data-testid="text-script-gatekeeper">
                        {company.playbook_gatekeeper}
                      </p>
                    </div>
                  )}
                  {company.playbook_voicemail && (
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-mono uppercase tracking-widest" style={{ color: MUTED }}>Voicemail</p>
                        <CopyBtn text={company.playbook_voicemail} label="Copy" id="voicemail" />
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: "#94A3B8" }} data-testid="text-script-voicemail">
                        {company.playbook_voicemail}
                      </p>
                    </div>
                  )}
                  {company.playbook_email_subject && (
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-mono uppercase tracking-widest" style={{ color: BLUE }}>Follow-up Email</p>
                        <CopyBtn text={`Subject: ${company.playbook_email_subject}\n\n${company.playbook_email_body}`} label="Copy" id="email-template" />
                      </div>
                      <p className="text-xs font-bold mb-1" style={{ color: "#E2E8F0" }}>
                        Subject: {company.playbook_email_subject}
                      </p>
                      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#94A3B8" }} data-testid="text-script-email">
                        {company.playbook_email_body}
                      </p>
                    </div>
                  )}
                  {company.playbook_followup && (
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-mono uppercase tracking-widest" style={{ color: MUTED }}>SMS Follow-up</p>
                        <CopyBtn text={company.playbook_followup} label="Copy" id="sms" />
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: "#94A3B8" }} data-testid="text-script-sms">
                        {company.playbook_followup}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        <div
          className="lg:w-80 xl:w-96 p-4 md:p-6 flex flex-col gap-3"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)" }}
        >
          <p className="text-xs font-mono uppercase tracking-widest mb-1" style={{ color: MUTED }}>
            Log Outcome
          </p>

          {OUTCOMES.map((o, idx) => (
            <button
              key={o.value}
              onClick={() => handleOutcome(o.value)}
              disabled={logCallMutation.isPending}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all"
              style={{
                background: `${o.color}10`,
                border: `1px solid ${o.color}30`,
                color: "#FFF",
              }}
              data-testid={`outcome-${o.value.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${o.color}20` }}
              >
                <o.icon className="w-4 h-4" style={{ color: o.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{o.label}</p>
                <p className="text-xs" style={{ color: MUTED }}>{o.desc}</p>
              </div>
              <span className="text-xs font-mono" style={{ color: MUTED }}>{idx + 1}</span>
            </button>
          ))}

          {logCallMutation.isPending && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: EMERALD }} />
              <span className="text-xs font-mono" style={{ color: MUTED }}>Logging...</span>
            </div>
          )}

          <p className="text-xs font-mono mt-auto pt-4 text-center" style={{ color: "rgba(255,255,255,0.15)" }}>
            Keys 1-6 for outcomes · ← → to navigate
          </p>
        </div>
      </div>

      <AnimatePresence>
        {showGkPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setShowGkPrompt(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 w-80"
              style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)" }}
              data-testid="modal-gatekeeper"
            >
              <p className="text-sm font-bold mb-2" style={{ color: "#FFF" }}>
                {company?.gatekeeper_name ? "Confirm gatekeeper" : "Who answered?"}
              </p>
              {company?.gatekeeper_name && (
                <p className="text-xs mb-3" style={{ color: MUTED }}>
                  On file: <span style={{ color: "#FFF" }}>{company.gatekeeper_name}</span> — press Enter to confirm or type a new name.
                </p>
              )}
              <input
                autoFocus
                value={gkName}
                onChange={(e) => setGkName(e.target.value)}
                placeholder="e.g., Sarah at front desk"
                className="w-full px-3 py-2 rounded-lg text-sm mb-4"
                style={{ background: "rgba(255,255,255,0.06)", color: "#FFF", border: "1px solid rgba(255,255,255,0.1)" }}
                onKeyDown={(e) => e.key === "Enter" && submitGatekeeper()}
                data-testid="input-gatekeeper-name"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => { setShowGkPrompt(false); setGkName(""); }}
                  className="flex-1 text-sm" style={{ background: "rgba(255,255,255,0.06)", color: MUTED }}
                  data-testid="button-gk-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitGatekeeper}
                  className="flex-1 text-sm font-bold" style={{ background: BLUE, color: "#FFF" }}
                  data-testid="button-gk-submit"
                >
                  Log Gatekeeper
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showQualPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setShowQualPrompt(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 w-96"
              style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)" }}
              data-testid="modal-qualified"
            >
              <p className="text-sm font-bold mb-3" style={{ color: "#FFF" }}>Qualified — Quick Notes</p>
              <textarea
                autoFocus
                value={qualNotes}
                onChange={(e) => setQualNotes(e.target.value)}
                placeholder="Crew size? Timeline? Key details..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg text-sm mb-4 resize-none"
                style={{ background: "rgba(255,255,255,0.06)", color: "#FFF", border: "1px solid rgba(255,255,255,0.1)" }}
                data-testid="input-qual-notes"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => { setShowQualPrompt(false); setQualNotes(""); }}
                  className="flex-1 text-sm" style={{ background: "rgba(255,255,255,0.06)", color: MUTED }}
                  data-testid="button-qual-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitQualified}
                  className="flex-1 text-sm font-bold" style={{ background: EMERALD_DARK, color: "#FFF" }}
                  data-testid="button-qual-submit"
                >
                  Log Qualified
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCbPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setShowCbPrompt(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 w-80"
              style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)" }}
              data-testid="modal-callback"
            >
              <p className="text-sm font-bold mb-3" style={{ color: "#FFF" }}>Schedule Callback</p>
              <input
                type="date"
                value={cbDate}
                onChange={(e) => setCbDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm mb-3"
                style={{ background: "rgba(255,255,255,0.06)", color: "#FFF", border: "1px solid rgba(255,255,255,0.1)" }}
                data-testid="input-callback-date"
              />
              <input
                value={cbNotes}
                onChange={(e) => setCbNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="w-full px-3 py-2 rounded-lg text-sm mb-4"
                style={{ background: "rgba(255,255,255,0.06)", color: "#FFF", border: "1px solid rgba(255,255,255,0.1)" }}
                onKeyDown={(e) => e.key === "Enter" && submitCallback()}
                data-testid="input-callback-notes"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => { setShowCbPrompt(false); setCbNotes(""); }}
                  className="flex-1 text-sm" style={{ background: "rgba(255,255,255,0.06)", color: MUTED }}
                  data-testid="button-cb-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitCallback}
                  className="flex-1 text-sm font-bold" style={{ background: WARN, color: TEXT }}
                  data-testid="button-cb-submit"
                >
                  Log Callback
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
