import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Mail,
  Phone,
  Play,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  XCircle,
  ThumbsUp,
  Send,
  Clock,
  Eye,
  MousePointer,
  Settings,
  MailCheck,
  MailX,
  AlertTriangle,
  MessageSquareReply,
  Pencil,
  Save,
  FileText,
  Sparkles,
  X,
  Trash2,
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

interface EmailTemplate {
  id: number;
  clientId: string;
  name: string;
  subject: string;
  body: string;
  touchNumber: number | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface OutreachResponse {
  stats: {
    total: number;
    active: number;
    completed: number;
    responded: number;
    notInterested: number;
  };
  items: OutreachItem[];
}

interface EmailSendRecord {
  id: number;
  touchNumber: number;
  contactEmail: string;
  contactName: string | null;
  subject: string;
  status: string;
  sentAt: string;
  sentVia: string | null;
  openCount: number;
  firstOpenedAt: string | null;
  clickCount: number;
  firstClickedAt: string | null;
  replyDetectedAt: string | null;
  errorMessage: string | null;
}

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

const TOUCH_LABELS = [
  { num: 1, label: "Call", icon: Phone, day: 1, isEmail: false },
  { num: 2, label: "Email", icon: Mail, day: 3, isEmail: true },
  { num: 3, label: "Call", icon: Phone, day: 5, isEmail: false },
  { num: 4, label: "Email", icon: Mail, day: 7, isEmail: true },
  { num: 5, label: "Call", icon: Phone, day: 10, isEmail: false },
  { num: 6, label: "Email", icon: Mail, day: 14, isEmail: true },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ACTIVE: { bg: "rgba(16,185,129,0.08)", text: EMERALD, border: "rgba(16,185,129,0.3)" },
  COMPLETED: { bg: "rgba(148,163,184,0.08)", text: MUTED, border: BORDER },
  RESPONDED: { bg: "rgba(59,130,246,0.08)", text: BLUE, border: "rgba(59,130,246,0.3)" },
  NOT_INTERESTED: { bg: "rgba(239,68,68,0.08)", text: ERROR, border: "rgba(239,68,68,0.3)" },
};

const OUTCOMES = [
  { value: "Decision Maker", label: "DM", color: EMERALD, icon: User, desc: "Spoke with decision maker" },
  { value: "Gatekeeper", label: "Gatekeeper", color: BLUE, icon: Shield, desc: "Spoke with gatekeeper" },
  { value: "No Answer", label: "No Answer", color: MUTED, icon: Phone, desc: "No one picked up" },
  { value: "Qualified", label: "Qualified", color: EMERALD_DARK, icon: Zap, desc: "Qualified opportunity" },
  { value: "Callback", label: "Callback", color: AMBER, icon: Calendar, desc: "Schedule callback" },
  { value: "Not Interested", label: "Not Interested", color: ERROR, icon: X, desc: "Not a fit" },
  { value: "NoAuthority", label: "Wrong Person", color: AMBER, icon: AlertTriangle, desc: "Not the decision maker" },
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

function TouchTimeline({ touchesCompleted, nextTouchDate, pipelineStatus, createdAt }: {
  touchesCompleted: number;
  nextTouchDate: string;
  pipelineStatus: string;
  createdAt: string;
}) {
  const now = new Date();
  const nextDate = new Date(nextTouchDate);
  const isDue = pipelineStatus === "ACTIVE" && nextDate <= now;
  const created = new Date(createdAt);

  function getScheduledDate(touchNum: number): string {
    const schedule = TOUCH_LABELS.find((t) => t.num === touchNum);
    if (!schedule) return "";
    const d = new Date(created);
    d.setDate(d.getDate() + schedule.day);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div className="flex items-center gap-1" data-testid="touch-timeline">
      {TOUCH_LABELS.map((touch) => {
        const Icon = touch.icon;
        const done = touch.num <= touchesCompleted;
        const current = touch.num === touchesCompleted + 1;
        const scheduledLabel = !done ? getScheduledDate(touch.num) : "";
        const dueLabel = current && isDue ? " - DUE" : current ? ` - ${scheduledLabel}` : "";
        return (
          <div key={touch.num} className="flex items-center gap-1">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background: done ? EMERALD : current && isDue ? ERROR : current ? AMBER : SUBTLE,
                border: `1.5px solid ${done ? EMERALD : current && isDue ? ERROR : current ? AMBER : BORDER}`,
              }}
              title={`Touch ${touch.num}: ${touch.label} (Day ${touch.day})${done ? " - Done" : dueLabel}`}
            >
              {done ? (
                <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#FFFFFF" }} />
              ) : (
                <Icon className="w-3.5 h-3.5" style={{ color: current ? "#FFFFFF" : MUTED }} />
              )}
            </div>
            {touch.num < 6 && (
              <div
                className="w-3 h-0.5"
                style={{ background: done ? EMERALD : BORDER }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function parseEmailContent(raw: string | null): { subject: string; body: string } {
  if (!raw) return { subject: "", body: "" };
  const match = raw.match(/^Subject:\s*(.+?)(?:\r?\n){2}([\s\S]*)$/i);
  if (match) return { subject: match[1].trim(), body: match[2].trim() };
  return { subject: "Follow-up", body: raw.trim() };
}

function ContentSourceBadge({ source }: { source: string | null }) {
  if (!source || source === "ai_generated") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: "rgba(139,92,246,0.08)", color: "#8B5CF6", border: "1px solid rgba(139,92,246,0.2)" }}
        data-testid="badge-content-ai">
        <Sparkles className="w-3 h-3" /> AI Generated
      </span>
    );
  }
  if (source === "manually_edited") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: "rgba(59,130,246,0.08)", color: BLUE, border: "1px solid rgba(59,130,246,0.2)" }}
        data-testid="badge-content-edited">
        <Pencil className="w-3 h-3" /> Edited
      </span>
    );
  }
  if (source === "from_template") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: "rgba(16,185,129,0.08)", color: EMERALD, border: "1px solid rgba(16,185,129,0.2)" }}
        data-testid="badge-content-template">
        <FileText className="w-3 h-3" /> From Template
      </span>
    );
  }
  return null;
}

