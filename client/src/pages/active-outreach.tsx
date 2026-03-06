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
  MessageSquare,
  XCircle,
  ThumbsUp,
  Send,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const AMBER = "#F59E0B";

interface OutreachItem {
  id: number;
  clientId: string;
  companyId: string;
  companyName: string;
  contactName: string | null;
  touch1Email: string | null;
  touch2Call: string | null;
  touch3Email: string | null;
  touch4Call: string | null;
  touch5Email: string | null;
  touch6Call: string | null;
  pipelineStatus: string;
  nextTouchDate: string;
  touchesCompleted: number;
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

const TOUCH_LABELS = [
  { num: 1, label: "Email", icon: Mail, day: 1 },
  { num: 2, label: "Call", icon: Phone, day: 3 },
  { num: 3, label: "Email", icon: Mail, day: 5 },
  { num: 4, label: "Call", icon: Phone, day: 7 },
  { num: 5, label: "Email", icon: Mail, day: 10 },
  { num: 6, label: "Call", icon: Phone, day: 14 },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ACTIVE: { bg: "rgba(16,185,129,0.08)", text: EMERALD, border: "rgba(16,185,129,0.3)" },
  COMPLETED: { bg: "rgba(148,163,184,0.08)", text: MUTED, border: BORDER },
  RESPONDED: { bg: "rgba(59,130,246,0.08)", text: "#3B82F6", border: "rgba(59,130,246,0.3)" },
  NOT_INTERESTED: { bg: "rgba(239,68,68,0.08)", text: "#EF4444", border: "rgba(239,68,68,0.3)" },
};

function TouchTimeline({ touchesCompleted }: { touchesCompleted: number }) {
  return (
    <div className="flex items-center gap-1" data-testid="touch-timeline">
      {TOUCH_LABELS.map((touch) => {
        const Icon = touch.icon;
        const done = touch.num <= touchesCompleted;
        const current = touch.num === touchesCompleted + 1;
        return (
          <div key={touch.num} className="flex items-center gap-1">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background: done ? EMERALD : current ? AMBER : SUBTLE,
                border: `1.5px solid ${done ? EMERALD : current ? AMBER : BORDER}`,
              }}
              title={`Touch ${touch.num}: ${touch.label} (Day ${touch.day})${done ? " - Done" : current ? " - Next" : ""}`}
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

function OutreachCard({
  item,
  onStatusChange,
  isUpdating,
}: {
  item: OutreachItem;
  onStatusChange: (id: number, status: string) => void;
  isUpdating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusStyle = STATUS_COLORS[item.pipelineStatus] || STATUS_COLORS.ACTIVE;
  const nextTouch = item.touchesCompleted + 1;
  const nextTouchInfo = TOUCH_LABELS[item.touchesCompleted] || null;
  const nextDate = new Date(item.nextTouchDate);
  const isOverdue = item.pipelineStatus === "ACTIVE" && nextDate <= new Date();

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
            <TouchTimeline touchesCompleted={item.touchesCompleted} />
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
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className="w-3.5 h-3.5" style={{ color: done ? EMERALD : current ? AMBER : MUTED }} />
                    <span className="text-xs font-semibold" style={{ color: done ? EMERALD : current ? AMBER : TEXT }}>
                      Touch {touch.num} — {touch.label} (Day {touch.day})
                    </span>
                    {done && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: EMERALD }} />}
                    {current && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.1)", color: AMBER }}>NEXT</span>}
                  </div>
                  {content && (
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
                style={{ borderColor: "rgba(59,130,246,0.3)", color: "#3B82F6" }}
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
                style={{ borderColor: "rgba(239,68,68,0.3)", color: "#EF4444" }}
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
    { label: "Responded", value: stats.responded, color: "#3B82F6" },
    { label: "Not Interested", value: stats.notInterested, color: "#EF4444" },
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
