import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
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

const TOUCH_LABELS = [
  { num: 1, label: "Email", icon: Mail, day: 1, isEmail: true },
  { num: 2, label: "Call", icon: Phone, day: 3, isEmail: false },
  { num: 3, label: "Email", icon: Mail, day: 5, isEmail: true },
  { num: 4, label: "Call", icon: Phone, day: 7, isEmail: false },
  { num: 5, label: "Email", icon: Mail, day: 10, isEmail: true },
  { num: 6, label: "Call", icon: Phone, day: 14, isEmail: false },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ACTIVE: { bg: "rgba(16,185,129,0.08)", text: EMERALD, border: "rgba(16,185,129,0.3)" },
  COMPLETED: { bg: "rgba(148,163,184,0.08)", text: MUTED, border: BORDER },
  RESPONDED: { bg: "rgba(59,130,246,0.08)", text: BLUE, border: "rgba(59,130,246,0.3)" },
  NOT_INTERESTED: { bg: "rgba(239,68,68,0.08)", text: ERROR, border: "rgba(239,68,68,0.3)" },
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
        title={(send as any).deferReason || "Deferred — daily limit reached"}
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

function OutreachCard({
  item,
  onStatusChange,
  isUpdating,
  emailSettings,
}: {
  item: OutreachItem;
  onStatusChange: (id: number, status: string) => void;
  isUpdating: boolean;
  emailSettings: any;
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
            </div>
            <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
              {item.contactName && (
                <span data-testid={`text-contact-${item.id}`}>{item.contactName}</span>
              )}
              <span>Touch {Math.min(item.touchesCompleted, 6)}/6</span>
              {nextTouchInfo && item.pipelineStatus === "ACTIVE" && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Next: {nextTouchInfo.label} (Day {nextTouchInfo.day})
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
                        Touch {touch.num} — {touch.label} (Day {touch.day})
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

  const { data, isLoading } = useQuery<OutreachResponse>({
    queryKey: ["/api/outreach/pipeline"],
    enabled: !!token,
    refetchInterval: 30000,
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
    refetchInterval: 30000,
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
              Active Outreach
            </h1>
            <p className="text-sm mt-1" style={{ color: MUTED }}>
              6-touch outreach sequences for qualified companies
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
