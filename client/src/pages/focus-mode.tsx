import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Mail,
  Phone,
  CheckCircle2,
  Loader2,
  XCircle,
  ThumbsUp,
  Send,
  Clock,
  Eye,
  Settings,
  AlertTriangle,
  Pencil,
  FileText,
  Sparkles,
  X,
  Copy,
  Check,
  User,
  Shield,
  Zap,
  Calendar,
  Globe,
  MapPin,
  Mic,
  Upload,
  Brain,
  Play,
  SkipForward,
  Trophy,
  Target,
  PhoneCall,
  MailCheck,
  ChevronDown,
  ChevronUp,
  Radio,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const EMERALD = "#10B981";
const EMERALD_DARK = "#059669";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";
const ERROR = "#EF4444";

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

interface OutreachItem {
  id: number;
  clientId: string;
  companyId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  touch1Email: string | null;
  touch2Call: string | null;
  touch3Email: string | null;
  touch4Call: string | null;
  touch5Email: string | null;
  touch6Call: string | null;
  pipelineStatus: string;
  nextTouchDate: string;
  touchesCompleted: number;
  respondedAt: string | null;
  respondedVia: string | null;
  contentSource: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionOutcome {
  companyName: string;
  outcome: string;
  type: "call" | "email" | "skip";
  timestamp: number;
}

const TOUCH_LABELS = [
  { num: 1, label: "Call", icon: Phone, day: 1, isEmail: false },
  { num: 2, label: "Email", icon: Mail, day: 3, isEmail: true },
  { num: 3, label: "Call", icon: Phone, day: 5, isEmail: false },
  { num: 4, label: "Email", icon: Mail, day: 7, isEmail: true },
  { num: 5, label: "Call", icon: Phone, day: 10, isEmail: false },
  { num: 6, label: "Email", icon: Mail, day: 14, isEmail: true },
];

const OUTCOMES = [
  { value: "Decision Maker", label: "DM", color: EMERALD, icon: User },
  { value: "Gatekeeper", label: "Gatekeeper", color: BLUE, icon: Shield },
  { value: "No Answer", label: "No Answer", color: MUTED, icon: Phone },
  { value: "Qualified", label: "Qualified", color: EMERALD_DARK, icon: Zap },
  { value: "Callback", label: "Callback", color: AMBER, icon: Calendar },
  { value: "Not Interested", label: "Not Interested", color: ERROR, icon: X },
] as const;

const SIGNAL_MAP: Record<string, { title: string; description: string }> = {
  "Decision Maker": { title: "Signal captured", description: "DM reached. Targeting will improve." },
  "Gatekeeper": { title: "Intel gathered", description: "Gatekeeper mapped. Machine is learning." },
  "No Answer": { title: "Noted", description: "Follow-up queued. Machine will try again." },
  "Qualified": { title: "Opportunity created", description: "High-value target moved to pipeline." },
  "Callback": { title: "Callback locked", description: "Machine will remind you at the right time." },
  "Not Interested": { title: "Signal absorbed", description: "Targeting recalibrated. Moving on." },
};

const BUCKET_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Hot Follow-up": { bg: "rgba(239,68,68,0.08)", text: ERROR, border: "rgba(239,68,68,0.3)" },
  "Working": { bg: "rgba(245,158,11,0.08)", text: AMBER, border: "rgba(245,158,11,0.3)" },
  "Fresh": { bg: "rgba(16,185,129,0.08)", text: EMERALD, border: "rgba(16,185,129,0.3)" },
  "Hold": { bg: "rgba(148,163,184,0.08)", text: MUTED, border: "rgba(148,163,184,0.3)" },
};

