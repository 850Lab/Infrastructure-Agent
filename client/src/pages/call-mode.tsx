import { useState, useCallback, useEffect, useRef } from "react";
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
  ArrowLeft, Zap, ClipboardList, Mic, Upload, CheckCircle2, AlertTriangle, Brain,
  PhoneCall, Send, Radio, Volume2, Target, Clock,
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
  playbook_strategy_notes: string;
  playbook_applied_patches: string;
  playbook_confidence: number;
  playbook_learning_version: string;
}

const OUTCOMES = [
  { value: "Decision Maker", label: "DM", color: EMERALD, icon: User, desc: "Spoke with decision maker" },
  { value: "Gatekeeper", label: "Gatekeeper", color: BLUE, icon: Shield, desc: "Spoke with gatekeeper" },
  { value: "No Answer", label: "No Answer", color: MUTED, icon: Phone, desc: "No one picked up" },
  { value: "Qualified", label: "Qualified", color: EMERALD_DARK, icon: Zap, desc: "Qualified opportunity" },
  { value: "Callback", label: "Callback", color: WARN, icon: Calendar, desc: "Schedule callback" },
  { value: "Not Interested", label: "Not Interested", color: ERROR_RED, icon: X, desc: "Not a fit" },
  { value: "NoAuthority", label: "Wrong Person", color: "#F59E0B", icon: AlertTriangle, desc: "Not the decision maker" },
] as const;

