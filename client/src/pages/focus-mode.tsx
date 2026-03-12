import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, ArrowRight, Phone, PhoneCall, Mail, Linkedin,
  User, Check, Copy, Loader2, X, Calendar, MapPin,
  Building2, Clock, Play, Target, Zap, Shield,
  MessageSquare, ChevronDown, ChevronUp, SkipForward, Trophy,
  AlertCircle, ExternalLink, PhoneOff, Radio, Mic,
  Brain, ChevronRight, FileText, Activity
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";
const ERROR = "#EF4444";
const PURPLE = "#8B5CF6";

const FLOW_CONFIG: Record<string, { label: string; color: string; icon: any; bgLight: string }> = {
  gatekeeper: { label: "Gatekeeper Discovery", color: AMBER, icon: Phone, bgLight: "rgba(245,158,11,0.08)" },
  dm_call: { label: "DM Direct Call", color: EMERALD, icon: PhoneCall, bgLight: "rgba(16,185,129,0.08)" },
  email: { label: "Email Outreach", color: BLUE, icon: Mail, bgLight: "rgba(59,130,246,0.08)" },
  linkedin: { label: "LinkedIn", color: "#0A66C2", icon: Linkedin, bgLight: "rgba(10,102,194,0.08)" },
  nurture: { label: "Long-Term Nurture", color: PURPLE, icon: Calendar, bgLight: "rgba(139,92,246,0.08)" },
};

const NOT_A_FIT_REASONS = [
  { value: "residential", label: "Residential" },
  { value: "supplier_distributor", label: "Supplier / Distributor" },
  { value: "wrong_service", label: "Wrong Service Type" },
  { value: "too_small", label: "Too Small" },
  { value: "out_of_area", label: "Out of Area" },
  { value: "other", label: "Other" },
];

const GK_OUTCOMES = [
  { value: "no_answer", label: "No Answer", icon: Phone, color: MUTED },
  { value: "general_voicemail", label: "General Voicemail", icon: MessageSquare, color: MUTED },
  { value: "receptionist_answered", label: "Receptionist Answered", icon: User, color: BLUE },
  { value: "gave_dm_name", label: "Gave DM Name", icon: User, color: EMERALD },
  { value: "gave_title_only", label: "Gave Title Only", icon: User, color: AMBER },
  { value: "gave_direct_extension", label: "Gave Extension", icon: Phone, color: EMERALD },
  { value: "gave_email", label: "Gave Email", icon: Mail, color: EMERALD },
  { value: "transferred", label: "Transferred", icon: PhoneCall, color: EMERALD },
  { value: "refused", label: "Refused", icon: X, color: ERROR },
  { value: "asked_to_send_info", label: "Send Info", icon: Mail, color: BLUE },
  { value: "message_taken", label: "Message Taken", icon: MessageSquare, color: AMBER },
  { value: "not_a_fit", label: "Not a Fit", icon: Shield, color: ERROR },
];

const DM_OUTCOMES = [
  { value: "no_answer", label: "No Answer", icon: Phone, color: MUTED },
  { value: "voicemail_left", label: "Voicemail Left", icon: MessageSquare, color: MUTED },
  { value: "live_answer", label: "Live Answer", icon: PhoneCall, color: EMERALD },
  { value: "asked_to_call_later", label: "Call Later", icon: Clock, color: AMBER },
  { value: "wrong_person", label: "Wrong Person", icon: X, color: ERROR },
  { value: "referred_elsewhere", label: "Referred", icon: ArrowRight, color: AMBER },
  { value: "not_relevant", label: "Not Relevant", icon: X, color: ERROR },
  { value: "not_a_fit", label: "Not a Fit", icon: Shield, color: ERROR },
  { value: "interested", label: "Interested", icon: Zap, color: EMERALD },
  { value: "meeting_requested", label: "Meeting", icon: Calendar, color: EMERALD },
  { value: "followup_scheduled", label: "Follow-up Set", icon: Calendar, color: BLUE },
];

const EMAIL_OUTCOMES = [
  { value: "sent", label: "Sent", icon: Mail, color: BLUE },
  { value: "opened", label: "Opened", icon: Mail, color: AMBER },
  { value: "clicked", label: "Clicked", icon: ExternalLink, color: EMERALD },
  { value: "replied", label: "Replied", icon: MessageSquare, color: EMERALD },
  { value: "bounced", label: "Bounced", icon: X, color: ERROR },
  { value: "not_relevant", label: "Not Relevant", icon: X, color: ERROR },
  { value: "interested", label: "Interested", icon: Zap, color: EMERALD },
  { value: "followup_needed", label: "Follow-up Needed", icon: Clock, color: AMBER },
];

const LINKEDIN_OUTCOMES = [
  { value: "profile_not_found", label: "Not Found", icon: X, color: MUTED },
  { value: "profile_found", label: "Found", icon: User, color: BLUE },
  { value: "viewed", label: "Viewed", icon: User, color: BLUE },
  { value: "connection_requested", label: "Requested", icon: Linkedin, color: BLUE },
  { value: "connected", label: "Connected", icon: Check, color: EMERALD },
  { value: "message_sent", label: "Messaged", icon: MessageSquare, color: BLUE },
  { value: "responded", label: "Responded", icon: Zap, color: EMERALD },
  { value: "no_response", label: "No Response", icon: Clock, color: MUTED },
  { value: "followup_sent", label: "Follow-up Sent", icon: Mail, color: AMBER },
];

const NURTURE_OUTCOMES = [
  { value: "check_in_sent", label: "Check-in Sent", icon: MessageSquare, color: BLUE },
  { value: "no_response", label: "No Response", icon: Clock, color: MUTED },
  { value: "responded", label: "Responded", icon: Zap, color: EMERALD },
  { value: "reactivated", label: "Reactivated", icon: Play, color: EMERALD },
  { value: "closed_lost", label: "Closed Lost", icon: X, color: ERROR },
];

function getOutcomesForFlow(flowType: string) {
  switch (flowType) {
    case "gatekeeper": return GK_OUTCOMES;
    case "dm_call": return DM_OUTCOMES;
    case "email": return EMAIL_OUTCOMES;
    case "linkedin": return LINKEDIN_OUTCOMES;
    case "nurture": return NURTURE_OUTCOMES;
    default: return GK_OUTCOMES;
  }
}

