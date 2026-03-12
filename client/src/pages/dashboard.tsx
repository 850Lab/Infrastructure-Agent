import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useSSE } from "@/lib/use-sse";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import {
  Play, Settings, Target, Phone, Mail, Users, TrendingUp,
  ArrowRight, Flame, Clock, AlertTriangle, Calendar, Zap,
  Building2, MessageSquare, Briefcase, ChevronRight, Activity,
  Brain, Sparkles, Eye, UserPlus, Search, BarChart3,
  CheckCircle2, XCircle, Loader2, FileText, Star
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const BLUE = "#3B82F6";
const AMBER = "#F59E0B";
const ERROR = "#EF4444";
const PURPLE = "#8B5CF6";
const SUBTLE = "#F8FAFC";

interface CommandCenterData {
  revenue: { hotLeads: number; callsDue: number; overdueFollowups: number; pipelineValue: number };
  pipeline: { newLeads: number; dmIdentified: number; contacted: number; interested: number; proposalSent: number; closedDeals: number };
  activity: { callsMade: number; emailsSent: number; leadsFound: number; conversationsStarted: number; meetingsBooked: number; streak: number };
  hotLeadsList: Array<{ companyName: string; companyId: string; lastOutcome: string; flowType: string }>;
  recentActivity: Array<{ companyName: string; outcome: string; channel: string; createdAt: string }>;
  aiRecommendations: Array<{ type: string; title: string; description: string; action: string; route: string }>;
  staleLeads: number;
  bottleneck: { stage: string; count: number; pct: number; nextStage: string } | null;
  paceToGoal: { calls: { current: number; goal: number; pct: number }; emails: { current: number; goal: number; pct: number } };
}

interface MachineConfigData {
  machine_name: string;
  market: string;
  opportunity: string;
  decision_maker_focus: string;
  geo: string;
  industry_config_selected: string;
}

const SECTION_BUTTONS = [
  { label: "Today", route: "/machine/today" },
  { label: "Pipeline", route: "/machine/pipeline" },
  { label: "Follow-ups", route: "/machine/followups" },
  { label: "Targeting", route: "/machine/targeting" },
  { label: "Lead Engine", route: "/machine/lead-engine" },
  { label: "Contacts", route: "/machine/contacts" },
  { label: "Analytics", route: "/machine/analytics" },
  { label: "Outreach", route: "/machine/outreach" },
  { label: "My Leads", route: "/machine/my-leads" },
];

function StatCard({ icon: Icon, label, value, color, onClick, subtitle }: {
  icon: any; label: string; value: number | string; color: string; onClick?: () => void; subtitle?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl p-4 text-left transition-all hover:shadow-md w-full"
      style={{ background: "white", border: `1px solid ${BORDER}` }}
      data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}12` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        {onClick && <ChevronRight className="w-3.5 h-3.5" style={{ color: MUTED }} />}
      </div>
      <div className="text-2xl font-bold" style={{ color: TEXT }}>{value}</div>
      <div className="text-xs font-medium mt-0.5" style={{ color: MUTED }}>{label}</div>
      {subtitle && <div className="text-[10px] mt-0.5" style={{ color }}>{subtitle}</div>}
    </button>
  );
}

function PipelineBar({ stages }: { stages: Array<{ label: string; count: number; color: string }> }) {
  const total = stages.reduce((s, st) => s + st.count, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden" style={{ background: `${BORDER}` }}>
        {stages.map((st) => (
          <div key={st.label} className="h-full transition-all duration-700" style={{ width: `${(st.count / total) * 100}%`, background: st.color, minWidth: st.count > 0 ? "4px" : "0" }} />
        ))}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {stages.map((st) => (
          <div key={st.label} className="text-center" data-testid={`pipeline-${st.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <div className="text-lg font-bold" style={{ color: TEXT }}>{st.count}</div>
            <div className="text-[10px] font-medium" style={{ color: MUTED }}>{st.label}</div>
            <div className="w-full h-1 rounded-full mt-1" style={{ background: `${st.color}30` }}>
              <div className="h-full rounded-full" style={{ background: st.color, width: `${Math.min(100, (st.count / total) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No Answer", voicemail_left: "Voicemail Left", live_answer: "Live Answer",
  interested: "Interested", meeting_requested: "Meeting", replied: "Replied",
  sent: "Sent", opened: "Opened", clicked: "Clicked", bounced: "Bounced",
  gave_dm_name: "Got DM Name", transferred: "Transferred", refused: "Refused",
  not_a_fit: "Not a Fit", general_voicemail: "Voicemail", receptionist_answered: "Receptionist",
  followup_scheduled: "Follow-up Set", asked_to_call_later: "Call Later",
};

export default function DashboardPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const { runStatus: sseRunStatus, connected, connectionStatus } = useSSE(token);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: polledRunStatus } = useQuery<{ is_running: boolean }>({
    queryKey: ["/api/run-status"],
    refetchInterval: 30000,
    enabled: !!token,
  });

  const runStatus = polledRunStatus?.is_running ? "running" : sseRunStatus;

  const { data: meData } = useQuery<{ email: string; machine_config: MachineConfigData | null; client?: { client_name?: string } | null }>({
    queryKey: ["/api/me"],
    enabled: !!token,
    staleTime: 60000,
  });

  const { data: stats } = useQuery<{
    today_list_count: number | null;
    fresh_pool_count: number | null;
    dm_resolved_count: number | null;
    playbooks_ready_count: number | null;
  }>({
    queryKey: ["/api/dashboard/stats"],
    enabled: !!token,
  });

  const { data: cmd, isLoading, isError, refetch } = useQuery<CommandCenterData>({
    queryKey: ["/api/command-center"],
    enabled: !!token,
    refetchInterval: 60000,
  });

  const [runLoading, setRunLoading] = useState(false);

  const handleRunNow = useCallback(async () => {
    if (runStatus === "running" || runLoading) return;
    setRunLoading(true);
    try {
      const res = await fetch("/api/run-daily", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (res.status === 409) {
        toast({ title: "Run already active", description: "A pipeline run is already in progress.", duration: 5000 });
        return;
      }
      if (!res.ok) throw new Error("Failed to start run");
    } catch (err: any) {
      toast({ title: "Run failed", description: err.message, variant: "destructive" });
    } finally {
      setRunLoading(false);
    }
  }, [runStatus, runLoading, token, toast]);

  const mc = meData?.machine_config;

  const pipelineStages = cmd ? [
    { label: "New", count: cmd.pipeline.newLeads, color: MUTED },
    { label: "DM Found", count: cmd.pipeline.dmIdentified, color: BLUE },
    { label: "Contacted", count: cmd.pipeline.contacted, color: AMBER },
    { label: "Interested", count: cmd.pipeline.interested, color: EMERALD },
    { label: "Proposal", count: cmd.pipeline.proposalSent, color: PURPLE },
    { label: "Closed", count: cmd.pipeline.closedDeals, color: "#059669" },
  ] : [];

  return (
    <AppLayout runStatus={runStatus}>
      <div className="p-4 md:p-6" style={{ minHeight: "calc(100vh - 56px)" }}>
        {mc && (
          <div className="flex items-center justify-between mb-5" data-testid="machine-identity">
            <div>
              <h1 className="text-xl font-bold tracking-tight" style={{ color: TEXT }} data-testid="text-machine-name">
                {mc.machine_name}
              </h1>
              <p className="text-xs mt-0.5" style={{ color: MUTED }} data-testid="text-machine-config-line">
                {mc.opportunity} | {mc.decision_maker_focus} | {mc.geo}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/machine/settings")}
              className="gap-1.5 text-xs"
              style={{ borderColor: BORDER, color: MUTED }}
              data-testid="button-machine-settings"
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <button
            onClick={() => navigate("/machine/focus")}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-bold transition-all"
            style={{ background: EMERALD, color: "#FFFFFF", boxShadow: "0 2px 8px rgba(16,185,129,0.25)" }}
            data-testid="nav-focus-mode"
          >
            <Target className="w-4 h-4" />
            Focus Mode
          </button>
          {SECTION_BUTTONS.map((sec) => (
            <button
              key={sec.route}
              onClick={() => navigate(sec.route)}
              className="px-5 py-2 rounded-full text-sm font-semibold transition-all"
              style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: TEXT }}
              data-testid={`nav-${sec.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {sec.label}
            </button>
          ))}
          {meData?.client?.client_name === "Texas Cool Down Trailers" && (
            <button
              onClick={() => navigate("/machine/lng-projects")}
              className="px-5 py-2 rounded-full text-sm font-semibold transition-all"
              style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}35`, color: AMBER }}
              data-testid="nav-lng-projects"
            >
              LNG Projects
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <XCircle className="w-8 h-8" style={{ color: ERROR }} />
            <p className="text-sm font-medium" style={{ color: TEXT }}>Failed to load Command Center data</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5" data-testid="button-retry">
              <Activity className="w-3.5 h-3.5" /> Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <div className="rounded-xl p-5" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" style={{ color: EMERALD }} />
                    <span className="text-sm font-bold" style={{ color: TEXT }}>Revenue Opportunities</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard icon={Flame} label="Hot Leads" value={cmd?.revenue.hotLeads || 0} color={ERROR} onClick={() => navigate("/machine/pipeline")} subtitle={cmd?.revenue.hotLeads ? "Ready to close" : undefined} />
                  <StatCard icon={Phone} label="Calls Due Today" value={cmd?.revenue.callsDue || 0} color={BLUE} onClick={() => navigate("/machine/focus")} subtitle={cmd?.revenue.callsDue ? "Start calling" : undefined} />
                  <StatCard icon={AlertTriangle} label="Overdue Follow-ups" value={cmd?.revenue.overdueFollowups || 0} color={AMBER} onClick={() => navigate("/machine/followups")} subtitle={cmd?.revenue.overdueFollowups ? "Need attention" : undefined} />
                  <StatCard icon={Briefcase} label="Active Opportunities" value={cmd?.revenue.pipelineValue || 0} color={EMERALD} onClick={() => navigate("/machine/pipeline")} subtitle="Interested + Proposal + Closed" />
                </div>
              </div>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
                <div className="rounded-xl p-5" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="w-4 h-4" style={{ color: BLUE }} />
                    <span className="text-sm font-bold" style={{ color: TEXT }}>Pipeline Snapshot</span>
                    <button onClick={() => navigate("/machine/pipeline")} className="ml-auto flex items-center gap-1 text-[10px] font-semibold" style={{ color: EMERALD }} data-testid="pipeline-view-all">
                      View All <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                  <PipelineBar stages={pipelineStages} />
                  {cmd?.bottleneck && (
                    <button
                      onClick={() => navigate("/machine/pipeline")}
                      className="mt-3 w-full flex items-center gap-2 p-2.5 rounded-lg text-left"
                      style={{ background: `${ERROR}06`, border: `1px solid ${ERROR}20` }}
                      data-testid="bottleneck-insight"
                    >
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: ERROR }} />
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-semibold" style={{ color: ERROR }}>
                          Bottleneck: {cmd.bottleneck.pct}% of leads stuck at "{cmd.bottleneck.stage}"
                        </span>
                        <span className="text-[10px] ml-1" style={{ color: MUTED }}>
                          {cmd.bottleneck.count} not converting to {cmd.bottleneck.nextStage}
                        </span>
                      </div>
                      <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: ERROR }} />
                    </button>
                  )}
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
                <div className="rounded-xl p-5 h-full" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4" style={{ color: PURPLE }} />
                      <span className="text-sm font-bold" style={{ color: TEXT }}>Activity Momentum</span>
                    </div>
                    {(cmd?.activity.streak || 0) > 0 && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: `${AMBER}12` }} data-testid="streak-badge">
                        <Flame className="w-3 h-3" style={{ color: AMBER }} />
                        <span className="text-[10px] font-bold" style={{ color: AMBER }}>{cmd?.activity.streak} day streak</span>
                      </div>
                    )}
                  </div>

                  {cmd?.paceToGoal && (
                    <div className="space-y-2 mb-3 pb-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                      {[
                        { label: "Calls", ...cmd.paceToGoal.calls, color: BLUE, route: "/machine/focus" },
                        { label: "Emails", ...cmd.paceToGoal.emails, color: PURPLE, route: "/machine/email-queue" },
                      ].map((g) => (
                        <button key={g.label} onClick={() => navigate(g.route)} className="w-full text-left" data-testid={`pace-${g.label.toLowerCase()}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-semibold" style={{ color: MUTED }}>{g.label} Goal</span>
                            <span className="text-[10px] font-bold" style={{ color: g.pct >= 100 ? EMERALD : g.pct >= 50 ? g.color : AMBER }}>
                              {g.current}/{g.goal} ({g.pct}%)
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full" style={{ background: `${g.color}15` }}>
                            <div className="h-full rounded-full transition-all duration-700" style={{
                              width: `${g.pct}%`,
                              background: g.pct >= 100 ? EMERALD : g.pct >= 50 ? g.color : AMBER,
                            }} />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    {[
                      { label: "Calls Made", value: cmd?.activity.callsMade || 0, icon: Phone, color: BLUE, route: "/machine/focus" },
                      { label: "Emails Sent", value: cmd?.activity.emailsSent || 0, icon: Mail, color: PURPLE, route: "/machine/email-queue" },
                      { label: "Leads Found", value: cmd?.activity.leadsFound || 0, icon: Search, color: EMERALD, route: "/machine/lead-engine" },
                      { label: "Conversations", value: cmd?.activity.conversationsStarted || 0, icon: MessageSquare, color: AMBER, route: "/machine/pipeline" },
                      { label: "Meetings Booked", value: cmd?.activity.meetingsBooked || 0, icon: Calendar, color: "#059669", route: "/machine/pipeline" },
                    ].map((m) => (
                      <button key={m.label} onClick={() => navigate(m.route)} className="w-full flex items-center justify-between py-1.5 text-left" data-testid={`activity-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                        <div className="flex items-center gap-2">
                          <m.icon className="w-3.5 h-3.5" style={{ color: m.color }} />
                          <span className="text-xs font-medium" style={{ color: TEXT }}>{m.label}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-bold" style={{ color: m.value > 0 ? m.color : MUTED }}>{m.value}</span>
                          <ChevronRight className="w-3 h-3" style={{ color: MUTED }} />
                        </div>
                      </button>
                    ))}
                  </div>

                  {(cmd?.staleLeads || 0) > 0 && (
                    <button
                      onClick={() => navigate("/machine/pipeline")}
                      className="w-full mt-3 pt-3 flex items-center justify-between text-left"
                      style={{ borderTop: `1px solid ${BORDER}` }}
                      data-testid="stale-leads-warning"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5" style={{ color: AMBER }} />
                        <span className="text-xs font-medium" style={{ color: AMBER }}>Stale Leads (7+ days)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-bold" style={{ color: AMBER }}>{cmd?.staleLeads}</span>
                        <ChevronRight className="w-3 h-3" style={{ color: AMBER }} />
                      </div>
                    </button>
                  )}
                </div>
              </motion.div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}>
                <div className="rounded-xl p-5" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center gap-2 mb-4">
                    <Brain className="w-4 h-4" style={{ color: PURPLE }} />
                    <span className="text-sm font-bold" style={{ color: TEXT }}>AI Recommendations</span>
                  </div>
                  {(cmd?.aiRecommendations || []).length === 0 ? (
                    <div className="text-center py-6">
                      <CheckCircle2 className="w-8 h-8 mx-auto mb-2" style={{ color: EMERALD }} />
                      <p className="text-sm font-medium" style={{ color: TEXT }}>All caught up</p>
                      <p className="text-xs" style={{ color: MUTED }}>No urgent recommendations right now</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {cmd?.aiRecommendations.map((rec, i) => (
                        <button
                          key={i}
                          onClick={() => navigate(rec.route)}
                          className="w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all hover:shadow-sm"
                          style={{ background: SUBTLE, border: `1px solid ${BORDER}` }}
                          data-testid={`ai-rec-${i}`}
                        >
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{
                            background: rec.type === "urgent" ? `${ERROR}12` : rec.type === "hot_lead" ? `${AMBER}12` : `${BLUE}12`,
                          }}>
                            {rec.type === "urgent" ? <AlertTriangle className="w-3.5 h-3.5" style={{ color: ERROR }} /> :
                             rec.type === "hot_lead" ? <Flame className="w-3.5 h-3.5" style={{ color: AMBER }} /> :
                             <Zap className="w-3.5 h-3.5" style={{ color: BLUE }} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold" style={{ color: TEXT }}>{rec.title}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: MUTED }}>{rec.description}</div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 mt-1">
                            <span className="text-[10px] font-semibold" style={{ color: EMERALD }}>{rec.action}</span>
                            <ArrowRight className="w-3 h-3" style={{ color: EMERALD }} />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
                <div className="rounded-xl p-5 h-full" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4" style={{ color: AMBER }} />
                    <span className="text-sm font-bold" style={{ color: TEXT }}>Hot Leads</span>
                  </div>
                  {(cmd?.hotLeadsList || []).length === 0 ? (
                    <div className="text-center py-6">
                      <Search className="w-6 h-6 mx-auto mb-2" style={{ color: MUTED }} />
                      <p className="text-xs" style={{ color: MUTED }}>No hot leads yet. Keep calling.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {cmd?.hotLeadsList.slice(0, 6).map((lead, i) => (
                        <button
                          key={i}
                          onClick={() => navigate(`/machine/company/${lead.companyId}`)}
                          className="w-full flex items-center gap-2 p-2 rounded-lg text-left transition-all hover:shadow-sm"
                          style={{ background: SUBTLE }}
                          data-testid={`hot-lead-${i}`}
                        >
                          <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: `${AMBER}15` }}>
                            <Building2 className="w-3 h-3" style={{ color: AMBER }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate" style={{ color: TEXT }}>{lead.companyName}</div>
                            <div className="text-[10px]" style={{ color: EMERALD }}>{OUTCOME_LABELS[lead.lastOutcome] || lead.lastOutcome}</div>
                          </div>
                          <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.25 }}>
                <div className="rounded-xl p-5" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-4 h-4" style={{ color: MUTED }} />
                    <span className="text-sm font-bold" style={{ color: TEXT }}>Recent Activity</span>
                  </div>
                  {(cmd?.recentActivity || []).length === 0 ? (
                    <div className="text-center py-6">
                      <Activity className="w-6 h-6 mx-auto mb-2" style={{ color: MUTED }} />
                      <p className="text-xs" style={{ color: MUTED }}>No activity yet today</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {cmd?.recentActivity.map((act, i) => (
                        <div key={i} className="flex items-center gap-3 py-2 px-2 rounded-lg" style={{ background: i % 2 === 0 ? SUBTLE : "transparent" }} data-testid={`recent-activity-${i}`}>
                          <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{
                            background: act.channel === "phone" ? `${BLUE}12` : act.channel === "email" ? `${PURPLE}12` : `${EMERALD}12`,
                          }}>
                            {act.channel === "phone" ? <Phone className="w-3 h-3" style={{ color: BLUE }} /> :
                             act.channel === "email" ? <Mail className="w-3 h-3" style={{ color: PURPLE }} /> :
                             <MessageSquare className="w-3 h-3" style={{ color: EMERALD }} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium" style={{ color: TEXT }}>{act.companyName}</span>
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{
                            background: ["interested", "meeting_requested", "replied", "live_answer"].includes(act.outcome) ? `${EMERALD}12` : `${MUTED}12`,
                            color: ["interested", "meeting_requested", "replied", "live_answer"].includes(act.outcome) ? EMERALD : MUTED,
                          }}>{OUTCOME_LABELS[act.outcome] || act.outcome}</span>
                          <span className="text-[10px] flex-shrink-0" style={{ color: MUTED }}>
                            {new Date(act.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.3 }}>
                <div className="rounded-xl p-5 h-full" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4" style={{ color: EMERALD }} />
                    <span className="text-sm font-bold" style={{ color: TEXT }}>Automation Health</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-xs font-medium" style={{ color: TEXT }}>Engine Status</span>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{
                          background: connectionStatus === "connected" ? EMERALD : connectionStatus === "reconnecting" ? AMBER : ERROR,
                        }} />
                        <span className="text-xs font-semibold" style={{
                          color: connectionStatus === "connected" ? EMERALD : connectionStatus === "reconnecting" ? AMBER : ERROR,
                        }} data-testid="text-engine-status">
                          {runStatus === "running" ? "Running" : connectionStatus === "connected" ? "Online" : "Offline"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-xs font-medium" style={{ color: TEXT }}>Untouched Leads</span>
                      <span className="text-sm font-bold" style={{ color: BLUE }} data-testid="stat-untouched-leads">{stats?.fresh_pool_count ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-xs font-medium" style={{ color: TEXT }}>Outreach Scripts</span>
                      <span className="text-sm font-bold" style={{ color: PURPLE }} data-testid="stat-outreach-scripts">{stats?.playbooks_ready_count ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-xs font-medium" style={{ color: TEXT }}>Today's List</span>
                      <span className="text-sm font-bold" style={{ color: EMERALD }} data-testid="stat-today-list">{stats?.today_list_count ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-xs font-medium" style={{ color: TEXT }}>DMs Resolved</span>
                      <span className="text-sm font-bold" style={{ color: AMBER }} data-testid="stat-dms-resolved">{stats?.dm_resolved_count ?? "—"}</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                    <Button
                      onClick={handleRunNow}
                      disabled={runStatus === "running" || runLoading}
                      className="w-full h-9 text-xs font-semibold gap-1.5"
                      style={{ background: runStatus === "running" ? MUTED : EMERALD, color: "white" }}
                      data-testid="button-run-engine"
                    >
                      {runLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      {runStatus === "running" ? "Engine Running..." : "Run Lead Engine"}
                    </Button>
                  </div>
                </div>
              </motion.div>
            </div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.35 }}>
              <div className="rounded-xl p-4" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4" style={{ color: EMERALD }} />
                  <span className="text-sm font-bold" style={{ color: TEXT }}>Quick Actions</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Start Focus Mode", route: "/machine/focus", icon: Target, color: EMERALD },
                    { label: "View Follow-ups", route: "/machine/followups", icon: Calendar, color: AMBER },
                    { label: "Review Leads", route: "/machine/pipeline", icon: Users, color: BLUE },
                    { label: "Add Company", route: "/machine/my-leads", icon: UserPlus, color: PURPLE },
                    ...(meData?.client?.client_name === "Texas Cool Down Trailers"
                      ? [{ label: "View LNG Projects", route: "/machine/lng-projects", icon: Briefcase, color: AMBER }]
                      : []),
                  ].map((qa) => (
                    <button
                      key={qa.route}
                      onClick={() => navigate(qa.route)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all hover:shadow-sm"
                      style={{ background: `${qa.color}08`, border: `1px solid ${qa.color}20`, color: qa.color }}
                      data-testid={`quick-${qa.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <qa.icon className="w-3.5 h-3.5" />
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
