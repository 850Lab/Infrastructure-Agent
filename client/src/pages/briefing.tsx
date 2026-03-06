import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Building2,
  Users,
  Phone,
  Clock,
  Play,
  Search,
  ArrowLeft,
  Zap,
  AlertCircle,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  BarChart3,
  X,
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";

interface BriefingAction {
  type: "CALL" | "ENRICH_DM" | "FOLLOWUP" | "RUN_PIPELINE";
  company_id?: string;
  company_name?: string;
  title: string;
  reason: string;
}

interface DailyBriefing {
  new_companies_24h: number;
  dms_found_24h: number;
  hot_followups_due_today: number;
  fresh_pool_count: number;
  today_list_count: number;
  recommended_actions: BriefingAction[];
  estimated_work_minutes: number;
  pipeline_ran_today: boolean;
  computed_at: number;
}

interface MachineAlertData {
  id: number;
  clientId: string;
  alertType: string;
  message: string;
  severity: string;
  resolved: number;
  createdAt: string;
}

function alertIcon(type: string) {
  switch (type) {
    case "title_performance_change": return TrendingUp;
    case "title_decline": return TrendingDown;
    case "authority_mismatch_spike": return ShieldAlert;
    case "query_performance_shift": return BarChart3;
    default: return AlertTriangle;
  }
}

function alertSeverityColor(severity: string) {
  switch (severity) {
    case "critical": return "#EF4444";
    case "warning": return "#F59E0B";
    default: return "#3B82F6";
  }
}

function alertTypeLabel(type: string) {
  switch (type) {
    case "title_performance_change": return "Performance Surge";
    case "title_decline": return "Performance Decline";
    case "authority_mismatch_spike": return "Authority Mismatch";
    case "query_performance_shift": return "Query Shift";
    default: return "Alert";
  }
}