function EmailEditor({
  item,
  touchNumber,
  content,
  onClose,
}: {
  item: OutreachItem;
  touchNumber: number;
  content: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const parsed = parseEmailContent(content);
  const [subject, setSubject] = useState(parsed.subject);
  const [body, setBody] = useState(parsed.body);
  const [templateName, setTemplateName] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);

  const { data: templates } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/email/templates"],
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/outreach/${item.id}/content`, {
        touchNumber,
        subject,
        body,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach"] });
      toast({ title: "Content saved", description: `Touch ${touchNumber} content updated.` });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/email/templates", {
        name: templateName,
        subject,
        body,
        touchNumber,
        source: "saved_template",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/templates"] });
      setShowSaveTemplate(false);
      setTemplateName("");
      toast({ title: "Template saved", description: `"${templateName}" saved for reuse.` });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async (templateId: number) => {
      await apiRequest("POST", `/api/outreach/${item.id}/apply-template`, {
        templateId,
        touchNumber,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach"] });
      toast({ title: "Template applied", description: `Template loaded into Touch ${touchNumber}.` });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/email/templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const relevantTemplates = templates?.filter(
    (t) => !t.touchNumber || t.touchNumber === touchNumber
  ) || [];

  return (
    <div className="rounded-lg p-4 mt-2 space-y-3" style={{ background: "#FFFFFF", border: `1.5px solid ${BLUE}` }} data-testid={`editor-touch-${touchNumber}-${item.id}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: TEXT }}>
          <Pencil className="w-3.5 h-3.5" style={{ color: BLUE }} /> Edit Touch {touchNumber} Email
        </span>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" data-testid={`button-close-editor-${touchNumber}-${item.id}`}>
          <X className="w-4 h-4" style={{ color: MUTED }} />
        </button>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: MUTED }}>Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full text-xs px-3 py-2 rounded-md"
          style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFFFFF", outline: "none" }}
          data-testid={`input-subject-${touchNumber}-${item.id}`}
        />
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: MUTED }}>Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="w-full text-xs px-3 py-2 rounded-md resize-y font-sans leading-relaxed"
          style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFFFFF", outline: "none" }}
          data-testid={`input-body-${touchNumber}-${item.id}`}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !subject || !body}
          className="gap-1 text-xs h-7"
          style={{ background: EMERALD, color: "#FFFFFF" }}
          data-testid={`button-save-content-${touchNumber}-${item.id}`}
        >
          {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save Changes
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSaveTemplate(!showSaveTemplate)}
          className="gap-1 text-xs h-7"
          style={{ borderColor: "rgba(139,92,246,0.3)", color: "#8B5CF6" }}
          data-testid={`button-toggle-save-template-${touchNumber}-${item.id}`}
        >
          <FileText className="w-3 h-3" /> Save as Template
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowLoadTemplate(!showLoadTemplate)}
          className="gap-1 text-xs h-7"
          style={{ borderColor: "rgba(16,185,129,0.3)", color: EMERALD }}
          data-testid={`button-toggle-load-template-${touchNumber}-${item.id}`}
        >
          <FileText className="w-3 h-3" /> Load Template {relevantTemplates.length > 0 && `(${relevantTemplates.length})`}
        </Button>
      </div>

      {showSaveTemplate && (
        <div className="flex items-center gap-2 p-2 rounded-md" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }} data-testid={`save-template-panel-${touchNumber}-${item.id}`}>
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Template name..."
            className="flex-1 text-xs px-2 py-1.5 rounded-md"
            style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#FFFFFF", outline: "none" }}
            autoFocus
            data-testid={`input-template-name-${touchNumber}-${item.id}`}
          />
          <Button
            size="sm"
            disabled={saveTemplateMutation.isPending || !templateName}
            onClick={() => saveTemplateMutation.mutate()}
            className="gap-1 text-xs h-7"
            style={{ background: "#8B5CF6", color: "#FFFFFF" }}
            data-testid={`button-confirm-save-template-${touchNumber}-${item.id}`}
          >
            {saveTemplateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </Button>
        </div>
      )}

      {showLoadTemplate && (
        <div className="p-2 rounded-md space-y-1.5" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }} data-testid={`load-template-panel-${touchNumber}-${item.id}`}>
          {relevantTemplates.length === 0 ? (
            <p className="text-xs text-center py-2" style={{ color: MUTED }}>No saved templates yet.</p>
          ) : (
            relevantTemplates.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-2 rounded-md hover:bg-white" style={{ border: `1px solid ${BORDER}` }} data-testid={`template-option-${t.id}`}>
                <div className="flex-1 min-w-0 mr-2">
                  <div className="text-xs font-semibold truncate" style={{ color: TEXT }}>{t.name}</div>
                  <div className="text-[10px] truncate" style={{ color: MUTED }}>Subject: {t.subject}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSubject(t.subject);
                      setBody(t.body);
                      setShowLoadTemplate(false);
                      toast({ title: "Template loaded", description: `"${t.name}" loaded into editor. Save Changes to apply.` });
                    }}
                    className="gap-1 text-xs h-6"
                    style={{ borderColor: "rgba(16,185,129,0.3)", color: EMERALD }}
                    data-testid={`button-use-template-${t.id}`}
                  >
                    Use
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyTemplateMutation.mutate(t.id)}
                    disabled={applyTemplateMutation.isPending}
                    className="gap-1 text-xs h-6"
                    style={{ borderColor: "rgba(59,130,246,0.3)", color: BLUE }}
                    data-testid={`button-apply-template-${t.id}`}
                  >
                    Apply
                  </Button>
                  <button
                    onClick={() => deleteTemplateMutation.mutate(t.id)}
                    className="p-1 rounded hover:bg-red-50"
                    data-testid={`button-delete-template-${t.id}`}
                  >
                    <Trash2 className="w-3 h-3" style={{ color: ERROR }} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TrackingBadge({ send }: { send: EmailSendRecord }) {
  if (send.status === "deferred") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{ background: "rgba(245,158,11,0.08)", color: "#F59E0B", border: `1px solid rgba(245,158,11,0.3)` }}
        title={(send as any).deferReason || "Deferred -- daily limit reached"}
        data-testid={`badge-deferred-${send.id}`}
      >
        <Clock className="w-3 h-3" /> Deferred
      </span>
    );
  }
  if (send.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{ background: "rgba(239,68,68,0.08)", color: ERROR, border: `1px solid rgba(239,68,68,0.3)` }}
        title={send.errorMessage || "Send failed"}
        data-testid={`badge-failed-${send.id}`}
      >
        <MailX className="w-3 h-3" /> Failed
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{ background: "rgba(16,185,129,0.08)", color: EMERALD, border: `1px solid rgba(16,185,129,0.3)` }}
        data-testid={`badge-sent-${send.id}`}
      >
        <MailCheck className="w-3 h-3" /> {send.sentVia === "auto" ? "Auto-Sent" : "Sent"}
      </span>
      {send.openCount > 0 ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: "rgba(59,130,246,0.08)", color: BLUE, border: `1px solid rgba(59,130,246,0.3)` }}
          title={send.firstOpenedAt ? `First opened: ${new Date(send.firstOpenedAt).toLocaleString()}` : ""}
          data-testid={`badge-opened-${send.id}`}
        >
          <Eye className="w-3 h-3" /> Opened ({send.openCount})
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: SUBTLE, color: MUTED, border: `1px solid ${BORDER}` }}
          data-testid={`badge-not-opened-${send.id}`}
        >
          <Eye className="w-3 h-3" /> Not Opened
        </span>
      )}
      {send.clickCount > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: "rgba(168,85,247,0.08)", color: "#A855F7", border: `1px solid rgba(168,85,247,0.3)` }}
          title={send.firstClickedAt ? `First click: ${new Date(send.firstClickedAt).toLocaleString()}` : ""}
          data-testid={`badge-clicked-${send.id}`}
        >
          <MousePointer className="w-3 h-3" /> {send.clickCount} clicks
        </span>
      )}
      {send.replyDetectedAt && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: "rgba(16,185,129,0.08)", color: EMERALD, border: `1px solid rgba(16,185,129,0.3)` }}
          title={`Reply detected: ${new Date(send.replyDetectedAt).toLocaleString()}`}
          data-testid={`badge-replied-${send.id}`}
        >
          <MessageSquareReply className="w-3 h-3" /> Replied
        </span>
      )}
    </div>
  );
}