interface ActionItem {
  id: number;
  companyId: string;
  companyName: string;
  contactId: string | null;
  contactName: string | null;
  flowId: number | null;
  flowType: string;
  taskType: string;
  dueAt: string;
  priority: number;
  status: string;
  recommendationText: string | null;
  lastOutcome: string | null;
  attemptNumber: number;
  companyPhone: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  companyCity: string | null;
  companyCategory: string | null;
  bucket: string | null;
}

interface TodayCompany {
  id: string;
  company_name: string;
  phone: string;
  bucket: string;
  times_called: number;
  last_outcome: string;
  offer_dm_name: string;
  offer_dm_title: string;
  offer_dm_phone: string;
  offer_dm_email: string;
  playbook_opener: string;
  playbook_gatekeeper: string;
  playbook_voicemail: string;
  playbook_followup: string;
  website: string;
  city: string;
  gatekeeper_name: string;
  playbook_strategy_notes: string;
  category: string;
}

interface SessionLog {
  companyName: string;
  flowType: string;
  outcome: string;
  timestamp: number;
}

type CallState = "idle" | "dialing" | "ringing" | "in-progress" | "completed" | "failed" | "no-answer" | "busy" | "canceled";

interface CoachingAlert {
  type: string;
  severity: string;
  message: string;
  suggestion: string;
  timestamp: number;
}