interface MeResponse {
  email: string;
  machine_config: {
    machine_name: string;
    market: string;
    opportunity: string;
    decision_maker_focus: string;
    geo: string;
    industry_config_selected: string;
  } | null;
  needsOnboarding: boolean;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function actionIcon(type: BriefingAction["type"]) {
  switch (type) {
    case "CALL":
      return Phone;
    case "FOLLOWUP":
      return Clock;
    case "ENRICH_DM":
      return Search;
    case "RUN_PIPELINE":
      return Play;
  }
}

function actionColor(type: BriefingAction["type"]) {
  switch (type) {
    case "CALL":
      return EMERALD;
    case "FOLLOWUP":
      return "#F59E0B";
    case "ENRICH_DM":
      return "#3B82F6";
    case "RUN_PIPELINE":
      return TEXT;
  }
}

function actionButtonLabel(type: BriefingAction["type"]) {
  switch (type) {
    case "CALL":
      return "Open";
    case "FOLLOWUP":
      return "Open";
    case "ENRICH_DM":
      return "Enrich";
    case "RUN_PIPELINE":
      return "Run";
  }
}

export default function BriefingPage() {
  const { getToken, isAuthenticated } = useAuth();
  const token = getToken();
  const [, navigate] = useLocation();
  const [completedActions, setCompletedActions] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isAuthenticated) navigate("/login");

  }, [isAuthenticated, navigate]);

  const { data: me } = useQuery<MeResponse>({
    queryKey: ["/api/me"],
    enabled: !!token,
  });

  const { data: briefing, isLoading } = useQuery<DailyBriefing>({
    queryKey: ["/api/briefing"],
    enabled: !!token,
    refetchInterval: 60000,
  });

  const { data: alertsData } = useQuery<{ alerts: MachineAlertData[] }>({
    queryKey: ["/api/alerts", "unresolved"],
    queryFn: () => fetch("/api/alerts?unresolved=true", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()),
    enabled: !!token,
    refetchInterval: 60000,
  });

  const resolveAlertMutation = useMutation({
    mutationFn: (alertId: number) => apiRequest("POST", `/api/alerts/${alertId}/resolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts", "unresolved"] });
    },
  });

  const unresolvedAlerts = alertsData?.alerts || [];

  const { data: confidenceData } = useQuery<{
    confidence_score: number;
    explanation: string;
    components: {
      dm_name_rate: number;
      dm_email_rate: number;
      dm_phone_rate: number;
      website_rate: number;
      social_media_rate: number;
    };
    total_companies: number;
  }>({
    queryKey: ["/api/confidence"],
    enabled: !!token,
  });

  const runPipelineMutation = useMutation({
    mutationFn: (idx: number) => apiRequest("POST", "/api/action/run-pipeline").then(() => idx),
    onSuccess: (idx: number) => {
      setCompletedActions((prev) => new Set(prev).add(idx));
      queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
    },
  });

  const enrichDmsMutation = useMutation({
    mutationFn: (idx: number) => apiRequest("POST", "/api/action/enrich-dms").then(() => idx),
    onSuccess: (idx: number) => {
      setCompletedActions((prev) => new Set(prev).add(idx));
      queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
    },
  });

  const machineName = me?.machine_config?.machine_name || "Your Machine";

  function handleAction(action: BriefingAction, idx: number) {
    switch (action.type) {
      case "RUN_PIPELINE":
        runPipelineMutation.mutate(idx);
        break;
      case "ENRICH_DM":
        enrichDmsMutation.mutate(idx);
        break;
      case "CALL":
      case "FOLLOWUP":
        navigate("/machine/today");
        break;
    }
  }

  const statCards = briefing
    ? [
        {
          icon: Building2,
          label: "New Companies (24h)",
          value: briefing.new_companies_24h,
        },
        {
          icon: Users,
          label: "DMs Found (24h)",
          value: briefing.dms_found_24h,
        },
        {
          icon: AlertCircle,
          label: "Follow-ups Due",
          value: briefing.hot_followups_due_today,
        },
        {
          icon: Zap,
          label: "Fresh Pool",
          value: briefing.fresh_pool_count,
        },
      ]
    : [];

  return (
    <div
      className="min-h-screen px-4 py-8"
      style={{ background: "#FFFFFF" }}
    >
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <button
            onClick={() => navigate("/machine/dashboard")}
            className="flex items-center gap-1.5 text-sm font-medium mb-6 hover:opacity-70 transition-opacity"
            style={{ color: MUTED }}
            data-testid="button-back-to-dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
            Command Center
          </button>

          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "rgba(16,185,129,0.08)" }}
            >
              <div
                className="w-4 h-4 rounded-full"
                style={{ background: EMERALD }}
              />
            </div>
            <div>
              <h1
                className="text-xl font-bold"
                style={{ color: TEXT }}
                data-testid="text-briefing-greeting"
              >
                {getGreeting()}, <span style={{ color: EMERALD }}>{machineName}</span> is listening.
              </h1>
            </div>
          </div>

          <p
            className="text-sm font-mono ml-[52px] mb-8"
            style={{ color: MUTED }}
            data-testid="text-briefing-subtitle"
          >
            {briefing?.pipeline_ran_today
              ? "Pipeline ran today. Here's your daily briefing."
              : "Pipeline has not run today."}
          </p>
        </motion.div>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: MUTED }} />
          </div>
        )}

        {briefing && (
          <>
            <motion.div
              className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              data-testid="briefing-stats"
            >
              {statCards.map((card, i) => (
                <div
                  key={card.label}
                  className="rounded-xl p-4"
                  style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
                  data-testid={`briefing-stat-${i}`}
                >
                  <card.icon
                    className="w-4 h-4 mb-2"
                    style={{ color: MUTED }}
                  />
                  <p
                    className="text-2xl font-bold font-mono"
                    style={{ color: TEXT }}
                  >
                    {card.value.toLocaleString()}
                  </p>
                  <p className="text-xs" style={{ color: MUTED }}>
                    {card.label}
                  </p>
                </div>
              ))}
            </motion.div>

            {confidenceData && (
              <motion.div
                className="rounded-xl p-4 mb-8 flex items-center gap-4"
                style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.4 }}
                data-testid="card-briefing-confidence"
              >
                <div className="flex-shrink-0">
                  <p
                    className="text-3xl font-bold font-mono"
                    style={{
                      color: confidenceData.confidence_score >= 70 ? EMERALD
                        : confidenceData.confidence_score >= 40 ? "#F59E0B"
                        : "#EF4444",
                    }}
                    data-testid="text-briefing-confidence-score"
                  >
                    {confidenceData.confidence_score}
                  </p>
                  <p className="text-xs font-mono" style={{ color: MUTED }}>/100</p>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: MUTED }}>
                    Targeting Accuracy
                  </p>
                  <div className="w-full h-1.5 rounded-full mb-1.5" style={{ background: BORDER }}>
                    <div
                      className="h-1.5 rounded-full transition-all duration-700"
                      style={{
                        width: `${confidenceData.confidence_score}%`,
                        background: confidenceData.confidence_score >= 70 ? EMERALD
                          : confidenceData.confidence_score >= 40 ? "#F59E0B"
                          : "#EF4444",
                      }}
                    />
                  </div>
                  <p className="text-xs" style={{ color: MUTED }} data-testid="text-briefing-confidence-explanation">
                    {confidenceData.explanation}
                  </p>
                </div>
              </motion.div>
            )}

            {unresolvedAlerts.length > 0 && (
              <motion.div
                className="mb-8"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18, duration: 0.4 }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-4 h-4" style={{ color: "#F59E0B" }} />
                  <h2
                    className="text-sm font-mono tracking-widest uppercase"
                    style={{ color: MUTED }}
                    data-testid="text-alerts-title"
                  >
                    Machine Alerts
                  </h2>
                  <span
                    className="text-xs font-mono px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}
                    data-testid="text-alerts-count"
                  >
                    {unresolvedAlerts.length}
                  </span>
                </div>
                <div className="space-y-2" data-testid="alerts-list">
                  <AnimatePresence>
                    {unresolvedAlerts.map((alert) => {
                      const Icon = alertIcon(alert.alertType);
                      const color = alertSeverityColor(alert.severity);
                      return (
                        <motion.div
                          key={alert.id}
                          className="rounded-xl p-3 flex items-start gap-3"
                          style={{
                            background: "#FFFFFF",
                            border: `1px solid ${alert.severity === "critical" ? "rgba(239,68,68,0.3)" : BORDER}`,
                            boxShadow: alert.severity === "critical" ? "0 0 0 1px rgba(239,68,68,0.1)" : "0 1px 3px rgba(0,0,0,0.04)",
                          }}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 8 }}
                          data-testid={`alert-item-${alert.id}`}
                        >
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: `${color}15` }}
                          >
                            <Icon className="w-3.5 h-3.5" style={{ color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span
                                className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{ background: `${color}15`, color }}
                                data-testid={`alert-type-${alert.id}`}
                              >
                                {alertTypeLabel(alert.alertType)}
                              </span>
                              <span
                                className="text-[10px] font-mono uppercase tracking-wider"
                                style={{ color: MUTED }}
                              >
                                {alert.severity}
                              </span>
                            </div>
                            <p
                              className="text-xs"
                              style={{ color: TEXT }}
                              data-testid={`alert-message-${alert.id}`}
                            >
                              {alert.message}
                            </p>
                          </div>
                          <button
                            className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center hover:opacity-70 transition-opacity"
                            style={{ background: SUBTLE }}
                            onClick={() => resolveAlertMutation.mutate(alert.id)}
                            disabled={resolveAlertMutation.isPending}
                            data-testid={`button-resolve-alert-${alert.id}`}
                          >
                            <X className="w-3 h-3" style={{ color: MUTED }} />
                          </button>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2
                  className="text-sm font-mono tracking-widest uppercase"
                  style={{ color: MUTED }}
                  data-testid="text-recommended-title"
                >
                  Recommended Actions
                </h2>
                {briefing.estimated_work_minutes > 0 && (
                  <span
                    className="text-xs font-mono px-2 py-1 rounded-full"
                    style={{
                      background: "rgba(16,185,129,0.08)",
                      color: EMERALD,
                    }}
                    data-testid="text-estimated-time"
                  >
                    ~{briefing.estimated_work_minutes} min
                  </span>
                )}
              </div>

              <div className="space-y-3" data-testid="actions-list">
                <AnimatePresence>
                  {briefing.recommended_actions.map((action, idx) => {
                    const Icon = actionIcon(action.type);
                    const color = actionColor(action.type);
                    const isCompleted = completedActions.has(idx);
                    const isPending =
                      (action.type === "RUN_PIPELINE" &&
                        runPipelineMutation.isPending) ||
                      (action.type === "ENRICH_DM" &&
                        enrichDmsMutation.isPending);

                    return (
                      <motion.div
                        key={idx}
                        className="rounded-xl p-4 flex items-start gap-3"
                        style={{
                          background: "#FFFFFF",
                          border: `1px solid ${BORDER}`,
                          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                        }}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 + idx * 0.06 }}
                        data-testid={`action-item-${idx}`}
                      >
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: `${color}12` }}
                        >
                          {isCompleted ? (
                            <CheckCircle2
                              className="w-4 h-4"
                              style={{ color: EMERALD }}
                            />
                          ) : (
                            <Icon
                              className="w-4 h-4"
                              style={{ color }}
                            />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm font-semibold"
                            style={{
                              color: isCompleted ? MUTED : TEXT,
                              textDecoration: isCompleted
                                ? "line-through"
                                : "none",
                            }}
                            data-testid={`action-title-${idx}`}
                          >
                            {action.title}
                          </p>
                          <p
                            className="text-xs mt-0.5"
                            style={{ color: MUTED }}
                            data-testid={`action-reason-${idx}`}
                          >
                            {action.reason}
                          </p>
                        </div>

                        <Button
                          size="sm"
                          onClick={() => handleAction(action, idx)}
                          disabled={isCompleted || isPending}
                          className="flex-shrink-0 text-xs font-semibold rounded-lg px-3 h-8"
                          style={{
                            background: isCompleted
                              ? SUBTLE
                              : color,
                            color: isCompleted ? MUTED : "#FFFFFF",
                            border: isCompleted
                              ? `1px solid ${BORDER}`
                              : "none",
                          }}
                          data-testid={`action-button-${idx}`}
                        >
                          {isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : isCompleted ? (
                            "Done"
                          ) : (
                            actionButtonLabel(action.type)
                          )}
                        </Button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {briefing.recommended_actions.length === 0 && (
                  <div
                    className="text-center py-8 rounded-xl"
                    style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
                  >
                    <CheckCircle2
                      className="w-8 h-8 mx-auto mb-2"
                      style={{ color: EMERALD }}
                    />
                    <p
                      className="text-sm font-medium"
                      style={{ color: TEXT }}
                    >
                      All clear for today.
                    </p>
                    <p className="text-xs" style={{ color: MUTED }}>
                      No recommended actions right now.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>

            <motion.div
              className="mt-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              <Button
                onClick={() => navigate("/machine/dashboard")}
                className="w-full h-12 text-base font-bold tracking-wider rounded-xl"
                style={{ background: TEXT, color: "#FFFFFF" }}
                data-testid="button-go-to-dashboard"
              >
                Enter Command Center
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