function SendEmailButton({
  item,
  touchNumber,
  existingSend,
}: {
  item: OutreachItem;
  touchNumber: number;
  existingSend?: EmailSendRecord;
}) {
  const { toast } = useToast();
  const [recipientEmail, setRecipientEmail] = useState("");
  const [showInput, setShowInput] = useState(false);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/email/send", {
        outreachPipelineId: item.id,
        touchNumber,
        recipientEmail,
        recipientName: item.contactName || undefined,
        companyId: item.companyId,
        companyName: item.companyName,
      });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/sends", item.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/quota"] });
      setShowInput(false);
      toast({ title: "Email sent", description: `Touch ${touchNumber} email sent to ${recipientEmail}` });
    },
    onError: (err: any) => {
      const msg = err.message || "Unknown error";
      const isDeferred = msg.toLowerCase().includes("daily limit");
      toast({
        title: isDeferred ? "Daily limit reached" : "Send failed",
        description: isDeferred ? "This email has been deferred. It will be eligible to send when the daily counter resets." : msg,
        variant: "destructive",
      });
    },
  });

  if (existingSend && existingSend.status === "sent") {
    return <TrackingBadge send={existingSend} />;
  }

  if (existingSend && (existingSend.status === "failed" || existingSend.status === "deferred")) {
    return (
      <div className="flex items-center gap-2">
        <TrackingBadge send={existingSend} />
        <button
          onClick={() => setShowInput(true)}
          className="text-[10px] font-semibold underline"
          style={{ color: EMERALD }}
          data-testid={`button-retry-send-${touchNumber}-${item.id}`}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!showInput) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowInput(true)}
        className="gap-1 text-xs h-7"
        style={{ borderColor: "rgba(16,185,129,0.3)", color: EMERALD }}
        data-testid={`button-send-email-${touchNumber}-${item.id}`}
      >
        <Send className="w-3 h-3" /> Send
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <input
        type="email"
        value={recipientEmail}
        onChange={(e) => setRecipientEmail(e.target.value)}
        placeholder="recipient@email.com"
        className="text-xs px-2 py-1.5 rounded-md flex-1"
        style={{ border: `1px solid ${BORDER}`, outline: "none", color: TEXT, background: "#FFFFFF" }}
        autoFocus
        data-testid={`input-recipient-${touchNumber}-${item.id}`}
      />
      <Button
        size="sm"
        disabled={sendMutation.isPending || !recipientEmail}
        onClick={() => sendMutation.mutate()}
        className="gap-1 text-xs h-7"
        style={{ background: EMERALD, color: "#FFFFFF" }}
        data-testid={`button-confirm-send-${touchNumber}-${item.id}`}
      >
        {sendMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
        Send
      </Button>
      <button
        onClick={() => setShowInput(false)}
        className="text-xs"
        style={{ color: MUTED }}
        data-testid={`button-cancel-send-${touchNumber}-${item.id}`}
      >
        Cancel
      </button>
    </div>
  );
}

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