function CopyButton({ text, label, id }: { text: string; label: string; id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors"
      style={{
        background: copied ? `${EMERALD}15` : SUBTLE,
        color: copied ? EMERALD : MUTED,
        border: `1px solid ${copied ? `${EMERALD}30` : BORDER}`,
      }}
      data-testid={`copy-${id}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function parseScriptSections(text: string): Array<{ label: string; body: string }> {
  const sections: Array<{ label: string; body: string }> = [];
  const parts = text.split(/\n\n+/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([A-Z][A-Z0-9_ /-]+?):\s*([\s\S]*)$/);
    if (match) {
      const label = match[1].replace(/_/g, " ").trim();
      sections.push({ label, body: match[2].trim() });
    } else if (sections.length > 0) {
      sections[sections.length - 1].body += "\n\n" + trimmed;
    } else {
      sections.push({ label: "", body: trimmed });
    }
  }
  return sections;
}

const SECTION_COLORS: Record<string, string> = {
  "OPENER": EMERALD,
  "IF THEY SHOW INTEREST": "#22C55E",
  "IF THEY SAY YES / SHOW INTEREST": "#22C55E",
  "IF THEY SAY YES": "#22C55E",
  "QUALIFYING QUESTIONS": BLUE,
  "HANDLE OBJECTIONS": AMBER,
  "THE ASK": EMERALD_DARK,
  "IF THEY SAY NO": MUTED,
  "IF THEY ASK WHY": BLUE,
  "IF THEY BLOCK": AMBER,
  "IF DM IS UNAVAILABLE": MUTED,
};

function ScriptBlock({ title, text, copyId }: { title: string; text: string; copyId: string }) {
  if (!text) return null;
  const sections = parseScriptSections(text);
  const hasMultipleSections = sections.length > 1 || (sections.length === 1 && sections[0].label);

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>{title}</span>
        <CopyButton text={text} label="Copy" id={copyId} />
      </div>
      {hasMultipleSections ? (
        <div className="px-3 pb-3 space-y-2">
          {sections.map((sec, i) => {
            const color = SECTION_COLORS[sec.label] || TEXT;
            return (
              <div key={i}>
                {sec.label && (
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{sec.label}</span>
                  </div>
                )}
                <p className="text-xs leading-relaxed pl-3" style={{ color: TEXT }}>{sec.body}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs leading-relaxed px-3 pb-3" style={{ color: TEXT }}>{text}</p>
      )}
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="w-full" data-testid="focus-progress">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold" style={{ color: TEXT }}>
          Company {current} of {total}
        </span>
        <span className="text-xs font-mono" style={{ color: MUTED }}>{pct}%</span>
      </div>
      <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: EMERALD }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function FocusCompanyCard({
  company,
  outreachItem,
  index,
  total,
  promptedOutcomeLogged,
  onOutcomeLogged,
  onEmailSent,
  onSkip,
  onNext,
  onShowGkPrompt,
  onShowQualPrompt,
  onShowCbPrompt,
  onTwilioCall,
  twilioCallPending,
  twilioCallActive,
}: {
  company: TodayCompany;
  outreachItem: OutreachItem | null;
  index: number;
  total: number;
  promptedOutcomeLogged: boolean;
  onOutcomeLogged: (outcome: string) => void;
  onEmailSent: () => void;
  onSkip: () => void;
  onNext: () => void;
  onShowGkPrompt: (companyName: string, gkName: string) => void;
  onShowQualPrompt: (companyName: string) => void;
  onShowCbPrompt: (companyName: string) => void;
  onTwilioCall?: (phone: string, companyName: string, contactName: string) => void;
  twilioCallPending?: boolean;
  twilioCallActive?: boolean;
}) {
  const { getToken } = useAuth();
  const token = getToken();
  const { toast } = useToast();
  const [showScripts, setShowScripts] = useState(true);
  const [lastCallId, setLastCallId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localOutcomeLogged, setLocalOutcomeLogged] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(company.offer_dm_email || "");
  const [emailSent, setEmailSent] = useState(false);

  const outcomeLogged = localOutcomeLogged || promptedOutcomeLogged;

  const nextTouch = outreachItem ? outreachItem.touchesCompleted + 1 : 0;
  const touchInfo = nextTouch > 0 && nextTouch <= 6 ? TOUCH_LABELS[nextTouch - 1] : null;
  const isEmailTouch = touchInfo?.isEmail || false;
  const isCallTouch = touchInfo && !touchInfo.isEmail;

  const callPhone = company.offer_dm_phone || company.phone || "";
  const askFor = company.offer_dm_name
    ? `${company.offer_dm_name}${company.offer_dm_title ? ` (${company.offer_dm_title})` : ""}`
    : "Safety Manager / Site Superintendent";

  const bucketStyle = BUCKET_COLORS[company.bucket] || BUCKET_COLORS["Fresh"];

  const logCallMutation = useMutation({
    mutationFn: async (data: { company_name: string; outcome: string; notes?: string; gatekeeper_name?: string }) => {
      const res = await apiRequest("POST", "/api/calls/log", data);
      return res.json();
    },
    onSuccess: (resData, vars) => {
      if (resData?.call_id) setLastCallId(resData.call_id);
      setLocalOutcomeLogged(true);
      const fb = SIGNAL_MAP[vars.outcome];
      toast({ title: fb?.title || `Signal: ${vars.outcome}`, description: fb?.description, duration: 2500 });
      queryClient.invalidateQueries({ queryKey: ["/api/today-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/pipeline"] });
      onOutcomeLogged(vars.outcome);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to log call", description: err.message, variant: "destructive" });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      if (!outreachItem) throw new Error("No outreach pipeline entry");
      await apiRequest("POST", "/api/email/send", {
        outreachPipelineId: outreachItem.id,
        touchNumber: nextTouch || 1,
        recipientEmail,
        recipientName: outreachItem.contactName || company.offer_dm_name || undefined,
        companyId: outreachItem.companyId,
        companyName: company.company_name,
      });
    },
    onSuccess: () => {
      setEmailSent(true);
      toast({ title: "Email sent", description: `Touch ${nextTouch || 1} sent to ${recipientEmail}` });
      queryClient.invalidateQueries({ queryKey: ["/api/email/quota"] });
      onEmailSent();
    },
    onError: (err: any) => {
      const msg = err.message || "Unknown error";
      toast({ title: msg.toLowerCase().includes("daily limit") ? "Daily limit reached" : "Send failed", description: msg, variant: "destructive" });
    },
  });

  const PROMPTED_OUTCOMES = ["Gatekeeper", "Qualified", "Callback"];

  const handleOutcome = (outcome: string) => {
    if (PROMPTED_OUTCOMES.includes(outcome)) {
      if (outcome === "Gatekeeper") onShowGkPrompt(company.company_name, company.gatekeeper_name || "");
      if (outcome === "Qualified") onShowQualPrompt(company.company_name);
      if (outcome === "Callback") onShowCbPrompt(company.company_name);
      return;
    }
    logCallMutation.mutate({ company_name: company.company_name, outcome });
  };

  const handleRecordingUpload = async (file: File) => {
    if (!lastCallId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("recording", file);
      const res = await fetch(`/api/calls/${lastCallId}/recording`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      setUploaded(true);
      toast({ title: "Recording uploaded", description: "Analyzing transcription..." });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  function getEmailContent(): { subject: string; body: string } | null {
    if (!outreachItem) return null;
    if (touchInfo && !isEmailTouch) return null;
    const effectiveTouch = nextTouch || 1;
    const raw = effectiveTouch === 2 ? outreachItem.touch2Call
      : effectiveTouch === 4 ? outreachItem.touch4Call
      : effectiveTouch === 6 ? outreachItem.touch6Call
      : null;
    if (!raw) return null;
    const match = raw.match(/^Subject:\s*(.+?)(?:\r?\n){2}([\s\S]*)$/i);
    if (match) return { subject: match[1].trim(), body: match[2].trim() };
    return { subject: "Follow-up", body: raw.trim() };
  }

  const emailContent = getEmailContent();

  return (
    <motion.div
      key={company.id}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-2xl mx-auto"
      data-testid={`focus-card-${index}`}
    >
      <div className="rounded-2xl overflow-hidden" style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold" style={{ color: TEXT }} data-testid={`focus-company-name-${index}`}>
                  {company.company_name}
                </h2>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                  style={{ background: bucketStyle.bg, color: bucketStyle.text, border: `1px solid ${bucketStyle.border}` }}
                  data-testid={`focus-bucket-${index}`}
                >
                  {company.bucket}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
                {company.city && (
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {company.city}</span>
                )}
                {company.times_called > 0 && <span>Called {company.times_called}x</span>}
                {company.last_outcome && <span>Last: {company.last_outcome}</span>}
              </div>
            </div>
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
              style={{
                background: isEmailTouch ? "rgba(59,130,246,0.08)" : "rgba(16,185,129,0.08)",
                color: isEmailTouch ? BLUE : EMERALD,
                border: `1px solid ${isEmailTouch ? "rgba(59,130,246,0.3)" : "rgba(16,185,129,0.3)"}`,
              }}
              data-testid={`focus-touch-badge-${index}`}
            >
              {isEmailTouch ? <Mail className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
              Touch {nextTouch || 1} -- {touchInfo?.label || "Call"}
            </div>
          </div>

          <div className="rounded-xl p-4 mb-4" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Contact</span>
              <div className="flex gap-1.5">
                {callPhone && <CopyButton text={callPhone} label="Phone" id={`focus-phone-${index}`} />}
                {company.offer_dm_email && <CopyButton text={company.offer_dm_email} label="Email" id={`focus-email-${index}`} />}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                <span className="text-sm font-semibold" style={{ color: TEXT }} data-testid={`focus-ask-for-${index}`}>
                  Ask for: {askFor}
                </span>
              </div>
              {callPhone && (
                <div className="flex items-center gap-3">
                  <a href={`tel:${callPhone.replace(/\s/g, "")}`} className="flex items-center gap-2 text-sm font-bold" style={{ color: EMERALD }} data-testid={`focus-phone-link-${index}`}>
                    <Phone className="w-4 h-4" /> {callPhone}
                  </a>
                  {onTwilioCall && (
                    <button
                      onClick={() => onTwilioCall(callPhone, company.company_name, company.offer_dm_name || "")}
                      disabled={twilioCallPending || twilioCallActive}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                      style={{
                        background: twilioCallActive ? `${ERROR}15` : EMERALD,
                        color: twilioCallActive ? ERROR : "#FFF",
                        border: twilioCallActive ? `1px solid ${ERROR}30` : "none",
                      }}
                      data-testid={`focus-twilio-call-${index}`}
                    >
                      {twilioCallPending ? <Loader2 className="w-3 h-3 animate-spin" /> : twilioCallActive ? <Radio className="w-3 h-3 animate-pulse" /> : <PhoneCall className="w-3 h-3" />}
                      {twilioCallActive ? "Live" : "Twilio Call"}
                    </button>
                  )}
                </div>
              )}
              {company.offer_dm_email && (
                <a href={`mailto:${company.offer_dm_email}`} className="flex items-center gap-2 text-xs" style={{ color: BLUE }}>
                  <Mail className="w-3.5 h-3.5" /> {company.offer_dm_email}
                </a>
              )}
              {company.gatekeeper_name && (
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5" style={{ color: AMBER }} />
                  <span className="text-xs" style={{ color: MUTED }}>Gatekeeper: <span style={{ color: TEXT, fontWeight: 500 }}>{company.gatekeeper_name}</span></span>
                </div>
              )}
              {company.website && (
                <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs" style={{ color: BLUE }}>
                  <Globe className="w-3 h-3" /> Website
                </a>
              )}
            </div>
          </div>

          {company.rank_reason && (
            <div className="rounded-xl p-3 mb-4" style={{ background: "rgba(16,185,129,0.03)", border: `1px solid rgba(16,185,129,0.15)` }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Brain className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EMERALD }}>Intel</span>
              </div>
              {(() => {
                const reason = company.rank_reason;
                const talkingPoints: string[] = [];
                const tpParts = reason.split(/Talking point:\s*/i);
                const mainText = (tpParts[0] || "").trim();
                for (let i = 1; i < tpParts.length; i++) {
                  const cleaned = tpParts[i].trim();
                  if (cleaned) talkingPoints.push(cleaned);
                }
                return (
                  <>
                    <p className="text-xs leading-relaxed" style={{ color: TEXT }}>{mainText}</p>
                    {talkingPoints.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {talkingPoints.map((tp, i) => (
                          <div key={i} className="rounded-lg px-3 py-2" style={{ background: "rgba(16,185,129,0.06)", border: `1px solid rgba(16,185,129,0.15)` }}>
                            <div className="flex items-center gap-1 mb-0.5">
                              <Target className="w-3 h-3" style={{ color: EMERALD }} />
                              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: EMERALD }}>Strategic Bridge {talkingPoints.length > 1 ? i + 1 : ""}</span>
                            </div>
                            <p className="text-xs italic" style={{ color: TEXT }}>{tp}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {isEmailTouch && emailContent && (
            <div className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: MUTED }}>Email Touch {nextTouch || 1}</div>
              <div className="rounded-xl p-4" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                <div className="mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Subject</span>
                  <p className="text-sm font-semibold mt-0.5" style={{ color: TEXT }}>{emailContent.subject}</p>
                </div>
                <div className="mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Body</span>
                  <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed mt-0.5" style={{ color: TEXT }}>{emailContent.body}</pre>
                </div>
                {!emailSent ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="recipient@email.com"
                      className="text-xs px-3 py-2 rounded-lg flex-1"
                      style={{ border: `1px solid ${BORDER}`, outline: "none", color: TEXT, background: "#FFFFFF" }}
                      data-testid={`focus-email-input-${index}`}
                    />
                    <Button
                      size="sm"
                      disabled={sendEmailMutation.isPending || !recipientEmail}
                      onClick={() => sendEmailMutation.mutate()}
                      className="gap-1 text-xs h-8"
                      style={{ background: EMERALD, color: "#FFFFFF" }}
                      data-testid={`focus-send-email-${index}`}
                    >
                      {sendEmailMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Send
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs" style={{ color: EMERALD }} data-testid={`focus-email-sent-${index}`}>
                    <MailCheck className="w-4 h-4" /> Email sent to {recipientEmail}
                  </div>
                )}
              </div>
            </div>
          )}

          {isEmailTouch && !emailContent && (
            <div className="rounded-xl p-4 mb-4 text-center" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
              <p className="text-xs" style={{ color: MUTED }}>No email content generated for Touch {nextTouch || 1} yet. Run the Outreach Engine first.</p>
            </div>
          )}

          <div className="mb-4">
            <button
              onClick={() => setShowScripts(!showScripts)}
              className="flex items-center gap-2 text-xs font-semibold mb-2"
              style={{ color: showScripts ? EMERALD : MUTED }}
              data-testid={`focus-toggle-scripts-${index}`}
            >
              <FileText className="w-3.5 h-3.5" />
              {showScripts ? "Hide Scripts" : "Show Call Scripts"}
              {showScripts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showScripts && (
              <div className="space-y-2">
                <ScriptBlock title="Call Opener" text={company.playbook_opener} copyId={`focus-opener-${index}`} />
                <ScriptBlock title="Gatekeeper Script" text={company.playbook_gatekeeper} copyId={`focus-gk-${index}`} />
                <ScriptBlock title="Voicemail" text={company.playbook_voicemail} copyId={`focus-vm-${index}`} />
                <ScriptBlock title="Follow-up Text" text={company.playbook_followup} copyId={`focus-fu-${index}`} />
              </div>
            )}
          </div>

          {!outcomeLogged && (
            <div className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: MUTED }}>Log Call Outcome</div>
              <div className="grid grid-cols-4 gap-1.5" data-testid={`focus-outcomes-${index}`}>
                {OUTCOMES.map((o) => {
                  const Icon = o.icon;
                  return (
                    <button
                      key={o.value}
                      onClick={() => handleOutcome(o.value)}
                      disabled={logCallMutation.isPending}
                      className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg text-xs font-semibold transition-colors"
                      style={{ background: `${o.color}10`, color: o.color, border: `1px solid ${o.color}30` }}
                      data-testid={`focus-outcome-${o.value.toLowerCase().replace(/\s+/g, "-")}-${index}`}
                    >
                      <Icon className="w-4 h-4" />
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {outcomeLogged && (
            <div className="rounded-xl p-4 mb-4 flex items-center gap-3" style={{ background: "rgba(16,185,129,0.05)", border: `1px solid rgba(16,185,129,0.2)` }} data-testid={`focus-outcome-logged-${index}`}>
              <CheckCircle2 className="w-5 h-5" style={{ color: EMERALD }} />
              <span className="text-sm font-semibold" style={{ color: TEXT }}>Outcome logged</span>
            </div>
          )}

          {lastCallId && (
            <div className="rounded-xl p-3 mb-4" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Mic className="w-3.5 h-3.5" style={{ color: MUTED }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Recording</span>
              </div>
              {uploaded ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: EMERALD }}>
                  <CheckCircle2 className="w-4 h-4" /> Recording uploaded
                </div>
              ) : (
                <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: BLUE }}>
                  <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRecordingUpload(f); }} data-testid={`focus-recording-${index}`} />
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploading ? "Uploading..." : "Upload call recording (optional)"}
                </label>
              )}
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex items-center justify-between" style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "16px" }}>
          <Button
            variant="outline"
            size="sm"
            onClick={onSkip}
            className="gap-1.5 text-xs"
            style={{ borderColor: BORDER, color: MUTED }}
            data-testid={`focus-skip-${index}`}
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip
          </Button>
          <Button
            onClick={onNext}
            className="gap-1.5 text-sm font-semibold px-6"
            style={{ background: EMERALD, color: "#FFFFFF" }}
            data-testid={`focus-next-${index}`}
          >
            {index === total - 1 ? "Finish Session" : "Next"}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function DebriefScreen({ outcomes, onPrepare, onDashboard }: {
  outcomes: SessionOutcome[];
  onPrepare: () => void;
  onDashboard: () => void;
}) {
  const callsMade = outcomes.filter((o) => o.type === "call").length;
  const emailsSent = outcomes.filter((o) => o.type === "email").length;
  const skipped = outcomes.filter((o) => o.type === "skip").length;
  const qualified = outcomes.filter((o) => o.outcome === "Qualified").length;
  const callbacks = outcomes.filter((o) => o.outcome === "Callback").length;
  const dms = outcomes.filter((o) => o.outcome === "Decision Maker").length;
  const gatekeepers = outcomes.filter((o) => o.outcome === "Gatekeeper").length;
  const noAnswer = outcomes.filter((o) => o.outcome === "No Answer").length;
  const notInterested = outcomes.filter((o) => o.outcome === "Not Interested").length;
  const total = outcomes.length;
  const completed = callsMade + emailsSent;

  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState(false);

  const prepareMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/run"),
    onSuccess: () => {
      setPrepared(true);
      setPreparing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today-list"] });
    },
    onError: () => {
      setPreparing(false);
    },
  });

  const handlePrepare = () => {
    setPreparing(true);
    prepareMutation.mutate();
    onPrepare();
  };

  const statCards = [
    { label: "Calls Made", value: callsMade, color: EMERALD, icon: PhoneCall },
    { label: "Emails Sent", value: emailsSent, color: BLUE, icon: MailCheck },
    { label: "Qualified", value: qualified, color: EMERALD_DARK, icon: Zap },
    { label: "Callbacks", value: callbacks, color: AMBER, icon: Calendar },
  ];

  const outcomeBreakdown = [
    { label: "DM Reached", value: dms, color: EMERALD },
    { label: "Gatekeeper", value: gatekeepers, color: BLUE },
    { label: "No Answer", value: noAnswer, color: MUTED },
    { label: "Not Interested", value: notInterested, color: ERROR },
    { label: "Skipped", value: skipped, color: MUTED },
  ].filter((o) => o.value > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-2xl mx-auto"
      data-testid="focus-debrief"
    >
      <div className="text-center mb-8">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
        >
          <Trophy className="w-16 h-16 mx-auto mb-4" style={{ color: EMERALD }} />
        </motion.div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: TEXT }} data-testid="debrief-title">Session Complete</h1>
        <p className="text-sm" style={{ color: MUTED }}>
          You worked through {total} companies. Here is what you accomplished.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6" data-testid="debrief-stats">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-xl p-4 text-center"
              style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
              data-testid={`debrief-stat-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Icon className="w-5 h-5 mx-auto mb-1.5" style={{ color: card.color }} />
              <div className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</div>
              <div className="text-[10px] font-medium mt-0.5" style={{ color: MUTED }}>{card.label}</div>
            </div>
          );
        })}
      </div>

      {outcomeBreakdown.length > 0 && (
        <div className="rounded-xl p-4 mb-6" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }} data-testid="debrief-breakdown">
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>Outcome Breakdown</h3>
          <div className="space-y-2">
            {outcomeBreakdown.map((o) => (
              <div key={o.label} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: TEXT }}>{o.label}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 rounded-full overflow-hidden" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
                    <div className="h-full rounded-full" style={{ background: o.color, width: `${total > 0 ? (o.value / total) * 100 : 0}%` }} />
                  </div>
                  <span className="text-sm font-bold w-6 text-right" style={{ color: o.color }}>{o.value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        {!prepared ? (
          <Button
            onClick={handlePrepare}
            disabled={preparing}
            className="flex-1 gap-2 text-sm font-semibold h-11"
            style={{ background: EMERALD, color: "#FFFFFF" }}
            data-testid="debrief-prepare"
          >
            {preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {preparing ? "Preparing tomorrow's list..." : "Prepare Tomorrow"}
          </Button>
        ) : (
          <div className="flex-1 rounded-xl p-3 flex items-center gap-2" style={{ background: "rgba(16,185,129,0.05)", border: `1px solid rgba(16,185,129,0.2)` }} data-testid="debrief-prepared">
            <CheckCircle2 className="w-4 h-4" style={{ color: EMERALD }} />
            <span className="text-sm font-semibold" style={{ color: EMERALD }}>Machine is preparing tomorrow's leads</span>
          </div>
        )}
        <Button
          variant="outline"
          onClick={onDashboard}
          className="gap-1.5 text-sm h-11"
          style={{ borderColor: BORDER, color: TEXT }}
          data-testid="debrief-dashboard"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Button>
      </div>
    </motion.div>
  );
}

export default function FocusModePage() {
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const { toast } = useToast();

  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionOutcomes, setSessionOutcomes] = useState<SessionOutcome[]>([]);
  const [finished, setFinished] = useState(false);
  const [promptedOutcomeIndices, setPromptedOutcomeIndices] = useState<Set<number>>(new Set());
  const [actionTakenIndices, setActionTakenIndices] = useState<Set<number>>(new Set());

  const [showGkPrompt, setShowGkPrompt] = useState(false);
  const [gkCompany, setGkCompany] = useState("");
  const [gkName, setGkName] = useState("");

  const [showQualPrompt, setShowQualPrompt] = useState(false);
  const [qualCompany, setQualCompany] = useState("");
  const [qualNotes, setQualNotes] = useState("");

  const [showCbPrompt, setShowCbPrompt] = useState(false);
  const [cbCompany, setCbCompany] = useState("");
  const [cbDate, setCbDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0];
  });
  const [cbNotes, setCbNotes] = useState("");

  const { data: todayData, isLoading: todayLoading } = useQuery<{ companies: TodayCompany[]; count: number }>({
    queryKey: ["/api/today-list"],
    enabled: !!token,
  });

  const { data: outreachData } = useQuery<{ items: OutreachItem[] }>({
    queryKey: ["/api/outreach/pipeline"],
    enabled: !!token,
  });

  const { data: emailSettings } = useQuery({
    queryKey: ["/api/email/settings"],
    enabled: !!token,
  });

  const { data: twilioStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/twilio/status"],
    enabled: !!token,
    staleTime: 60000,
  });

  const [twilioCallActive, setTwilioCallActive] = useState(false);
  const [coachingAlerts, setCoachingAlerts] = useState<Array<{ type: string; text: string; ts: number }>>([]);
  const [coachingTranscript, setCoachingTranscript] = useState<string[]>([]);
  const [coachingConnected, setCoachingConnected] = useState(false);

  const startCoachingSSE = useCallback((callSid: string) => {
    setCoachingAlerts([]);
    setCoachingTranscript([]);
    setCoachingConnected(false);
    const es = new EventSource(`/api/twilio/coaching/${callSid}?token=${token}`);
    let failures = 0;
    es.onopen = () => { setCoachingConnected(true); failures = 0; };
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === "alert") setCoachingAlerts(prev => [...prev.slice(-19), { type: d.alertType || "info", text: d.text, ts: Date.now() }]);
        if (d.type === "transcript") setCoachingTranscript(prev => [...prev.slice(-49), d.text]);
        if (d.type === "end") { es.close(); setTwilioCallActive(false); setCoachingConnected(false); }
      } catch {}
    };
    es.onerror = () => {
      failures++;
      if (failures > 5) { es.close(); setTwilioCallActive(false); setCoachingConnected(false); }
    };
    return () => es.close();
  }, [token]);

  const twilioCallMutation = useMutation({
    mutationFn: async ({ to, companyName, contactName }: { to: string; companyName: string; contactName: string }) => {
      const res = await apiRequest("POST", "/api/twilio/call", { to, companyName, contactName });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.sid) {
        setTwilioCallActive(true);
        startCoachingSSE(data.sid);
      }
      toast({ title: "Call initiated", description: "Your phone will ring shortly." });
    },
    onError: (err: Error) => {
      toast({ title: "Call failed", description: err.message, variant: "destructive" });
    },
  });

  const handleTwilioCall = useCallback((phone: string, companyName: string, contactName: string) => {
    twilioCallMutation.mutate({ to: phone, companyName, contactName });
  }, [twilioCallMutation]);

  const logCallForPrompt = useMutation({
    mutationFn: async (data: { company_name: string; outcome: string; notes?: string; gatekeeper_name?: string }) => {
      const res = await apiRequest("POST", "/api/calls/log", data);
      return res.json();
    },
    onSuccess: (_, vars) => {
      const fb = SIGNAL_MAP[vars.outcome];
      toast({ title: fb?.title || `Signal: ${vars.outcome}`, description: fb?.description, duration: 2500 });
      queryClient.invalidateQueries({ queryKey: ["/api/today-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/pipeline"] });
      setSessionOutcomes((prev) => [...prev, { companyName: vars.company_name, outcome: vars.outcome, type: "call", timestamp: Date.now() }]);
      setPromptedOutcomeIndices((prev) => new Set(prev).add(currentIndex));
      setActionTakenIndices((prev) => new Set(prev).add(currentIndex));
    },
    onError: (err: Error) => {
      toast({ title: "Failed to log call", description: err.message, variant: "destructive" });
    },
  });

  const companies = todayData?.companies || [];
  const outreachItems = outreachData?.items || [];

  const outreachMap = new Map<string, OutreachItem>();
  for (const item of outreachItems) {
    if (item.pipelineStatus === "ACTIVE") {
      outreachMap.set(item.companyName.toLowerCase().trim(), item);
    }
  }

  function findOutreachItem(companyName: string): OutreachItem | null {
    return outreachMap.get(companyName.toLowerCase().trim()) || null;
  }

  const currentCompany = companies[currentIndex] || null;

  const advance = useCallback(() => {
    if (!actionTakenIndices.has(currentIndex) && currentCompany) {
      setSessionOutcomes((prev) => [...prev, { companyName: currentCompany.company_name, outcome: "skipped", type: "skip", timestamp: Date.now() }]);
    }
    if (currentIndex >= companies.length - 1) {
      setFinished(true);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, companies.length, actionTakenIndices, currentCompany]);

  const handleOutcomeLogged = useCallback((outcome: string) => {
    if (!currentCompany) return;
    setSessionOutcomes((prev) => [...prev, { companyName: currentCompany.company_name, outcome, type: "call", timestamp: Date.now() }]);
    setActionTakenIndices((prev) => new Set(prev).add(currentIndex));
  }, [currentCompany, currentIndex]);

  const handleEmailSent = useCallback(() => {
    if (!currentCompany) return;
    setSessionOutcomes((prev) => [...prev, { companyName: currentCompany.company_name, outcome: "email_sent", type: "email", timestamp: Date.now() }]);
    setActionTakenIndices((prev) => new Set(prev).add(currentIndex));
  }, [currentCompany, currentIndex]);

  const handleSkip = useCallback(() => {
    if (!currentCompany) return;
    setSessionOutcomes((prev) => [...prev, { companyName: currentCompany.company_name, outcome: "skipped", type: "skip", timestamp: Date.now() }]);
    setActionTakenIndices((prev) => new Set(prev).add(currentIndex));
    advance();
  }, [currentCompany, advance, currentIndex]);

  const submitGatekeeper = () => {
    logCallForPrompt.mutate({ company_name: gkCompany, outcome: "Gatekeeper", gatekeeper_name: gkName || undefined });
    setShowGkPrompt(false);
    setGkName("");
  };

  const submitQualified = () => {
    logCallForPrompt.mutate({ company_name: qualCompany, outcome: "Qualified", notes: qualNotes || undefined });
    setShowQualPrompt(false);
    setQualNotes("");
  };

  const submitCallback = () => {
    const notes = `Callback date: ${cbDate}${cbNotes ? `. ${cbNotes}` : ""}`;
    logCallForPrompt.mutate({ company_name: cbCompany, outcome: "Callback", notes });
    setShowCbPrompt(false);
    setCbNotes("");
  };

  if (!started) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFFFFF" }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-md px-6"
          data-testid="focus-start-screen"
        >
          <Target className="w-16 h-16 mx-auto mb-6" style={{ color: EMERALD }} />
          <h1 className="text-2xl font-bold mb-2" style={{ color: TEXT }}>Focus Mode</h1>
          <p className="text-sm mb-6" style={{ color: MUTED }}>
            Work through today's {companies.length || "..."} companies one at a time. Emails, calls, scripts, and outcomes — all in one flow.
          </p>

          {todayLoading ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: EMERALD }} />
              <span className="text-sm" style={{ color: MUTED }}>Loading today's list...</span>
            </div>
          ) : companies.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: MUTED }}>No companies on today's list yet. Run the machine first.</p>
              <Button variant="outline" onClick={() => navigate("/machine/dashboard")} className="gap-1.5 text-sm" style={{ borderColor: BORDER, color: TEXT }} data-testid="focus-back-empty">
                <ArrowLeft className="w-4 h-4" /> Back to Dashboard
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Button
                onClick={() => setStarted(true)}
                className="gap-2 text-sm font-semibold px-8 h-11 w-full"
                style={{ background: EMERALD, color: "#FFFFFF" }}
                data-testid="focus-start-button"
              >
                <Play className="w-4 h-4" />
                Start Session ({companies.length} companies)
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate("/machine/dashboard")}
                className="gap-1.5 text-sm w-full"
                style={{ borderColor: BORDER, color: MUTED }}
                data-testid="focus-cancel"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Dashboard
              </Button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ background: "#FFFFFF" }}>
        <DebriefScreen
          outcomes={sessionOutcomes}
          onPrepare={() => {}}
          onDashboard={() => navigate("/machine/dashboard")}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#FFFFFF" }}>
      <div className="px-6 py-4 flex items-center gap-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (sessionOutcomes.length > 0) {
              setFinished(true);
            } else {
              navigate("/machine/dashboard");
            }
          }}
          className="gap-1"
          style={{ color: MUTED }}
          data-testid="focus-exit"
        >
          <X className="w-4 h-4" />
          {sessionOutcomes.length > 0 ? "End Session" : "Exit"}
        </Button>
        <div className="flex-1">
          <ProgressBar current={currentIndex + 1} total={companies.length} />
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <AnimatePresence mode="wait">
          {currentCompany && (
            <FocusCompanyCard
              key={currentCompany.id}
              company={currentCompany}
              outreachItem={findOutreachItem(currentCompany.company_name)}
              index={currentIndex}
              total={companies.length}
              promptedOutcomeLogged={promptedOutcomeIndices.has(currentIndex)}
              onOutcomeLogged={handleOutcomeLogged}
              onEmailSent={handleEmailSent}
              onSkip={handleSkip}
              onNext={advance}
              onShowGkPrompt={(company, gk) => { setGkCompany(company); setGkName(gk); setShowGkPrompt(true); }}
              onShowQualPrompt={(company) => { setQualCompany(company); setShowQualPrompt(true); }}
              onShowCbPrompt={(company) => { setCbCompany(company); setShowCbPrompt(true); }}
              onTwilioCall={twilioStatus?.connected ? handleTwilioCall : undefined}
              twilioCallPending={twilioCallMutation.isPending}
              twilioCallActive={twilioCallActive}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {twilioCallActive && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="mx-6 mb-4 rounded-xl overflow-hidden"
            style={{ background: "#0F172A", border: `1px solid ${EMERALD}30` }}
            data-testid="focus-live-coach"
          >
            <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid rgba(255,255,255,0.1)` }}>
              <div className="flex items-center gap-2">
                <Radio className="w-3.5 h-3.5 animate-pulse" style={{ color: ERROR }} />
                <span className="text-xs font-bold text-white">Live Coach</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: coachingConnected ? `${EMERALD}30` : `${AMBER}30`, color: coachingConnected ? EMERALD : AMBER }}>
                  {coachingConnected ? "Connected" : "Connecting..."}
                </span>
              </div>
            </div>
            <div className="px-4 py-3 max-h-40 overflow-y-auto space-y-1.5">
              {coachingAlerts.length === 0 && coachingTranscript.length === 0 && (
                <p className="text-xs text-center" style={{ color: MUTED }}>Waiting for call audio...</p>
              )}
              {coachingAlerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs rounded-lg px-2.5 py-1.5" style={{
                  background: a.type === "warning" ? `${AMBER}15` : a.type === "positive" ? `${EMERALD}15` : "rgba(255,255,255,0.05)",
                  color: a.type === "warning" ? AMBER : a.type === "positive" ? EMERALD : "#CBD5E1",
                }}>
                  <Zap className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{a.text}</span>
                </div>
              ))}
              {coachingTranscript.length > 0 && (
                <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  {coachingTranscript.slice(-5).map((t, i) => (
                    <p key={i} className="text-[11px] leading-relaxed" style={{ color: "#94A3B8" }}>{t}</p>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGkPrompt && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setShowGkPrompt(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="rounded-2xl p-6 w-80" style={{ background: "#FFFFFF", border: `1px solid ${BORDER}` }} data-testid="focus-modal-gk">
              <p className="text-sm font-bold mb-1" style={{ color: TEXT }}>Gatekeeper Name</p>
              <p className="text-xs mb-3" style={{ color: MUTED }}>{gkCompany}</p>
              <input autoFocus value={gkName} onChange={(e) => setGkName(e.target.value)} placeholder="Enter gatekeeper name..." className="w-full px-3 py-2 rounded-lg text-sm mb-4" style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }} onKeyDown={(e) => e.key === "Enter" && submitGatekeeper()} data-testid="focus-input-gk-name" />
              <div className="flex gap-2">
                <Button onClick={() => { setShowGkPrompt(false); setGkName(""); }} className="flex-1 text-sm" variant="outline" style={{ borderColor: BORDER, color: MUTED }} data-testid="focus-gk-cancel">Cancel</Button>
                <Button onClick={submitGatekeeper} className="flex-1 text-sm font-bold" style={{ background: BLUE, color: "#FFFFFF" }} data-testid="focus-gk-submit">Log Gatekeeper</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showQualPrompt && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setShowQualPrompt(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="rounded-2xl p-6 w-80" style={{ background: "#FFFFFF", border: `1px solid ${BORDER}` }} data-testid="focus-modal-qual">
              <p className="text-sm font-bold mb-1" style={{ color: TEXT }}>Qualified -- Quick Notes</p>
              <p className="text-xs mb-3" style={{ color: MUTED }}>{qualCompany}</p>
              <textarea autoFocus value={qualNotes} onChange={(e) => setQualNotes(e.target.value)} placeholder="Crew size? Timeline? Key details..." rows={3} className="w-full px-3 py-2 rounded-lg text-sm mb-4 resize-none" style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }} data-testid="focus-input-qual-notes" />
              <div className="flex gap-2">
                <Button onClick={() => { setShowQualPrompt(false); setQualNotes(""); }} className="flex-1 text-sm" variant="outline" style={{ borderColor: BORDER, color: MUTED }} data-testid="focus-qual-cancel">Cancel</Button>
                <Button onClick={submitQualified} className="flex-1 text-sm font-bold" style={{ background: EMERALD_DARK, color: "#FFFFFF" }} data-testid="focus-qual-submit">Log Qualified</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCbPrompt && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setShowCbPrompt(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="rounded-2xl p-6 w-80" style={{ background: "#FFFFFF", border: `1px solid ${BORDER}` }} data-testid="focus-modal-cb">
              <p className="text-sm font-bold mb-1" style={{ color: TEXT }}>Schedule Callback</p>
              <p className="text-xs mb-3" style={{ color: MUTED }}>{cbCompany}</p>
              <input type="date" value={cbDate} onChange={(e) => setCbDate(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm mb-3" style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }} data-testid="focus-input-cb-date" />
              <input value={cbNotes} onChange={(e) => setCbNotes(e.target.value)} placeholder="Notes (optional)" className="w-full px-3 py-2 rounded-lg text-sm mb-4" style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }} onKeyDown={(e) => e.key === "Enter" && submitCallback()} data-testid="focus-input-cb-notes" />
              <div className="flex gap-2">
                <Button onClick={() => { setShowCbPrompt(false); setCbNotes(""); }} className="flex-1 text-sm" variant="outline" style={{ borderColor: BORDER, color: MUTED }} data-testid="focus-cb-cancel">Cancel</Button>
                <Button onClick={submitCallback} className="flex-1 text-sm font-bold" style={{ background: AMBER, color: TEXT }} data-testid="focus-cb-submit">Log Callback</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