const SIGNAL_MAP: Record<string, { title: string; description: string }> = {
  "Decision Maker": { title: "Signal captured", description: "DM reached. Targeting will improve." },
  "Gatekeeper": { title: "Intel gathered", description: "Gatekeeper mapped. Machine is learning." },
  "No Answer": { title: "Noted", description: "Follow-up queued. Machine will try again." },
  "Qualified": { title: "Opportunity created", description: "High-value target moved to pipeline." },
  "Callback": { title: "Callback locked", description: "Machine will remind you at the right time." },
  "Not Interested": { title: "Signal absorbed", description: "Targeting recalibrated. Moving on." },
  "NoAuthority": { title: "Wrong person flagged", description: "Machine will find the right decision maker." },
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

  const [lastCallIds, setLastCallIds] = useState<Map<string, string>>(new Map());
  const [uploadedCallIds, setUploadedCallIds] = useState<Set<string>>(new Set());
  const [uploadingCallId, setUploadingCallId] = useState<string | null>(null);
  const [analyzingCallIds, setAnalyzingCallIds] = useState<Set<string>>(new Set());
  const [analysisResults, setAnalysisResults] = useState<Map<string, {
    transcription: string;
    analysis: string;
    problemDetected: string | null;
    proposedPatchType: string | null;
    confidence: string | null;
  }>>(new Map());
  const [showAnalysis, setShowAnalysis] = useState<string | null>(null);
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [smsBody, setSmsBody] = useState("");
  const [twilioCallActive, setTwilioCallActive] = useState(false);
  const [activeCallSid, setActiveCallSid] = useState<string | null>(null);
  const [coachingTranscript, setCoachingTranscript] = useState<{ text: string; timestamp: number }[]>([]);
  const [coachingAlerts, setCoachingAlerts] = useState<{ type: string; severity: string; message: string; suggestion: string; timestamp: number }[]>([]);
  const [coachingConnected, setCoachingConnected] = useState(false);
  const [showCoachingPanel, setShowCoachingPanel] = useState(false);
  const coachingRef = useRef<EventSource | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const { data: twilioStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/twilio/status"],
    enabled: !!token,
    staleTime: 60000,
  });

  const startCoachingSSE = useCallback((callSid: string) => {
    if (coachingRef.current) {
      coachingRef.current.close();
    }
    setCoachingTranscript([]);
    setCoachingAlerts([]);
    setCoachingConnected(false);
    setShowCoachingPanel(true);

    const es = new EventSource(`/api/twilio/coaching/${callSid}?token=${token}`);

    es.addEventListener("session_info", (e: MessageEvent) => {
      setCoachingConnected(true);
    });

    es.addEventListener("transcript", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setCoachingTranscript(prev => [...prev, { text: data.text, timestamp: data.timestamp }]);
      } catch {}
    });

    es.addEventListener("coaching_alert", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setCoachingAlerts(prev => [...prev, {
          type: data.type,
          severity: data.severity,
          message: data.message,
          suggestion: data.suggestion,
          timestamp: data.timestamp,
        }]);
      } catch {}
    });

    es.addEventListener("call_ended", () => {
      setTwilioCallActive(false);
      setActiveCallSid(null);
      setCoachingConnected(false);
      es.close();
      coachingRef.current = null;
    });

    es.onerror = () => {
      setCoachingConnected(false);
    };

    coachingRef.current = es;
  }, [token]);

  useEffect(() => {
    return () => {
      if (coachingRef.current) {
        coachingRef.current.close();
        coachingRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [coachingTranscript]);

  const twilioCallMutation = useMutation({
    mutationFn: async ({ to, companyName, contactName, talkingPoints }: { to: string; companyName?: string; contactName?: string; talkingPoints?: string[] }) => {
      const res = await apiRequest("POST", "/api/twilio/call", { to, companyName, contactName, talkingPoints });
      return res.json();
    },
    onSuccess: (data: any) => {
      setTwilioCallActive(true);
      if (data.sid) {
        setActiveCallSid(data.sid);
        setTimeout(() => startCoachingSSE(data.sid), 1000);
      }
      toast({
        title: "Call initiated with Live Coach",
        description: "Real-time coaching active. Transcript streaming.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Call failed", description: err.message, variant: "destructive" });
    },
  });

  const twilioSmsMutation = useMutation({
    mutationFn: async ({ to, body }: { to: string; body: string }) => {
      const res = await apiRequest("POST", "/api/twilio/sms", { to, body });
      return res.json();
    },
    onSuccess: () => {
      setShowSmsModal(false);
      setSmsBody("");
      toast({ title: "SMS sent successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "SMS failed", description: err.message, variant: "destructive" });
    },
  });

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
    mutationFn: async (data: { company_name: string; outcome: string; notes?: string; gatekeeper_name?: string }) => {
      const res = await apiRequest("POST", "/api/calls/log", data);
      return res.json();
    },
    onSuccess: (resData, vars) => {
      if (company) {
        setCompletedIds(prev => new Set(prev).add(company.id));
        if (resData?.call_id) {
          setLastCallIds(prev => new Map(prev).set(company.id, resData.call_id));
        }
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

  const handleRecordingUpload = useCallback(async (companyId: string, callId: string, file: File) => {
    setUploadingCallId(companyId);
    try {
      const formData = new FormData();
      formData.append("recording", file);
      const res = await fetch(`/api/calls/${callId}/recording`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      setUploadedCallIds(prev => new Set(prev).add(companyId));
      setAnalyzingCallIds(prev => new Set(prev).add(companyId));
      toast({ title: "Recording uploaded", description: `Analyzing transcription...`, duration: 3000 });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive", duration: 4000 });
    } finally {
      setUploadingCallId(null);
    }
  }, [token, toast]);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`/api/events?token=${token}`);
    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "CALL_ANALYSIS_COMPLETE" && data.payload) {
          const p = data.payload;
          const callId = p.callId;
          const companyEntry = [...lastCallIds.entries()].find(([, cid]) => cid === callId);
          if (companyEntry) {
            const companyId = companyEntry[0];
            setAnalyzingCallIds(prev => {
              const next = new Set(prev);
              next.delete(companyId);
              return next;
            });
            setAnalysisResults(prev => new Map(prev).set(companyId, {
              transcription: p.transcription || "",
              analysis: p.analysis || "",
              problemDetected: p.problemDetected || null,
              proposedPatchType: p.proposedPatchType || null,
              confidence: p.confidence || null,
            }));
            toast({
              title: p.problemDetected ? "Problem detected" : "Analysis complete",
              description: p.problemDetected || "Call transcribed and analyzed.",
              duration: 4000,
            });
          }
        }
      } catch {}
    };
    es.addEventListener("message", handler);
    return () => { es.close(); };
  }, [token, lastCallIds, toast]);

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
      if (e.key === "7") handleOutcome("NoAuthority");
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
                    <div className="space-y-2">
                      <a
                        href={`tel:${callPhone.replace(/\s/g, "")}`}
                        className="flex items-center gap-2 text-lg font-bold"
                        style={{ color: EMERALD }}
                        data-testid="link-call-phone"
                      >
                        <Phone className="w-5 h-5" /> {callPhone}
                      </a>
                      {twilioStatus?.connected && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const points: string[] = [];
                              if (company?.rank_reason) points.push(company.rank_reason);
                              if (company?.rank_evidence) points.push(company.rank_evidence);
                              if (company?.playbook_strategy_notes) points.push(company.playbook_strategy_notes);
                              twilioCallMutation.mutate({
                                to: callPhone,
                                companyName: company?.company_name,
                                contactName: company?.offer_dm_name,
                                talkingPoints: points,
                              });
                            }}
                            disabled={twilioCallMutation.isPending || twilioCallActive}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                            style={{ background: twilioCallActive ? ERROR_RED : EMERALD, color: "#FFF" }}
                            data-testid="button-twilio-call"
                          >
                            {twilioCallMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : twilioCallActive ? <Radio className="w-3.5 h-3.5 animate-pulse" /> : <PhoneCall className="w-3.5 h-3.5" />}
                            {twilioCallActive ? "Live Coach Active" : "Call via Twilio"}
                          </button>
                          <button
                            onClick={() => { setSmsBody(company?.playbook_followup || ""); setShowSmsModal(true); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                            style={{ background: "rgba(59,130,246,0.15)", color: BLUE }}
                            data-testid="button-twilio-sms"
                          >
                            <Send className="w-3.5 h-3.5" />
                            Send SMS
                          </button>
                        </div>
                      )}
                    </div>
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
                  {company.playbook_learning_version && (
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "rgba(16,185,129,0.06)", border: `1px solid ${EMERALD}30` }}
                      data-testid="card-learning-intel"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Brain className="w-4 h-4" style={{ color: EMERALD }} />
                        <p className="text-xs font-mono uppercase tracking-widest" style={{ color: EMERALD }}>Learning Active</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
                        <span>{company.playbook_learning_version}</span>
                        {company.playbook_confidence > 0 && (
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-bold"
                            style={{
                              background: `${EMERALD}20`,
                              color: EMERALD,
                            }}
                            data-testid="badge-confidence"
                          >
                            {company.playbook_confidence}% confidence
                          </span>
                        )}
                        {(() => {
                          try {
                            const patches = JSON.parse(company.playbook_applied_patches || "[]");
                            return patches.length > 0 ? (
                              <span>{patches.length} patches applied</span>
                            ) : null;
                          } catch { return null; }
                        })()}
                      </div>
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
                  {company.playbook_strategy_notes && (
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "rgba(16,185,129,0.06)", border: `1px solid ${EMERALD}30` }}
                      data-testid="card-learning-notes"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <Brain className="w-4 h-4" style={{ color: EMERALD }} />
                        <p className="text-xs font-mono uppercase tracking-widest" style={{ color: EMERALD }}>Machine Learning Notes</p>
                        {company.playbook_confidence > 0 && (
                          <span
                            className="ml-auto px-2 py-0.5 rounded-full text-xs font-bold"
                            style={{ background: `${EMERALD}20`, color: EMERALD }}
                            data-testid="badge-learning-confidence"
                          >
                            {company.playbook_confidence}%
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed mb-3" style={{ color: "#E2E8F0" }} data-testid="text-strategy-notes">
                        {company.playbook_strategy_notes}
                      </p>
                      {company.playbook_applied_patches && (() => {
                        try {
                          const patches = JSON.parse(company.playbook_applied_patches);
                          if (!Array.isArray(patches) || patches.length === 0) return null;
                          return (
                            <div className="space-y-1.5">
                              <p className="text-xs font-mono uppercase tracking-widest" style={{ color: MUTED }}>Applied Patches</p>
                              {patches.map((p: { type?: string; title?: string; priority?: string }, i: number) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-2 text-xs px-2 py-1 rounded-lg"
                                  style={{ background: "rgba(255,255,255,0.04)" }}
                                  data-testid={`patch-item-${i}`}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{
                                      background: p.priority === "High" ? ERROR_RED : p.priority === "Medium" ? WARN : MUTED,
                                    }}
                                  />
                                  <span style={{ color: "#E2E8F0" }}>{p.title || p.type}</span>
                                  <span style={{ color: MUTED }} className="ml-auto">{p.priority}</span>
                                </div>
                              ))}
                            </div>
                          );
                        } catch { return null; }
                      })()}
                      {company.playbook_learning_version && (
                        <p className="text-xs mt-2" style={{ color: MUTED }} data-testid="text-learning-version">
                          Version: {company.playbook_learning_version}
                        </p>
                      )}
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

          {company && isCompleted && lastCallIds.has(company.id) && (
            <div
              className="rounded-xl p-3 mt-2"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p className="text-xs font-mono uppercase tracking-widest mb-2" style={{ color: MUTED }}>
                <Mic className="w-3 h-3 inline mr-1" /> Recording
              </p>
              {uploadedCallIds.has(company.id) ? (
                <div data-testid="recording-uploaded">
                  <div className="flex items-center gap-2 py-2">
                    <CheckCircle2 className="w-4 h-4" style={{ color: EMERALD }} />
                    <span className="text-xs font-mono" style={{ color: EMERALD }}>Recording uploaded</span>
                  </div>
                  {analyzingCallIds.has(company.id) && (
                    <div className="flex items-center gap-2 py-1" data-testid="analysis-in-progress">
                      <Loader2 className="w-3 h-3 animate-spin" style={{ color: BLUE }} />
                      <span className="text-xs font-mono" style={{ color: MUTED }}>Transcribing + analyzing...</span>
                    </div>
                  )}
                  {analysisResults.has(company.id) && (
                    <div className="mt-2" data-testid="analysis-results">
                      {analysisResults.get(company.id)!.problemDetected ? (
                        <div
                          className="rounded-lg p-2 mb-2"
                          style={{ background: `${ERROR_RED}15`, border: `1px solid ${ERROR_RED}40` }}
                          data-testid="analysis-problem"
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <AlertTriangle className="w-3.5 h-3.5" style={{ color: ERROR_RED }} />
                            <span className="text-xs font-bold" style={{ color: ERROR_RED }}>Problem Detected</span>
                          </div>
                          <p className="text-xs font-mono" style={{ color: "#FFF" }}>
                            {analysisResults.get(company.id)!.problemDetected}
                          </p>
                          <p className="text-xs mt-1" style={{ color: MUTED }}>
                            Patch: {analysisResults.get(company.id)!.proposedPatchType} · Confidence: {analysisResults.get(company.id)!.confidence}
                          </p>
                        </div>
                      ) : (
                        <div
                          className="rounded-lg p-2 mb-2"
                          style={{ background: `${EMERALD}15`, border: `1px solid ${EMERALD}40` }}
                          data-testid="analysis-clean"
                        >
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                            <span className="text-xs font-bold" style={{ color: EMERALD }}>No containment issues</span>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => setShowAnalysis(showAnalysis === company.id ? null : company.id)}
                        className="text-xs font-mono underline"
                        style={{ color: BLUE }}
                        data-testid="button-toggle-analysis"
                      >
                        {showAnalysis === company.id ? "Hide details" : "View analysis"}
                      </button>
                      {showAnalysis === company.id && (
                        <div className="mt-2 space-y-2" data-testid="analysis-detail">
                          <div>
                            <p className="text-xs font-bold mb-1" style={{ color: MUTED }}>
                              <Brain className="w-3 h-3 inline mr-1" />Analysis
                            </p>
                            <p className="text-xs font-mono whitespace-pre-wrap" style={{ color: "#FFF" }}>
                              {analysisResults.get(company.id)!.analysis || "No analysis available"}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-bold mb-1" style={{ color: MUTED }}>
                              <FileText className="w-3 h-3 inline mr-1" />Transcription
                            </p>
                            <p className="text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto" style={{ color: "rgba(255,255,255,0.7)" }}>
                              {analysisResults.get(company.id)!.transcription || "No transcription available"}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : uploadingCallId === company.id ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: EMERALD }} />
                  <span className="text-xs font-mono" style={{ color: MUTED }}>Uploading...</span>
                </div>
              ) : (
                <label
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl cursor-pointer transition-all"
                  style={{ background: `${BLUE}15`, border: `1px solid ${BLUE}40`, color: "#FFF" }}
                  data-testid="button-upload-recording"
                >
                  <Upload className="w-4 h-4" style={{ color: BLUE }} />
                  <span className="text-sm font-semibold">Upload Recording</span>
                  <input
                    type="file"
                    accept=".mp3,.wav,.m4a,.ogg,.webm,.mp4,.aac,audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && company) {
                        handleRecordingUpload(company.id, lastCallIds.get(company.id)!, file);
                      }
                      e.target.value = "";
                    }}
                    data-testid="input-recording-file"
                  />
                </label>
              )}
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

      <AnimatePresence>
        {showSmsModal && callPhone && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setShowSmsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 w-96"
              style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)" }}
              data-testid="modal-sms"
            >
              <p className="text-sm font-bold mb-1" style={{ color: "#FFF" }}>Send SMS via Twilio</p>
              <p className="text-xs mb-3" style={{ color: MUTED }}>To: {callPhone}</p>
              <textarea
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                placeholder="Type your message..."
                rows={4}
                maxLength={1600}
                className="w-full px-3 py-2 rounded-lg text-sm mb-1 resize-none"
                style={{ background: "rgba(255,255,255,0.06)", color: "#FFF", border: "1px solid rgba(255,255,255,0.1)" }}
                data-testid="input-sms-body"
              />
              <p className="text-[10px] mb-3 text-right" style={{ color: MUTED }}>{smsBody.length}/1600</p>
              <div className="flex gap-2">
                <Button
                  onClick={() => { setShowSmsModal(false); setSmsBody(""); }}
                  className="flex-1 text-sm" style={{ background: "rgba(255,255,255,0.06)", color: MUTED }}
                  data-testid="button-sms-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => twilioSmsMutation.mutate({ to: callPhone, body: smsBody })}
                  disabled={!smsBody.trim() || twilioSmsMutation.isPending}
                  className="flex-1 text-sm font-bold" style={{ background: BLUE, color: "#FFF" }}
                  data-testid="button-sms-send"
                >
                  {twilioSmsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Send className="w-4 h-4 mr-1.5" />}
                  Send
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCoachingPanel && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 bottom-0 z-40 flex flex-col"
            style={{
              width: "380px",
              background: "#0B1120",
              borderLeft: `2px solid ${coachingConnected ? EMERALD : "rgba(255,255,255,0.1)"}`,
              boxShadow: "-8px 0 32px rgba(0,0,0,0.5)",
            }}
            data-testid="coaching-panel"
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: coachingConnected ? EMERALD : ERROR_RED,
                    boxShadow: coachingConnected ? `0 0 8px ${EMERALD}80` : `0 0 8px ${ERROR_RED}80`,
                    animation: coachingConnected ? "pulse 2s infinite" : "none",
                  }}
                  data-testid="coaching-status-indicator"
                />
                <span className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: coachingConnected ? EMERALD : ERROR_RED }}>
                  {coachingConnected ? "Live Coach" : twilioCallActive ? "Connecting..." : "Session Ended"}
                </span>
              </div>
              <button
                onClick={() => setShowCoachingPanel(false)}
                className="p-1 rounded-lg transition-colors"
                style={{ color: MUTED }}
                data-testid="button-close-coaching"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {company?.rank_reason && (
              <div
                className="px-4 py-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(16,185,129,0.04)" }}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <Target className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest" style={{ color: EMERALD }}>
                    Talking Points
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "#94A3B8" }} data-testid="coaching-talking-points">
                  {company.rank_reason}
                </p>
                {company.playbook_strategy_notes && (
                  <p className="text-xs leading-relaxed mt-1.5" style={{ color: "#64748B" }}>
                    {company.playbook_strategy_notes}
                  </p>
                )}
              </div>
            )}

            <div className="flex-1 overflow-hidden flex flex-col">
              <AnimatePresence>
                {coachingAlerts.length > 0 && (
                  <motion.div
                    className="px-4 py-2 space-y-2 max-h-48 overflow-y-auto"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    {coachingAlerts.slice(-5).map((alert, i) => {
                      const alertColors = {
                        red: { bg: `${ERROR_RED}12`, border: `${ERROR_RED}40`, icon: ERROR_RED },
                        amber: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.4)", icon: WARN },
                        blue: { bg: `${BLUE}12`, border: `${BLUE}40`, icon: BLUE },
                      };
                      const colors = alertColors[alert.severity as keyof typeof alertColors] || alertColors.amber;
                      const AlertIcon = alert.type === "containment" ? Shield :
                                       alert.type === "authority" || alert.type === "no_authority" ? User : Clock;
                      return (
                        <motion.div
                          key={`alert-${alert.timestamp}-${i}`}
                          initial={{ opacity: 0, y: -10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="rounded-lg p-2.5"
                          style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
                          data-testid={`coaching-alert-${alert.type}-${i}`}
                        >
                          <div className="flex items-start gap-2">
                            <AlertIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: colors.icon }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold" style={{ color: "#FFF" }}>{alert.message}</p>
                              <p className="text-[11px] leading-snug mt-1" style={{ color: "#94A3B8" }}>{alert.suggestion}</p>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex-1 overflow-y-auto px-4 py-3" data-testid="coaching-transcript-area">
                <div className="flex items-center gap-1.5 mb-3">
                  <Volume2 className="w-3.5 h-3.5" style={{ color: MUTED }} />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest" style={{ color: MUTED }}>
                    Live Transcript
                  </span>
                  {coachingTranscript.length > 0 && (
                    <span className="text-[10px] font-mono ml-auto" style={{ color: "rgba(255,255,255,0.2)" }}>
                      {coachingTranscript.length} segments
                    </span>
                  )}
                </div>

                {coachingTranscript.length === 0 && coachingConnected && (
                  <div className="flex items-center gap-2 py-6 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" style={{ color: MUTED }} />
                    <span className="text-xs font-mono" style={{ color: MUTED }}>Waiting for speech...</span>
                  </div>
                )}

                {coachingTranscript.length === 0 && !coachingConnected && !twilioCallActive && (
                  <div className="flex items-center gap-2 py-6 justify-center">
                    <span className="text-xs font-mono" style={{ color: MUTED }}>
                      {coachingAlerts.length > 0 ? "Call ended. Transcript processed." : "No transcript yet."}
                    </span>
                  </div>
                )}

                <div className="space-y-2">
                  {coachingTranscript.map((chunk, i) => (
                    <motion.div
                      key={`t-${i}`}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className="text-xs leading-relaxed"
                      style={{ color: "rgba(255,255,255,0.75)" }}
                      data-testid={`transcript-chunk-${i}`}
                    >
                      <span className="font-mono text-[10px] mr-2" style={{ color: "rgba(255,255,255,0.2)" }}>
                        {new Date(chunk.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      {chunk.text}
                    </motion.div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              </div>
            </div>

            <div
              className="px-4 py-2 flex items-center justify-between"
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)" }}
            >
              <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
                {coachingAlerts.length} alert{coachingAlerts.length !== 1 ? "s" : ""} · {coachingTranscript.length} segments
              </span>
              <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>
                Phase 1 · Pattern Detection
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