function CopyButton({ text, label, id }: { text: string; label: string; id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors"
      style={{ background: copied ? `${EMERALD}15` : SUBTLE, color: copied ? EMERALD : MUTED, border: `1px solid ${copied ? `${EMERALD}30` : BORDER}` }}
      data-testid={`copy-${id}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function CallTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return (
    <span className="font-mono text-sm font-semibold" data-testid="text-call-timer">
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </span>
  );
}

function LiveCoachPanel({ callSid, token }: { callSid: string; token: string }) {
  const [transcript, setTranscript] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<CoachingAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!callSid || !token) return;

    const url = `/api/twilio/coaching/${callSid}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.addEventListener("transcript", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.text) {
          setTranscript(prev => [...prev.slice(-100), data.text]);
        }
      } catch {}
    });

    es.addEventListener("coaching_alert", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setAlerts(prev => [...prev.slice(-20), data]);
      } catch {}
    });

    es.addEventListener("call_ended", () => {
      setConnected(false);
      es.close();
    });

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [callSid, token]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const latestAlert = alerts.length > 0 ? alerts[alerts.length - 1] : null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: "white" }} data-testid="panel-live-coach">
      <div className="px-4 py-2 flex items-center justify-between" style={{ background: connected ? `${EMERALD}08` : `${MUTED}08`, borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5" style={{ color: connected ? EMERALD : MUTED }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: connected ? EMERALD : MUTED }}>
            Live Coach {connected ? "Connected" : "Connecting..."}
          </span>
        </div>
        {connected && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: EMERALD }} />
            <span className="text-[10px]" style={{ color: MUTED }}>Live</span>
          </div>
        )}
      </div>

      {latestAlert && (
        <div className="px-4 py-2" style={{
          background: latestAlert.severity === "red" ? `${ERROR}08` : latestAlert.severity === "amber" ? `${AMBER}08` : `${BLUE}08`,
          borderBottom: `1px solid ${BORDER}`
        }}>
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{
              color: latestAlert.severity === "red" ? ERROR : latestAlert.severity === "amber" ? AMBER : BLUE
            }} />
            <div>
              <div className="text-xs font-semibold" style={{
                color: latestAlert.severity === "red" ? ERROR : latestAlert.severity === "amber" ? AMBER : BLUE
              }}>
                {latestAlert.message}
              </div>
              <div className="text-xs mt-0.5" style={{ color: TEXT }}>
                {latestAlert.suggestion}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 py-2 max-h-32 overflow-y-auto" style={{ background: SUBTLE }}>
        {transcript.length === 0 ? (
          <div className="text-xs italic py-2" style={{ color: MUTED }}>
            Waiting for conversation...
          </div>
        ) : (
          <div className="space-y-1">
            {transcript.slice(-10).map((line, i) => (
              <div key={i} className="text-xs" style={{ color: TEXT }}>{line}</div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}


interface ExplanationProps {
  data: {
    outcomeLabel: string;
    systemAction: string;
    whyChosen: string;
    stateChanges: string[];
    flowLabel: string;
    nextAction: string;
    nextDueAt: string;
    companyName: string;
    companyId: string;
    callSid: string | null;
    callDurationSec: number | null;
  };
  onContinue: () => void;
  onViewCompany: () => void;
}

function ExplanationScreen({ data, onContinue, onViewCompany }: ExplanationProps) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showDecisionDetail, setShowDecisionDetail] = useState(false);

  const { data: recording } = useQuery<any>({
    queryKey: [`/api/twilio/recording-by-callsid/${data.callSid}`],
    enabled: !!data.callSid,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 5000;
      if (d.processedAt) return false;
      if (d.status === "error" || d.status === "download_failed") return false;
      return 5000;
    },
  });

  const dueDateStr = data.nextDueAt
    ? new Date(data.nextDueAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "Pending";

  const callDurStr = data.callDurationSec != null
    ? `${Math.floor(data.callDurationSec / 60)}:${String(data.callDurationSec % 60).padStart(2, "0")}`
    : recording?.duration
      ? `${Math.floor(recording.duration / 60)}:${String(recording.duration % 60).padStart(2, "0")}`
      : null;

  const hasRecording = !!data.callSid;
  const isProcessing = hasRecording && recording && !recording.processedAt && recording.status !== "error" && recording.status !== "download_failed";
  const hasFailed = hasRecording && recording && (recording.status === "error" || recording.status === "download_failed");
  const hasTranscript = recording?.transcription && recording.transcription.length > 0;
  const hasAnalysis = recording?.analysis && recording.analysis.length > 0;

  return (
    <div className="min-h-screen" style={{ background: "#F8FAFC" }}>
      <div className="sticky top-0 z-50 bg-white" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4" style={{ color: EMERALD }} />
            <span className="text-sm font-semibold" style={{ color: TEXT }}>Call Summary</span>
          </div>
          <span className="text-xs font-medium" style={{ color: TEXT }}>{data.companyName}</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <div className="rounded-xl p-4" style={{ background: "white", border: `1px solid ${BORDER}` }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${EMERALD}15` }}>
                  <Check className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                </div>
                <div>
                  <div className="text-base font-bold" style={{ color: TEXT }} data-testid="text-outcome-recorded">
                    {data.outcomeLabel}
                  </div>
                  <div className="text-[11px]" style={{ color: MUTED }}>{data.flowLabel}</div>
                </div>
              </div>
              {callDurStr && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}15` }}>
                  <Phone className="w-3 h-3" style={{ color: BLUE }} />
                  <span className="text-xs font-semibold" style={{ color: BLUE }}>{callDurStr}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg p-2.5" style={{ background: `${BLUE}05`, border: `1px solid ${BLUE}10` }}>
                <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: BLUE }}>System Action</div>
                <div className="text-xs font-medium" style={{ color: TEXT }} data-testid="text-system-action">{data.systemAction}</div>
              </div>
              <div className="rounded-lg p-2.5" style={{ background: `${EMERALD}05`, border: `1px solid ${EMERALD}10` }}>
                <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: EMERALD }}>Next Action</div>
                <div className="text-xs font-medium" style={{ color: TEXT }} data-testid="text-next-action">{data.nextAction}</div>
                <div className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: MUTED }}>
                  <Clock className="w-2.5 h-2.5" />
                  {dueDateStr}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {hasRecording && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}>
            <div className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: `${PURPLE}15` }}>
                    <Mic className="w-3 h-3" style={{ color: PURPLE }} />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Call Recording</span>
                  {isProcessing && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${AMBER}10`, color: AMBER }}>
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      Processing
                    </span>
                  )}
                  {recording?.processedAt && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${EMERALD}10`, color: EMERALD }}>
                      Analyzed
                    </span>
                  )}
                </div>

                {recording?.problemDetected && (
                  <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg" style={{ background: `${ERROR}06`, border: `1px solid ${ERROR}15` }}>
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: ERROR }} />
                    <span className="text-xs font-medium" style={{ color: ERROR }}>{recording.problemDetected}</span>
                  </div>
                )}

                {recording?.noAuthority && (
                  <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg" style={{ background: `${AMBER}06`, border: `1px solid ${AMBER}15` }}>
                    <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: AMBER }} />
                    <span className="text-xs font-medium" style={{ color: AMBER }}>
                      No Authority{recording.authorityReason ? ` - ${recording.authorityReason}` : ""}
                    </span>
                  </div>
                )}

                {recording?.suggestedRole && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${PURPLE}10`, color: PURPLE }}>
                      Suggested Role: {recording.suggestedRole}
                    </span>
                    {recording?.followupDate && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${EMERALD}10`, color: EMERALD }}>
                        Follow-up: {new Date(recording.followupDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )}

                {hasAnalysis && (
                  <div className="mb-2">
                    <button
                      onClick={() => setShowAnalysis(!showAnalysis)}
                      className="w-full flex items-center justify-between py-1.5 text-left"
                      data-testid="toggle-analysis"
                    >
                      <div className="flex items-center gap-1.5">
                        <Brain className="w-3 h-3" style={{ color: BLUE }} />
                        <span className="text-xs font-semibold" style={{ color: BLUE }}>AI Analysis</span>
                      </div>
                      {showAnalysis ? <ChevronUp className="w-3.5 h-3.5" style={{ color: MUTED }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: MUTED }} />}
                    </button>
                    {showAnalysis && (
                      <div className="text-xs leading-relaxed mt-1 p-2.5 rounded-lg" style={{ color: TEXT, background: `${BLUE}04` }}>
                        {recording.analysis}
                      </div>
                    )}
                  </div>
                )}

                {hasTranscript && (
                  <div>
                    <button
                      onClick={() => setShowTranscript(!showTranscript)}
                      className="w-full flex items-center justify-between py-1.5 text-left"
                      data-testid="toggle-transcript"
                    >
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3 h-3" style={{ color: MUTED }} />
                        <span className="text-xs font-semibold" style={{ color: TEXT }}>Transcript</span>
                      </div>
                      {showTranscript ? <ChevronUp className="w-3.5 h-3.5" style={{ color: MUTED }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: MUTED }} />}
                    </button>
                    {showTranscript && (
                      <div className="text-xs leading-relaxed mt-1 p-2.5 rounded-lg max-h-48 overflow-y-auto" style={{ color: TEXT, background: SUBTLE, whiteSpace: "pre-wrap" }}>
                        {recording.transcription}
                      </div>
                    )}
                  </div>
                )}

                {isProcessing && !hasAnalysis && !hasTranscript && (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: MUTED }} />
                    <span className="text-xs" style={{ color: MUTED }}>Recording is being transcribed and analyzed...</span>
                  </div>
                )}

                {hasFailed && !hasAnalysis && !hasTranscript && (
                  <div className="flex items-center gap-2 py-2">
                    <AlertCircle className="w-3.5 h-3.5" style={{ color: ERROR }} />
                    <span className="text-xs" style={{ color: ERROR }}>Recording processing failed. Check company detail for updates.</span>
                  </div>
                )}

                {hasRecording && !recording && (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: MUTED }} />
                    <span className="text-xs" style={{ color: MUTED }}>Waiting for recording...</span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: hasRecording ? 0.3 : 0.15 }}>
          <button
            onClick={() => setShowDecisionDetail(!showDecisionDetail)}
            className="w-full rounded-xl p-3 flex items-center justify-between text-left"
            style={{ background: "white", border: `1px solid ${BORDER}` }}
            data-testid="toggle-decision-detail"
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: `${AMBER}15` }}>
                <Brain className="w-2.5 h-2.5" style={{ color: AMBER }} />
              </div>
              <span className="text-xs font-semibold" style={{ color: TEXT }}>Machine Decision Details</span>
            </div>
            {showDecisionDetail ? <ChevronUp className="w-4 h-4" style={{ color: MUTED }} /> : <ChevronDown className="w-4 h-4" style={{ color: MUTED }} />}
          </button>
          {showDecisionDetail && (
            <div className="mt-1 rounded-xl p-4 space-y-3" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: AMBER }}>Why This Action Was Chosen</div>
                <div className="text-xs" style={{ color: TEXT }} data-testid="text-why-chosen">{data.whyChosen}</div>
              </div>
              {data.stateChanges.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: PURPLE }}>State Changes</div>
                  <div className="space-y-1">
                    {data.stateChanges.map((change, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs" style={{ color: TEXT }}>
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: EMERALD }} />
                        {change}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: hasRecording ? 0.4 : 0.25 }}
          className="flex gap-2 pt-1"
        >
          <Button
            onClick={onContinue}
            className="flex-1 h-10 text-sm font-semibold"
            style={{ background: EMERALD, color: "white" }}
            data-testid="button-continue-next"
          >
            Continue to Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
          <Button
            variant="outline"
            onClick={onViewCompany}
            className="h-10 text-sm font-semibold"
            style={{ borderColor: BORDER, color: BLUE }}
            data-testid="button-open-detail"
          >
            Company Detail
          </Button>
        </motion.div>
      </div>
    </div>
  );
}