function CallTouchPanel({
  item,
  touchNumber,
  companyData,
  onOutcomeLogged,
}: {
  item: OutreachItem;
  touchNumber: number;
  companyData: TodayCompany | null;
  onOutcomeLogged: (outcome: string, extras?: { notes?: string; gatekeeper_name?: string }) => void;
}) {
  const { getToken } = useAuth();
  const token = getToken();
  const { toast } = useToast();
  const [showScripts, setShowScripts] = useState(false);
  const [lastCallId, setLastCallId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  const callPhone = companyData?.offer_dm_phone || companyData?.phone || "";
  const askFor = companyData?.offer_dm_name
    ? `${companyData.offer_dm_name}${companyData.offer_dm_title ? ` (${companyData.offer_dm_title})` : ""}`
    : "Safety Manager / Site Superintendent";

  const logCallMutation = useMutation({
    mutationFn: async (data: { company_name: string; outcome: string; notes?: string; gatekeeper_name?: string }) => {
      const res = await apiRequest("POST", "/api/calls/log", data);
      return res.json();
    },
    onSuccess: (resData, vars) => {
      if (resData?.call_id) {
        setLastCallId(resData.call_id);
      }
      const fb = SIGNAL_MAP[vars.outcome];
      toast({
        title: fb?.title || `Signal: ${vars.outcome}`,
        description: fb?.description || `${vars.company_name} logged.`,
        duration: 2500,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to log call",
        description: err.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const PROMPTED_OUTCOMES = ["Gatekeeper", "Qualified", "Callback"];

  const handleOutcome = (outcome: string, extras?: { notes?: string; gatekeeper_name?: string }) => {
    if (PROMPTED_OUTCOMES.includes(outcome)) {
      onOutcomeLogged(outcome, extras);
      return;
    }
    logCallMutation.mutate({
      company_name: item.companyName,
      outcome,
      ...extras,
    });
    onOutcomeLogged(outcome, extras);
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

  return (
    <div className="space-y-3 mt-2" data-testid={`call-panel-${touchNumber}-${item.id}`}>
      {companyData && (
        <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Contact</span>
            <div className="flex gap-1.5">
              {callPhone && <CopyButton text={callPhone} label="Phone" id={`phone-${item.id}`} />}
              {companyData.offer_dm_email && <CopyButton text={companyData.offer_dm_email} label="Email" id={`email-${item.id}`} />}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5" style={{ color: EMERALD }} />
              <span className="text-sm font-semibold" style={{ color: TEXT }} data-testid={`text-ask-for-${item.id}`}>
                Ask for: {askFor}
              </span>
            </div>
            {callPhone && (
              <a
                href={`tel:${callPhone.replace(/\s/g, "")}`}
                className="flex items-center gap-2 text-sm font-bold"
                style={{ color: EMERALD }}
                data-testid={`link-call-phone-${item.id}`}
              >
                <Phone className="w-4 h-4" /> {callPhone}
              </a>
            )}
            {companyData.offer_dm_email && (
              <a
                href={`mailto:${companyData.offer_dm_email}`}
                className="flex items-center gap-2 text-xs"
                style={{ color: BLUE }}
              >
                <Mail className="w-3.5 h-3.5" /> {companyData.offer_dm_email}
              </a>
            )}
            {companyData.gatekeeper_name && (
              <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" style={{ color: AMBER }} />
                <span className="text-xs" style={{ color: MUTED }}>
                  Gatekeeper: <span style={{ color: TEXT, fontWeight: 500 }}>{companyData.gatekeeper_name}</span>
                </span>
              </div>
            )}
            {companyData.times_called > 0 && (
              <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
                <span>Called {companyData.times_called}x</span>
                {companyData.last_outcome && <span>Last: {companyData.last_outcome}</span>}
              </div>
            )}
            {companyData.city && (
              <span className="flex items-center gap-1 text-xs" style={{ color: MUTED }}>
                <MapPin className="w-3 h-3" /> {companyData.city}
              </span>
            )}
            {companyData.website && (
              <a
                href={companyData.website.startsWith("http") ? companyData.website : `https://${companyData.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs"
                style={{ color: BLUE }}
              >
                <Globe className="w-3 h-3" /> Website
              </a>
            )}
          </div>
        </div>
      )}

      {companyData && (
        <div>
          <button
            onClick={() => setShowScripts(!showScripts)}
            className="flex items-center gap-2 text-xs font-semibold mb-2"
            style={{ color: showScripts ? EMERALD : MUTED }}
            data-testid={`button-toggle-scripts-${item.id}`}
          >
            <FileText className="w-3.5 h-3.5" />
            {showScripts ? "Hide Scripts" : "Show Call Scripts"}
            {showScripts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showScripts && (
            <div className="space-y-2">
              <ScriptBlock title="Call Opener" text={companyData.playbook_opener} copyId={`opener-${item.id}`} />
              <ScriptBlock title="Gatekeeper Script" text={companyData.playbook_gatekeeper} copyId={`gatekeeper-${item.id}`} />
              <ScriptBlock title="Voicemail" text={companyData.playbook_voicemail} copyId={`voicemail-${item.id}`} />
              <ScriptBlock title="Follow-up Text" text={companyData.playbook_followup} copyId={`followup-${item.id}`} />
            </div>
          )}
        </div>
      )}

      {companyData?.rank_reason && (
        <div className="rounded-lg p-3" style={{ background: "rgba(16,185,129,0.03)", border: `1px solid rgba(16,185,129,0.15)` }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Brain className="w-3.5 h-3.5" style={{ color: EMERALD }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EMERALD }}>Intel</span>
          </div>
          <p className="text-xs" style={{ color: TEXT }}>{companyData.rank_reason}</p>
        </div>
      )}

      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: MUTED }}>
          Log Call Outcome
        </div>
        <div className="grid grid-cols-4 gap-1.5" data-testid={`outcomes-${item.id}`}>
          {OUTCOMES.map((o) => {
            const Icon = o.icon;
            return (
              <button
                key={o.value}
                onClick={() => handleOutcome(o.value)}
                disabled={logCallMutation.isPending}
                className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-xs font-semibold transition-colors"
                style={{
                  background: `${o.color}10`,
                  color: o.color,
                  border: `1px solid ${o.color}30`,
                }}
                data-testid={`button-outcome-${o.value.toLowerCase().replace(/\s+/g, "-")}-${item.id}`}
              >
                <Icon className="w-4 h-4" />
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {lastCallId && (
        <div className="rounded-lg p-3" style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Mic className="w-3.5 h-3.5" style={{ color: MUTED }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Recording</span>
          </div>
          {uploaded ? (
            <div className="flex items-center gap-2 text-xs" style={{ color: EMERALD }}>
              <CheckCircle2 className="w-4 h-4" /> Recording uploaded and being analyzed
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: BLUE }}>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleRecordingUpload(file);
                }}
                data-testid={`input-recording-${item.id}`}
              />
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {uploading ? "Uploading..." : "Upload call recording (optional)"}
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function OutreachCard({
  item,
  onStatusChange,
  isUpdating,
  emailSettings,
  companyData,
  onShowGkPrompt,
  onShowQualPrompt,
  onShowCbPrompt,
}: {
  item: OutreachItem;
  onStatusChange: (id: number, status: string) => void;
  isUpdating: boolean;
  emailSettings: any;
  companyData: TodayCompany | null;
  onShowGkPrompt: (companyName: string, gkName: string) => void;
  onShowQualPrompt: (companyName: string) => void;
  onShowCbPrompt: (companyName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingTouch, setEditingTouch] = useState<number | null>(null);
  const statusStyle = STATUS_COLORS[item.pipelineStatus] || STATUS_COLORS.ACTIVE;
  const nextTouch = item.touchesCompleted + 1;
  const nextTouchInfo = TOUCH_LABELS[item.touchesCompleted] || null;
  const nextDate = new Date(item.nextTouchDate);
  const isOverdue = item.pipelineStatus === "ACTIVE" && nextDate <= new Date();

  const { data: emailSends } = useQuery<EmailSendRecord[]>({
    queryKey: ["/api/email/sends", item.id],
    enabled: expanded,
  });

  const sendsByTouch: Record<number, EmailSendRecord> = {};
  if (emailSends) {
    for (const send of emailSends) {
      if (!sendsByTouch[send.touchNumber] || new Date(send.sentAt) > new Date(sendsByTouch[send.touchNumber].sentAt)) {
        sendsByTouch[send.touchNumber] = send;
      }
    }
  }

  function getTouchContent(touchNum: number): string | null {
    switch (touchNum) {
      case 1: return item.touch1Email;
      case 2: return item.touch2Call;
      case 3: return item.touch3Email;
      case 4: return item.touch4Call;
      case 5: return item.touch5Email;
      case 6: return item.touch6Call;
      default: return null;
    }
  }

  const handleCallOutcome = useCallback((outcome: string, extras?: { notes?: string; gatekeeper_name?: string }) => {
    if (outcome === "Gatekeeper") {
      onShowGkPrompt(item.companyName, companyData?.gatekeeper_name || "");
      return;
    }
    if (outcome === "Qualified") {
      onShowQualPrompt(item.companyName);
      return;
    }
    if (outcome === "Callback") {
      onShowCbPrompt(item.companyName);
      return;
    }
  }, [item.companyName, companyData, onShowGkPrompt, onShowQualPrompt, onShowCbPrompt]);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF" }}
      data-testid={`outreach-card-${item.id}`}
    >
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        data-testid={`outreach-card-header-${item.id}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className="font-semibold text-sm truncate" style={{ color: TEXT }} data-testid={`text-company-${item.id}`}>
                {item.companyName}
              </h3>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                style={{
                  background: statusStyle.bg,
                  color: statusStyle.text,
                  border: `1px solid ${statusStyle.border}`,
                }}
                data-testid={`badge-status-${item.id}`}
              >
                {item.pipelineStatus.replace("_", " ")}
              </span>
              {item.pipelineStatus === "RESPONDED" && item.respondedVia === "reply_detected" && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background: "rgba(16,185,129,0.08)", color: EMERALD, border: `1px solid rgba(16,185,129,0.3)` }}
                  title={item.respondedAt ? `Reply detected: ${new Date(item.respondedAt).toLocaleString()}` : ""}
                  data-testid={`badge-auto-replied-${item.id}`}
                >
                  <MessageSquareReply className="w-3 h-3" /> Auto-Detected
                </span>
              )}
              {isOverdue && item.pipelineStatus === "ACTIVE" && (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                  style={{ background: "rgba(245,158,11,0.1)", color: AMBER, border: `1px solid ${AMBER}` }}
                >
                  Due
                </span>
              )}
              {nextTouchInfo && item.pipelineStatus === "ACTIVE" && (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={{
                    background: nextTouchInfo.isEmail ? "rgba(59,130,246,0.06)" : "rgba(16,185,129,0.06)",
                    color: nextTouchInfo.isEmail ? BLUE : EMERALD,
                    border: `1px solid ${nextTouchInfo.isEmail ? "rgba(59,130,246,0.2)" : "rgba(16,185,129,0.2)"}`,
                  }}
                >
                  Next: {nextTouchInfo.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
              {item.contactName && (
                <span data-testid={`text-contact-${item.id}`}>{item.contactName}</span>
              )}
              <span>Touch {Math.min(item.touchesCompleted, 6)}/6</span>
              {nextTouchInfo && item.pipelineStatus === "ACTIVE" && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Day {nextTouchInfo.day}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TouchTimeline touchesCompleted={item.touchesCompleted} nextTouchDate={item.nextTouchDate} pipelineStatus={item.pipelineStatus} createdAt={item.createdAt} />
            {expanded ? (
              <ChevronUp className="w-4 h-4" style={{ color: MUTED }} />
            ) : (
              <ChevronDown className="w-4 h-4" style={{ color: MUTED }} />
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="p-4 space-y-3">
            {TOUCH_LABELS.map((touch) => {
              const content = getTouchContent(touch.num);
              const done = touch.num <= item.touchesCompleted;
              const current = touch.num === nextTouch && item.pipelineStatus === "ACTIVE";
              const Icon = touch.icon;
              const existingSend = sendsByTouch[touch.num];
              const isCallTouch = !touch.isEmail;
              return (
                <div
                  key={touch.num}
                  className="rounded-lg p-3"
                  style={{
                    background: done ? "rgba(16,185,129,0.03)" : current ? "rgba(245,158,11,0.03)" : SUBTLE,
                    border: `1px solid ${done ? "rgba(16,185,129,0.15)" : current ? "rgba(245,158,11,0.2)" : BORDER}`,
                  }}
                  data-testid={`touch-${touch.num}-${item.id}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5" style={{ color: done ? EMERALD : current ? AMBER : MUTED }} />
                      <span className="text-xs font-semibold" style={{ color: done ? EMERALD : current ? AMBER : TEXT }}>
                        Touch {touch.num} -- {touch.label} (Day {touch.day})
                      </span>
                      {done && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: EMERALD }} />}
                      {current && (() => {
                        const nextDate = new Date(item.nextTouchDate);
                        const isDue = nextDate <= new Date();
                        return isDue ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.1)", color: ERROR }} data-testid={`badge-due-${item.id}`}>DUE</span>
                        ) : (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.1)", color: AMBER }} data-testid={`badge-scheduled-${item.id}`}>
                            <Clock className="w-3 h-3 inline mr-0.5" style={{ verticalAlign: "middle" }} />
                            {nextDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        );
                      })()}
                    </div>
                    {touch.isEmail && content && (
                      <div className="flex items-center gap-1.5">
                        {!done && item.pipelineStatus === "ACTIVE" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingTouch(editingTouch === touch.num ? null : touch.num)}
                            className="gap-1 text-xs h-7"
                            style={{ borderColor: "rgba(59,130,246,0.3)", color: BLUE }}
                            data-testid={`button-edit-touch-${touch.num}-${item.id}`}
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </Button>
                        )}
                        {emailSettings && (
                          <SendEmailButton
                            item={item}
                            touchNumber={touch.num}
                            existingSend={existingSend}
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {touch.isEmail && content && (
                    <div className="mb-1">
                      <ContentSourceBadge source={item.contentSource} />
                    </div>
                  )}
                  {existingSend && (
                    <div className="flex items-center gap-2 mb-1.5 text-[10px]" style={{ color: MUTED }}>
                      Sent to {existingSend.contactEmail} on {new Date(existingSend.sentAt).toLocaleString()}
                      {existingSend.firstOpenedAt && (
                        <span className="flex items-center gap-0.5" style={{ color: BLUE }}>
                          <Eye className="w-3 h-3" /> First opened {new Date(existingSend.firstOpenedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )}
                  {editingTouch === touch.num && touch.isEmail ? (
                    <EmailEditor
                      item={item}
                      touchNumber={touch.num}
                      content={content}
                      onClose={() => setEditingTouch(null)}
                    />
                  ) : isCallTouch && current && item.pipelineStatus === "ACTIVE" ? (
                    <CallTouchPanel
                      item={item}
                      touchNumber={touch.num}
                      companyData={companyData}
                      onOutcomeLogged={handleCallOutcome}
                    />
                  ) : content && (
                    <pre
                      className="text-xs whitespace-pre-wrap font-sans leading-relaxed"
                      style={{ color: TEXT, opacity: done ? 0.7 : 1 }}
                      data-testid={`text-touch-content-${touch.num}-${item.id}`}
                    >
                      {content}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>

          {item.pipelineStatus === "ACTIVE" && (
            <div className="px-4 pb-4 flex gap-2" data-testid={`actions-${item.id}`}>
              <Button
                variant="outline"
                size="sm"
                disabled={isUpdating}
                onClick={() => onStatusChange(item.id, "RESPONDED")}
                className="gap-1 text-xs"
                style={{ borderColor: "rgba(59,130,246,0.3)", color: BLUE }}
                data-testid={`button-responded-${item.id}`}
              >
                <ThumbsUp className="w-3 h-3" />
                Responded
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isUpdating}
                onClick={() => onStatusChange(item.id, "NOT_INTERESTED")}
                className="gap-1 text-xs"
                style={{ borderColor: "rgba(239,68,68,0.3)", color: ERROR }}
                data-testid={`button-not-interested-${item.id}`}
              >
                <XCircle className="w-3 h-3" />
                Not Interested
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isUpdating}
                onClick={() => onStatusChange(item.id, "COMPLETED")}
                className="gap-1 text-xs"
                style={{ borderColor: BORDER, color: MUTED }}
                data-testid={`button-complete-${item.id}`}
              >
                <CheckCircle2 className="w-3 h-3" />
                Complete
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ActiveOutreachPage() {
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [showGkPrompt, setShowGkPrompt] = useState(false);
  const [gkCompany, setGkCompany] = useState("");
  const [gkName, setGkName] = useState("");

  const [showQualPrompt, setShowQualPrompt] = useState(false);
  const [qualCompany, setQualCompany] = useState("");
  const [qualNotes, setQualNotes] = useState("");

  const [showCbPrompt, setShowCbPrompt] = useState(false);
  const [cbCompany, setCbCompany] = useState("");
  const [cbDate, setCbDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [cbNotes, setCbNotes] = useState("");

  const { data, isLoading } = useQuery<OutreachResponse>({
    queryKey: ["/api/outreach/pipeline"],
    enabled: !!token,
    refetchInterval: 60000,
  });

  const { data: todayData } = useQuery<{ companies: TodayCompany[]; count: number }>({
    queryKey: ["/api/today-list"],
    enabled: !!token,
  });

  const { data: emailSettings } = useQuery({
    queryKey: ["/api/email/settings"],
    enabled: !!token,
  });

  const { data: sendQuota } = useQuery<{
    providerType: string;
    providerLabel: string;
    effectiveLimit: number;
    sentToday: number;
    remaining: number;
    sendIntervalMs: number;
    isAtLimit: boolean;
  } | null>({
    queryKey: ["/api/email/quota"],
    enabled: !!token,
    refetchInterval: 60000,
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/run"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/pipeline"] });
      toast({ title: "Outreach engine completed", description: "Pipeline populated and advanced." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to run outreach engine", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/outreach/pipeline/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/pipeline"] });
      toast({ title: "Status updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const logCallForPrompt = useMutation({
    mutationFn: async (data: { company_name: string; outcome: string; notes?: string; gatekeeper_name?: string }) => {
      const res = await apiRequest("POST", "/api/calls/log", data);
      return res.json();
    },
    onSuccess: (_, vars) => {
      const fb = SIGNAL_MAP[vars.outcome];
      toast({
        title: fb?.title || `Signal: ${vars.outcome}`,
        description: fb?.description || `${vars.company_name} logged.`,
        duration: 2500,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today-list"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to log call", description: err.message, variant: "destructive" });
    },
  });

  const companyMap = new Map<string, TodayCompany>();
  if (todayData?.companies) {
    for (const c of todayData.companies) {
      const normalized = c.company_name.toLowerCase().trim();
      companyMap.set(normalized, c);
    }
  }

  function findCompanyData(companyName: string): TodayCompany | null {
    return companyMap.get(companyName.toLowerCase().trim()) || null;
  }

  const submitGatekeeper = () => {
    logCallForPrompt.mutate({
      company_name: gkCompany,
      outcome: "Gatekeeper",
      gatekeeper_name: gkName || undefined,
    });
    setShowGkPrompt(false);
    setGkName("");
  };

  const submitQualified = () => {
    logCallForPrompt.mutate({
      company_name: qualCompany,
      outcome: "Qualified",
      notes: qualNotes || undefined,
    });
    setShowQualPrompt(false);
    setQualNotes("");
  };

  const submitCallback = () => {
    const notes = `Callback date: ${cbDate}${cbNotes ? `. ${cbNotes}` : ""}`;
    logCallForPrompt.mutate({
      company_name: cbCompany,
      outcome: "Callback",
      notes,
    });
    setShowCbPrompt(false);
    setCbNotes("");
  };

  const stats = data?.stats || { total: 0, active: 0, completed: 0, responded: 0, notInterested: 0 };
  const items = data?.items || [];
  const filteredItems = statusFilter === "all" ? items : items.filter((i) => i.pipelineStatus === statusFilter);

  const statCards = [
    { label: "Active", value: stats.active, color: EMERALD },
    { label: "Completed", value: stats.completed, color: MUTED },
    { label: "Responded", value: stats.responded, color: BLUE },
    { label: "Not Interested", value: stats.notInterested, color: ERROR },
  ];

  const filterOptions = [
    { value: "all", label: "All" },
    { value: "ACTIVE", label: "Active" },
    { value: "COMPLETED", label: "Completed" },
    { value: "RESPONDED", label: "Responded" },
    { value: "NOT_INTERESTED", label: "Not Interested" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#FFFFFF" }}>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/machine/dashboard")}
            className="gap-1"
            style={{ color: MUTED }}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: TEXT }} data-testid="text-page-title">
              Outreach
            </h1>
            <p className="text-sm mt-1" style={{ color: MUTED }}>
              Execute emails and calls from your 6-touch outreach sequences
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/machine/email-settings")}
              className="gap-1.5 text-xs"
              style={{ borderColor: BORDER, color: emailSettings ? EMERALD : MUTED }}
              data-testid="button-email-settings"
            >
              <Settings className="w-3.5 h-3.5" />
              Email Settings
              {emailSettings && (
                <CheckCircle2 className="w-3 h-3" style={{ color: EMERALD }} />
              )}
            </Button>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="gap-2 text-sm font-semibold"
              style={{ background: EMERALD, color: "#FFFFFF" }}
              data-testid="button-run-outreach"
            >
              {runMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {runMutation.isPending ? "Running..." : "Run Outreach Engine"}
            </Button>
          </div>
        </div>

        {sendQuota && emailSettings && (
          <div
            className="rounded-xl p-3 flex items-center justify-between mb-4"
            style={{
              background: sendQuota.isAtLimit ? "rgba(239,68,68,0.04)" : SUBTLE,
              border: `1px solid ${sendQuota.isAtLimit ? "rgba(239,68,68,0.2)" : BORDER}`,
            }}
            data-testid="outreach-quota-bar"
          >
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" style={{ color: sendQuota.isAtLimit ? ERROR : EMERALD }} />
              <span className="text-xs font-semibold" style={{ color: TEXT }} data-testid="text-outreach-quota">
                {sendQuota.sentToday} / {sendQuota.effectiveLimit} emails sent today
              </span>
              <span className="text-[10px]" style={{ color: MUTED }}>
                ({sendQuota.remaining} remaining)
              </span>
              {sendQuota.isAtLimit && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "rgba(239,68,68,0.08)", color: ERROR }}>
                  LIMIT REACHED
                </span>
              )}
            </div>
            <span className="text-[10px]" style={{ color: MUTED }}>
              {sendQuota.providerLabel} &middot; {(sendQuota.sendIntervalMs / 1000).toFixed(0)}s pacing
            </span>
          </div>
        )}

        {!emailSettings && (
          <div
            className="rounded-xl p-4 flex items-start gap-3 mb-6"
            style={{ background: "rgba(245,158,11,0.05)", border: `1px solid rgba(245,158,11,0.2)` }}
            data-testid="email-settings-warning"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: AMBER }} />
            <div>
              <p className="text-xs font-semibold" style={{ color: TEXT }}>Email sending not configured</p>
              <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
                Set up your SMTP connection in{" "}
                <button
                  onClick={() => navigate("/machine/email-settings")}
                  className="underline font-medium"
                  style={{ color: EMERALD }}
                  data-testid="link-email-settings"
                >
                  Email Settings
                </button>{" "}
                to send outreach emails directly from this page.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-3 mb-6" data-testid="stats-grid">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl p-4 text-center"
              style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
              data-testid={`stat-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</div>
              <div className="text-xs font-medium mt-1" style={{ color: MUTED }}>{card.label}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-4" data-testid="filter-tabs">
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className="px-4 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={{
                background: statusFilter === opt.value ? "rgba(16,185,129,0.08)" : SUBTLE,
                border: `1px solid ${statusFilter === opt.value ? "rgba(16,185,129,0.35)" : BORDER}`,
                color: statusFilter === opt.value ? EMERALD : TEXT,
              }}
              data-testid={`filter-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20" data-testid="loading-state">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
            <span className="ml-2 text-sm" style={{ color: MUTED }}>Loading pipeline...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div
            className="rounded-xl p-12 text-center"
            style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
            data-testid="empty-state"
          >
            <Send className="w-10 h-10 mx-auto mb-3" style={{ color: MUTED }} />
            <p className="text-sm font-medium" style={{ color: TEXT }}>No outreach sequences yet</p>
            <p className="text-xs mt-1" style={{ color: MUTED }}>
              Click "Run Outreach Engine" to generate sequences for qualified companies
            </p>
          </div>
        ) : (
          <div className="space-y-3" data-testid="pipeline-list">
            {filteredItems.map((item) => (
              <OutreachCard
                key={item.id}
                item={item}
                onStatusChange={(id, status) => statusMutation.mutate({ id, status })}
                isUpdating={statusMutation.isPending}
                emailSettings={emailSettings}
                companyData={findCompanyData(item.companyName)}
                onShowGkPrompt={(company, gk) => { setGkCompany(company); setGkName(gk); setShowGkPrompt(true); }}
                onShowQualPrompt={(company) => { setQualCompany(company); setShowQualPrompt(true); }}
                onShowCbPrompt={(company) => { setCbCompany(company); setShowCbPrompt(true); }}
              />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showGkPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setShowGkPrompt(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 w-80"
              style={{ background: "#FFFFFF", border: `1px solid ${BORDER}` }}
              data-testid="modal-gatekeeper"
            >
              <p className="text-sm font-bold mb-1" style={{ color: TEXT }}>Gatekeeper Name</p>
              <p className="text-xs mb-3" style={{ color: MUTED }}>{gkCompany}</p>
              <input
                autoFocus
                value={gkName}
                onChange={(e) => setGkName(e.target.value)}
                placeholder="Enter gatekeeper name..."
                className="w-full px-3 py-2 rounded-lg text-sm mb-4"
                style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }}
                onKeyDown={(e) => e.key === "Enter" && submitGatekeeper()}
                data-testid="input-gk-name"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => { setShowGkPrompt(false); setGkName(""); }}
                  className="flex-1 text-sm" variant="outline"
                  style={{ borderColor: BORDER, color: MUTED }}
                  data-testid="button-gk-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitGatekeeper}
                  className="flex-1 text-sm font-bold" style={{ background: BLUE, color: "#FFFFFF" }}
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
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setShowQualPrompt(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 w-80"
              style={{ background: "#FFFFFF", border: `1px solid ${BORDER}` }}
              data-testid="modal-qualified"
            >
              <p className="text-sm font-bold mb-1" style={{ color: TEXT }}>Qualified -- Quick Notes</p>
              <p className="text-xs mb-3" style={{ color: MUTED }}>{qualCompany}</p>
              <textarea
                autoFocus
                value={qualNotes}
                onChange={(e) => setQualNotes(e.target.value)}
                placeholder="Crew size? Timeline? Key details..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg text-sm mb-4 resize-none"
                style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }}
                data-testid="input-qual-notes"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => { setShowQualPrompt(false); setQualNotes(""); }}
                  className="flex-1 text-sm" variant="outline"
                  style={{ borderColor: BORDER, color: MUTED }}
                  data-testid="button-qual-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitQualified}
                  className="flex-1 text-sm font-bold" style={{ background: EMERALD_DARK, color: "#FFFFFF" }}
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
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setShowCbPrompt(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 w-80"
              style={{ background: "#FFFFFF", border: `1px solid ${BORDER}` }}
              data-testid="modal-callback"
            >
              <p className="text-sm font-bold mb-1" style={{ color: TEXT }}>Schedule Callback</p>
              <p className="text-xs mb-3" style={{ color: MUTED }}>{cbCompany}</p>
              <input
                type="date"
                value={cbDate}
                onChange={(e) => setCbDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm mb-3"
                style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }}
                data-testid="input-callback-date"
              />
              <input
                value={cbNotes}
                onChange={(e) => setCbNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="w-full px-3 py-2 rounded-lg text-sm mb-4"
                style={{ background: SUBTLE, color: TEXT, border: `1px solid ${BORDER}` }}
                onKeyDown={(e) => e.key === "Enter" && submitCallback()}
                data-testid="input-callback-notes"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => { setShowCbPrompt(false); setCbNotes(""); }}
                  className="flex-1 text-sm" variant="outline"
                  style={{ borderColor: BORDER, color: MUTED }}
                  data-testid="button-cb-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitCallback}
                  className="flex-1 text-sm font-bold" style={{ background: AMBER, color: TEXT }}
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