export default function FocusModePage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const [, navigate] = useLocation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionLog, setSessionLog] = useState<SessionLog[]>([]);
  const [capturedInfo, setCapturedInfo] = useState("");
  const [notes, setNotes] = useState("");
  const [showScripts, setShowScripts] = useState(false);
  const [loggingOutcome, setLoggingOutcome] = useState<string | null>(null);

  const [callState, setCallState] = useState<CallState>("idle");
  const [callSid, setCallSid] = useState<string | null>(null);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [callDuration, setCallDuration] = useState<number | null>(null);
  const [twilioReady, setTwilioReady] = useState<boolean | null>(null);
  const [sseConnected, setSSEConnected] = useState(false);
  const callPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callSSERef = useRef<EventSource | null>(null);

  useEffect(() => {
    apiRequest("GET", "/api/twilio/status")
      .then(r => r.json())
      .then(d => setTwilioReady(d.connected === true))
      .catch(() => setTwilioReady(false));
  }, []);

  useEffect(() => {
    return () => {
      if (callPollRef.current) clearInterval(callPollRef.current);
      if (callSSERef.current) { callSSERef.current.close(); callSSERef.current = null; }
    };
  }, []);

  const { data: actions = [], isLoading } = useQuery<ActionItem[]>({
    queryKey: ["/api/flows/action-queue"],
  });

  const { data: todayResponse } = useQuery<{ companies: TodayCompany[]; count: number }>({
    queryKey: ["/api/today-list"],
  });
  const todayList = todayResponse?.companies || [];

  const todayMap = useMemo(() => {
    const map: Record<string, TodayCompany> = {};
    const list = Array.isArray(todayList) ? todayList : [];
    list.forEach(c => { map[c.id] = c; });
    return map;
  }, [todayList]);

  const safeIndex = Math.min(currentIndex, Math.max(actions.length - 1, 0));
  const currentAction = actions[safeIndex];
  const currentCompany = currentAction ? todayMap[currentAction.companyId] : null;
  const totalActions = actions.length;
  const totalDone = sessionLog.length;
  const totalRemaining = totalActions;
  const progress = totalDone + totalRemaining > 0 ? (totalDone / (totalDone + totalRemaining)) * 100 : 0;
  const isSessionComplete = totalActions === 0 && totalDone > 0;

  const submitLockRef = useRef(false);
  const pollFailCountRef = useRef(0);

  const handleCallStatusUpdate = useCallback((status: string, duration?: string | null) => {
    if (status === "ringing" || status === "queued" || status === "dialing") {
      setCallState(status === "dialing" ? "dialing" : "ringing");
    } else if (status === "in-progress" || status === "answered") {
      setCallState(prev => {
        if (prev !== "in-progress") setCallStartTime(Date.now());
        return "in-progress";
      });
    } else if (["completed", "canceled", "failed", "no-answer", "busy"].includes(status)) {
      setCallState(status as CallState);
      if (duration) setCallDuration(parseInt(duration, 10));
      if (callPollRef.current) { clearInterval(callPollRef.current); callPollRef.current = null; }
      if (callSSERef.current) { callSSERef.current.close(); callSSERef.current = null; }
    }
  }, []);

  const startCallPoll = useCallback((sid: string) => {
    if (callPollRef.current) clearInterval(callPollRef.current);
    pollFailCountRef.current = 0;
    const token = getToken();
    callPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/twilio/call-session/${sid}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          pollFailCountRef.current++;
          if (pollFailCountRef.current >= 10) {
            setCallState("completed");
            if (callPollRef.current) { clearInterval(callPollRef.current); callPollRef.current = null; }
          }
          return;
        }
        pollFailCountRef.current = 0;
        const data = await res.json();
        handleCallStatusUpdate(data.status, data.duration);
      } catch {
        pollFailCountRef.current++;
        if (pollFailCountRef.current >= 10) {
          setCallState("completed");
          if (callPollRef.current) { clearInterval(callPollRef.current); callPollRef.current = null; }
        }
      }
    }, 5000);
  }, [getToken, handleCallStatusUpdate]);

  const startCallStatusSSE = useCallback((sid: string) => {
    if (callSSERef.current) { callSSERef.current.close(); callSSERef.current = null; }
    const token = getToken();
    if (!token) return;

    const url = `/api/twilio/call-status-stream/${sid}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    callSSERef.current = es;

    es.addEventListener("connected", () => {
      setSSEConnected(true);
    });

    es.addEventListener("call_status", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (callPollRef.current) { clearInterval(callPollRef.current); callPollRef.current = null; }
        handleCallStatusUpdate(data.status, data.duration);
      } catch {}
    });

    es.onerror = () => {
      setSSEConnected(false);
      es.close();
      callSSERef.current = null;
      startCallPoll(sid);
    };
  }, [getToken, handleCallStatusUpdate, startCallPoll]);

  const callActionIdRef = useRef<number | null>(null);

  const initiateCallMutation = useMutation({
    mutationFn: async (params: {
      to: string;
      companyName: string;
      contactName?: string;
      flowId?: number;
      companyId?: string;
      contactId?: string;
      flowType?: string;
      taskId?: number;
      talkingPoints?: string[];
      _actionId?: number;
    }) => {
      callActionIdRef.current = params._actionId || null;
      const { _actionId, ...callParams } = params;
      const res = await apiRequest("POST", "/api/twilio/call", callParams);
      return await res.json();
    },
    onSuccess: (data) => {
      if (callActionIdRef.current !== currentAction?.id) return;
      if (data.ok && data.sid) {
        setCallSid(data.sid);
        setCallState("dialing");
        setCallStartTime(null);
        setCallDuration(null);
        setSSEConnected(false);
        startCallStatusSSE(data.sid);
        setTimeout(() => {
          if (!callSSERef.current || callSSERef.current.readyState !== EventSource.OPEN) {
            startCallPoll(data.sid);
          }
        }, 3000);
        toast({ title: "Call initiated", description: "Dialing agent phone..." });
      } else {
        setCallState("failed");
        toast({ title: "Call failed", description: data.error || "Could not initiate call", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      if (callActionIdRef.current !== currentAction?.id) return;
      setCallState("failed");
      toast({ title: "Call failed", description: err.message || "Network error", variant: "destructive" });
    },
  });

  const handleInitiateCall = () => {
    if (!currentAction) return;
    const phone = currentAction.contactPhone || currentAction.companyPhone || currentCompany?.phone;
    if (!phone) {
      toast({ title: "No phone number", description: "No phone number available for this contact", variant: "destructive" });
      return;
    }

    const talkingPoints: string[] = [];
    if (currentCompany?.playbook_opener) talkingPoints.push(currentCompany.playbook_opener);
    if (currentCompany?.playbook_gatekeeper) talkingPoints.push(currentCompany.playbook_gatekeeper);
    if (currentCompany?.playbook_strategy_notes) talkingPoints.push(currentCompany.playbook_strategy_notes);

    initiateCallMutation.mutate({
      to: phone,
      companyName: currentAction.companyName,
      contactName: currentAction.contactName || undefined,
      flowId: currentAction.flowId || undefined,
      companyId: currentAction.companyId,
      contactId: currentAction.contactId || undefined,
      flowType: currentAction.flowType,
      taskId: currentAction.id,
      talkingPoints,
      _actionId: currentAction.id,
    });
  };

  const resetCallState = () => {
    if (callPollRef.current) {
      clearInterval(callPollRef.current);
      callPollRef.current = null;
    }
    if (callSSERef.current) {
      callSSERef.current.close();
      callSSERef.current = null;
    }
    setCallState("idle");
    setCallSid(null);
    setCallStartTime(null);
    setCallDuration(null);
    setSSEConnected(false);
  };

  const logMutation = useMutation({
    mutationFn: async (params: { flowId: number; companyId: string; companyName: string; contactId?: string; contactName?: string; channel: string; outcome: string; notes?: string; capturedInfo?: string }) => {
      const res = await apiRequest("POST", "/api/flows/log-attempt", params);
      return await res.json();
    },
    onSuccess: (data: any, vars) => {
      setSessionLog(prev => [...prev, {
        companyName: vars.companyName,
        flowType: currentAction?.flowType || "",
        outcome: vars.outcome,
        timestamp: Date.now(),
      }]);

      setCapturedInfo("");
      setNotes("");
      setLoggingOutcome(null);
      setSelectedOutcome(null);
      setShowScripts(false);
      resetCallState();

      if (data.explanation) {
        const savedCallSid = callSid;
        const savedDuration = callDuration;
        setExplanationData({
          outcomeLabel: data.explanation.outcomeLabel,
          systemAction: data.explanation.systemAction,
          whyChosen: data.explanation.whyChosen,
          stateChanges: data.explanation.stateChanges || [],
          flowLabel: data.explanation.flowLabel,
          nextAction: data.nextAction,
          nextDueAt: data.nextDueAt,
          companyName: vars.companyName,
          companyId: vars.companyId,
          callSid: savedCallSid,
          callDurationSec: savedDuration,
        });
      }

      submitLockRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/flows/action-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flows/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flows/kpi"] });
    },
    onError: () => {
      submitLockRef.current = false;
      toast({ title: "Error", description: "Failed to log outcome", variant: "destructive" });
      setLoggingOutcome(null);
    },
  });

  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [explanationData, setExplanationData] = useState<{
    outcomeLabel: string;
    systemAction: string;
    whyChosen: string;
    stateChanges: string[];
    flowLabel: string;
    nextAction: string;
    nextDueAt: string;
    companyName: string;
    companyId: string;
    callSid: string | null;
    callDurationSec: number | null;
  } | null>(null);

  const GK_CAPTURE_OUTCOMES = ["gave_dm_name", "gave_title_only", "gave_direct_extension", "gave_email"];
  const needsCaptureForOutcome = (outcome: string) =>
    currentAction?.flowType === "gatekeeper" && GK_CAPTURE_OUTCOMES.includes(outcome);

  const submitOutcome = (outcome: string, capturedOverride?: string) => {
    if (!currentAction || !currentAction.flowId) return;
    if (logMutation.isPending || submitLockRef.current) return;
    submitLockRef.current = true;
    setLoggingOutcome(outcome);

    const channel = currentAction.flowType === "email" ? "email" :
                    currentAction.flowType === "linkedin" ? "linkedin" : "phone";

    logMutation.mutate({
      flowId: currentAction.flowId,
      companyId: currentAction.companyId,
      companyName: currentAction.companyName,
      contactId: currentAction.contactId || undefined,
      contactName: currentAction.contactName || undefined,
      channel,
      outcome,
      notes: notes || undefined,
      capturedInfo: capturedOverride || capturedInfo || undefined,
    });
  };

  const [dqReason, setDqReason] = useState<string | null>(null);

  const handleOutcome = (outcome: string) => {
    if (outcome === "not_a_fit") {
      setSelectedOutcome("not_a_fit");
      return;
    }
    if (needsCaptureForOutcome(outcome)) {
      setSelectedOutcome(outcome);
    } else {
      submitOutcome(outcome);
    }
  };

  const handleDqReasonSelect = (reason: string) => {
    setDqReason(reason);
    submitOutcome("not_a_fit", `not_a_fit:${reason}`);
    setSelectedOutcome(null);
  };

  const handleSkip = () => {
    resetCallState();
    setCapturedInfo("");
    setNotes("");
    setShowScripts(false);
    setSelectedOutcome(null);
    if (currentIndex < actions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setCurrentIndex(0);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F8FAFC" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: EMERALD }} />
      </div>
    );
  }

  if (totalActions === 0 && totalDone === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F8FAFC" }}>
        <div className="text-center max-w-md mx-auto">
          <Target className="w-12 h-12 mx-auto mb-4" style={{ color: MUTED }} />
          <h2 className="text-lg font-bold mb-2" style={{ color: TEXT }}>No Actions in Queue</h2>
          <p className="text-sm mb-6" style={{ color: MUTED }}>
            Go to Today's Actions and activate flows from your call list to populate the action queue.
          </p>
          <Button onClick={() => navigate("/machine/today")} style={{ background: EMERALD, color: "white" }} data-testid="button-go-today">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go to Today
          </Button>
        </div>
      </div>
    );
  }

  if (isSessionComplete) {
    const callsMade = sessionLog.filter(l => ["gatekeeper", "dm_call"].includes(l.flowType)).length;
    const emailsSent = sessionLog.filter(l => l.flowType === "email").length;
    const dmReached = sessionLog.filter(l => ["interested", "meeting_requested", "live_answer"].includes(l.outcome)).length;

    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F8FAFC" }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-lg mx-auto p-8 rounded-xl"
          style={{ background: "white", border: `1px solid ${BORDER}` }}
        >
          <Trophy className="w-12 h-12 mx-auto mb-4" style={{ color: EMERALD }} />
          <h2 className="text-xl font-bold mb-2" style={{ color: TEXT }}>Session Complete</h2>
          <p className="text-sm mb-6" style={{ color: MUTED }}>You completed {sessionLog.length} actions this session</p>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-3 rounded-lg" style={{ background: SUBTLE }}>
              <div className="text-2xl font-bold" style={{ color: TEXT }}>{callsMade}</div>
              <div className="text-xs" style={{ color: MUTED }}>Calls Made</div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: SUBTLE }}>
              <div className="text-2xl font-bold" style={{ color: TEXT }}>{emailsSent}</div>
              <div className="text-xs" style={{ color: MUTED }}>Emails Sent</div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: SUBTLE }}>
              <div className="text-2xl font-bold" style={{ color: EMERALD }}>{dmReached}</div>
              <div className="text-xs" style={{ color: MUTED }}>DMs Reached</div>
            </div>
          </div>

          <Button onClick={() => navigate("/machine/today")} style={{ background: EMERALD, color: "white" }} data-testid="button-back-today">
            Back to Today
          </Button>
        </motion.div>
      </div>
    );
  }

  if (explanationData) {
    return <ExplanationScreen data={explanationData} onContinue={() => setExplanationData(null)} onViewCompany={() => { const compId = explanationData.companyId; setExplanationData(null); if (compId) navigate(`/machine/company/${compId}`); }} />;
  }

  const flowConfig = FLOW_CONFIG[currentAction.flowType] || FLOW_CONFIG.gatekeeper;
  const FlowIcon = flowConfig.icon;
  const outcomes = getOutcomesForFlow(currentAction.flowType);
  const isOverdue = new Date(currentAction.dueAt) < new Date();
  const isCallFlow = currentAction.flowType === "gatekeeper" || currentAction.flowType === "dm_call";
  const phone = currentAction.contactPhone || currentAction.companyPhone || currentCompany?.phone;

  const isCallActive = callState !== "idle" && callState !== "failed";
  const isCallEnded = callState === "completed" || callState === "no-answer" || callState === "busy" || callState === "canceled";
  const isCallLive = callState === "in-progress";
  const isCallDialing = callState === "dialing" || callState === "ringing";

  const callStateLabel = callState === "dialing" ? "Dialing..." :
    callState === "ringing" ? "Ringing..." :
    callState === "in-progress" ? "In Progress" :
    callState === "completed" ? "Call Ended" :
    callState === "no-answer" ? "No Answer" :
    callState === "busy" ? "Line Busy" :
    callState === "canceled" ? "Canceled" :
    callState === "failed" ? "Failed" : "";

  const callStateColor = isCallLive ? EMERALD :
    isCallDialing ? AMBER :
    isCallEnded ? MUTED :
    callState === "failed" ? ERROR : MUTED;

  return (
    <div className="min-h-screen" style={{ background: "#F8FAFC" }}>
      <div className="sticky top-0 z-50 bg-white" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate("/machine/today")} className="text-xs" style={{ color: MUTED }} data-testid="button-exit-focus">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            Exit Focus
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: TEXT }}>
              {totalDone > 0 ? `${totalDone} done` : ""}{totalDone > 0 && totalRemaining > 0 ? " / " : ""}{totalRemaining} left
            </span>
            <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ background: `${EMERALD}15` }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: EMERALD }} />
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSkip} className="text-xs" style={{ color: MUTED }} data-testid="button-skip" disabled={isCallLive || isCallDialing || initiateCallMutation.isPending}>
            Skip
            <SkipForward className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentAction.id}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.25 }}
          >
            <div className="rounded-xl overflow-hidden" style={{ background: "white", border: `1px solid ${BORDER}` }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ background: flowConfig.bgLight, borderBottom: `1px solid ${flowConfig.color}20` }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${flowConfig.color}20` }}>
                    <FlowIcon className="w-5 h-5" style={{ color: flowConfig.color }} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: flowConfig.color }}>
                      {flowConfig.label}
                    </div>
                    <div className="text-xs" style={{ color: MUTED }}>
                      Attempt #{currentAction.attemptNumber}
                      {isOverdue && <span style={{ color: ERROR }}> (Overdue)</span>}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-medium" style={{ color: MUTED }}>Priority</div>
                  <div className="text-sm font-bold" style={{ color: currentAction.priority >= 80 ? EMERALD : currentAction.priority >= 50 ? AMBER : MUTED }}>
                    P{currentAction.priority}
                  </div>
                </div>
              </div>

              <div className="px-6 py-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold" style={{ color: TEXT }} data-testid="text-focus-company">
                      {currentAction.companyName}
                    </h2>
                    <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: MUTED }}>
                      {currentAction.companyCity && (
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{currentAction.companyCity}</span>
                      )}
                      {currentAction.companyCategory && <span>{currentAction.companyCategory}</span>}
                      {currentAction.bucket && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{
                          background: currentAction.bucket === "Hot Follow-up" ? "rgba(239,68,68,0.1)" : currentAction.bucket === "Working" ? "rgba(245,158,11,0.1)" : "rgba(16,185,129,0.1)",
                          color: currentAction.bucket === "Hot Follow-up" ? ERROR : currentAction.bucket === "Working" ? AMBER : EMERALD,
                        }}>
                          {currentAction.bucket}
                        </span>
                      )}
                    </div>
                  </div>
                  {currentCompany?.website && (
                    <a href={currentCompany.website.startsWith("http") ? currentCompany.website : `https://${currentCompany.website}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs flex items-center gap-1" style={{ color: BLUE }}
                      data-testid="link-website"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Website
                    </a>
                  )}
                </div>

                {currentAction.contactName && (
                  <div className="rounded-lg p-3 mb-4" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <User className="w-4 h-4" style={{ color: EMERALD }} />
                      <span className="text-sm font-semibold" style={{ color: TEXT }}>{currentAction.contactName}</span>
                    </div>
                    {currentCompany?.offer_dm_title && (
                      <div className="text-xs ml-6" style={{ color: MUTED }}>{currentCompany.offer_dm_title}</div>
                    )}
                  </div>
                )}

                {isCallFlow && phone && (
                  <div className="mb-4">
                    {callState === "idle" && (
                      <div className="flex items-center gap-2">
                        {twilioReady === null ? (
                          <button
                            disabled
                            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
                            style={{ background: `${MUTED}15`, color: MUTED, border: `1px solid ${BORDER}` }}
                          >
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Checking...
                          </button>
                        ) : twilioReady ? (
                          <button
                            onClick={handleInitiateCall}
                            disabled={initiateCallMutation.isPending}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all hover:shadow-md"
                            style={{ background: EMERALD, color: "white" }}
                            data-testid="button-call-twilio"
                          >
                            {initiateCallMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Phone className="w-4 h-4" />
                            )}
                            Call {phone}
                          </button>
                        ) : (
                          <a href={`tel:${phone}`} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                            style={{ background: `${EMERALD}12`, color: EMERALD, border: `1px solid ${EMERALD}30` }}
                            data-testid="button-call"
                          >
                            <Phone className="w-4 h-4" />
                            {phone}
                          </a>
                        )}
                        <CopyButton text={phone} label="Copy" id="phone" />
                        {currentAction.contactEmail && (
                          <CopyButton text={currentAction.contactEmail} label="Email" id="email" />
                        )}
                      </div>
                    )}

                    {isCallActive && (
                      <div className="rounded-lg overflow-hidden" style={{ border: `2px solid ${callStateColor}30`, background: `${callStateColor}04` }} data-testid="panel-call-session">
                        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${callStateColor}15` }}>
                          <div className="flex items-center gap-3">
                            {isCallDialing && (
                              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${AMBER}15` }}>
                                <Loader2 className="w-4 h-4 animate-spin" style={{ color: AMBER }} />
                              </div>
                            )}
                            {isCallLive && (
                              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${EMERALD}15` }}>
                                <Mic className="w-4 h-4" style={{ color: EMERALD }} />
                              </div>
                            )}
                            {isCallEnded && (
                              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${MUTED}15` }}>
                                <PhoneOff className="w-4 h-4" style={{ color: MUTED }} />
                              </div>
                            )}
                            <div>
                              <div className="text-sm font-semibold" style={{ color: callStateColor }} data-testid="text-call-state">
                                {callStateLabel}
                              </div>
                              <div className="text-xs" style={{ color: MUTED }}>
                                {currentAction.companyName}{currentAction.contactName ? ` - ${currentAction.contactName}` : ""}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {isCallLive && callStartTime && (
                              <CallTimer startTime={callStartTime} />
                            )}
                            {isCallEnded && callDuration != null && (
                              <span className="text-xs font-mono" style={{ color: MUTED }}>
                                {Math.floor(callDuration / 60)}:{String(callDuration % 60).padStart(2, "0")}
                              </span>
                            )}
                          </div>
                        </div>

                        {isCallLive && callSid && (
                          <div className="p-3">
                            <LiveCoachPanel callSid={callSid} token={getToken() || ""} />
                          </div>
                        )}

                        {isCallEnded && (
                          <div className="px-4 py-3">
                            <div className="text-xs font-semibold uppercase mb-2" style={{ color: EMERALD }}>
                              Log call outcome below
                            </div>
                            <button
                              onClick={resetCallState}
                              className="text-xs px-2 py-1 rounded transition-colors"
                              style={{ color: MUTED, border: `1px solid ${BORDER}` }}
                              data-testid="button-dismiss-call"
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {callState === "failed" && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="text-xs" style={{ color: ERROR }}>Call failed to connect.</div>
                        <button
                          onClick={resetCallState}
                          className="text-xs px-2 py-1 rounded"
                          style={{ color: BLUE, border: `1px solid ${BORDER}` }}
                          data-testid="button-retry-call"
                        >
                          Try Again
                        </button>
                        <a href={`tel:${phone}`} className="text-xs px-2 py-1 rounded"
                          style={{ color: MUTED, border: `1px solid ${BORDER}` }}
                          data-testid="button-call-fallback"
                        >
                          Use Phone
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {currentAction.recommendationText && (
                  <div className="rounded-lg p-3 mb-4" style={{ background: `${flowConfig.color}08`, border: `1px solid ${flowConfig.color}15` }}>
                    <div className="text-xs font-semibold uppercase mb-1" style={{ color: flowConfig.color }}>Recommended Action</div>
                    <div className="text-sm" style={{ color: TEXT }}>{currentAction.recommendationText}</div>
                  </div>
                )}

                {currentAction.lastOutcome && (
                  <div className="text-xs mb-4" style={{ color: MUTED }}>
                    <span className="font-medium">Previous result:</span>{" "}
                    {currentAction.lastOutcome.replace(/_/g, " ")}
                  </div>
                )}

                {currentCompany && (isCallFlow || currentAction.flowType === "email") && (
                  <div className="mb-4">
                    <button
                      onClick={() => setShowScripts(!showScripts)}
                      className="flex items-center gap-1 text-xs font-semibold transition-colors"
                      style={{ color: BLUE }}
                      data-testid="button-toggle-scripts"
                    >
                      {showScripts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {showScripts ? "Hide" : "Show"} Scripts & Intel
                    </button>
                    {showScripts && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mt-3 space-y-3"
                      >
                        {currentAction.flowType === "gatekeeper" && currentCompany.playbook_gatekeeper && (
                          <ScriptBlock title="Gatekeeper Script" content={currentCompany.playbook_gatekeeper} color={AMBER} />
                        )}
                        {currentAction.flowType === "dm_call" && currentCompany.playbook_opener && (
                          <ScriptBlock title="Call Opener" content={currentCompany.playbook_opener} color={EMERALD} />
                        )}
                        {currentCompany.playbook_voicemail && (
                          <ScriptBlock title="Voicemail" content={currentCompany.playbook_voicemail} color={MUTED} />
                        )}
                        {currentCompany.playbook_strategy_notes && (
                          <ScriptBlock title="Strategy Notes" content={currentCompany.playbook_strategy_notes} color={BLUE} />
                        )}
                        {currentCompany.gatekeeper_name && (
                          <div className="rounded-lg p-3" style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}15` }}>
                            <div className="text-xs font-semibold mb-1" style={{ color: AMBER }}>Known Gatekeeper</div>
                            <div className="text-sm" style={{ color: TEXT }}>{currentCompany.gatekeeper_name}</div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                )}

                {selectedOutcome && needsCaptureForOutcome(selectedOutcome) && (
                  <div className="rounded-lg p-3 mb-4" style={{ background: `${EMERALD}06`, border: `1px solid ${EMERALD}20` }}>
                    <div className="text-xs font-semibold mb-2" style={{ color: EMERALD }}>
                      Captured Information — {getOutcomesForFlow("gatekeeper").find(o => o.value === selectedOutcome)?.label}
                    </div>
                    <Input
                      placeholder={selectedOutcome === "gave_dm_name" ? "Enter DM name..."
                        : selectedOutcome === "gave_email" ? "Enter email address..."
                        : selectedOutcome === "gave_direct_extension" ? "Enter extension number..."
                        : "Enter captured info..."}
                      value={capturedInfo}
                      onChange={e => setCapturedInfo(e.target.value)}
                      className="h-8 text-sm mb-2"
                      data-testid="input-captured-info"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => submitOutcome(selectedOutcome)}
                        disabled={!capturedInfo.trim() || logMutation.isPending}
                        style={{ background: EMERALD, color: "white" }}
                        data-testid="button-confirm-capture"
                      >
                        {logMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                        Confirm
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setSelectedOutcome(null); setCapturedInfo(""); }} data-testid="button-cancel-capture">
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {selectedOutcome === "not_a_fit" && (
                  <div className="rounded-lg p-3 mb-4" style={{ background: `${ERROR}06`, border: `1px solid ${ERROR}20` }}>
                    <div className="text-xs font-semibold mb-2" style={{ color: ERROR }}>
                      Why is this company not a fit?
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {NOT_A_FIT_REASONS.map(reason => (
                        <button
                          key={reason.value}
                          onClick={() => handleDqReasonSelect(reason.value)}
                          disabled={logMutation.isPending}
                          className="px-3 py-2 rounded-lg text-xs font-medium transition-all hover:shadow-sm text-left"
                          style={{
                            background: "white",
                            border: `1px solid ${ERROR}30`,
                            color: TEXT,
                            opacity: logMutation.isPending ? 0.5 : 1,
                          }}
                          data-testid={`dq-reason-${reason.value}`}
                        >
                          {reason.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedOutcome(null)} data-testid="button-cancel-dq">
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mb-4">
                  <Textarea
                    placeholder="Add notes (optional)..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="text-sm min-h-[60px]"
                    style={{ borderColor: BORDER }}
                    data-testid="input-notes"
                  />
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase mb-2" style={{ color: isCallEnded ? EMERALD : MUTED }}>
                    {isCallEnded ? "Log Call Outcome" : "Log Outcome"}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {outcomes.map((outcome) => {
                      const Icon = outcome.icon;
                      const isLogging = loggingOutcome === outcome.value;
                      return (
                        <button
                          key={outcome.value}
                          onClick={() => handleOutcome(outcome.value)}
                          disabled={logMutation.isPending}
                          className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-xs font-medium transition-all hover:shadow-sm"
                          style={{
                            background: isLogging ? `${outcome.color}20` : "white",
                            border: `1px solid ${isLogging ? outcome.color : BORDER}`,
                            color: isLogging ? outcome.color : TEXT,
                            opacity: logMutation.isPending && !isLogging ? 0.5 : 1,
                          }}
                          data-testid={`outcome-${outcome.value}`}
                        >
                          {isLogging ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Icon className="w-4 h-4" style={{ color: outcome.color }} />
                          )}
                          <span className="text-center leading-tight">{outcome.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function ScriptBlock({ title, content, color }: { title: string; content: string; color: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg p-3 relative" style={{ background: `${color}06`, border: `1px solid ${color}15` }}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold" style={{ color }}>{title}</div>
        <button
          onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
          style={{ background: copied ? `${EMERALD}15` : "transparent", color: copied ? EMERALD : MUTED }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="text-sm whitespace-pre-wrap" style={{ color: TEXT }}>{content}</div>
    </div>
  );
}
