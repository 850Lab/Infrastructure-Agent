import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import {
  Phone, Mail, Linkedin, Target, Play, Clock, AlertCircle,
  ChevronRight, Building2, User, ArrowRight, Loader2,
  PhoneCall, MessageSquare, Zap, Calendar, TrendingUp, Plus
} from "lucide-react";

const EMERALD = "#10B981";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const SUBTLE = "#F8FAFC";
const ERROR_RED = "#EF4444";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";
const PURPLE = "#8B5CF6";

const FLOW_CONFIG: Record<string, { label: string; color: string; icon: any; bgLight: string }> = {
  gatekeeper: { label: "Gatekeeper", color: AMBER, icon: Phone, bgLight: "rgba(245,158,11,0.08)" },
  dm_call: { label: "DM Call", color: EMERALD, icon: PhoneCall, bgLight: "rgba(16,185,129,0.08)" },
  email: { label: "Email", color: BLUE, icon: Mail, bgLight: "rgba(59,130,246,0.08)" },
  linkedin: { label: "LinkedIn", color: "#0A66C2", icon: Linkedin, bgLight: "rgba(10,102,194,0.08)" },
  nurture: { label: "Nurture", color: PURPLE, icon: Calendar, bgLight: "rgba(139,92,246,0.08)" },
};

const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No Answer", general_voicemail: "General Voicemail",
  receptionist_answered: "Receptionist", gave_dm_name: "Gave DM Name",
  gave_title_only: "Gave Title Only", gave_direct_extension: "Gave Extension",
  gave_email: "Gave Email", transferred: "Transferred", refused: "Refused",
  asked_to_send_info: "Send Info", message_taken: "Message Taken",
  voicemail_left: "Voicemail Left", live_answer: "Live Answer",
  asked_to_call_later: "Call Later", wrong_person: "Wrong Person",
  referred_elsewhere: "Referred", not_relevant: "Not Relevant",
  interested: "Interested", meeting_requested: "Meeting", followup_scheduled: "Follow-up Set",
  sent: "Sent", opened: "Opened", clicked: "Clicked", replied: "Replied",
  bounced: "Bounced", followup_needed: "Follow-up Needed",
  profile_not_found: "Not Found", profile_found: "Found", viewed: "Viewed",
  connection_requested: "Requested", connected: "Connected",
  message_sent: "Messaged", responded: "Responded", no_response: "No Response",
  followup_sent: "Follow-up Sent", check_in_sent: "Check-in Sent",
  reactivated: "Reactivated", closed_lost: "Closed Lost",
};

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

interface FlowStats {
  todayTotal: number;
  callsDue: number;
  emailsDue: number;
  linkedinDue: number;
  activeFlows: number;
  overdue: number;
  completedThisWeek: number;
  flowsByType: Record<string, number>;
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
  primary_dm_name: string;
  city: string;
  state: string;
  category: string;
}

function StatCard({ label, value, icon: Icon, color, testId }: {
  label: string; value: number | string; icon: any; color: string; testId: string;
}) {
  return (
    <div className="rounded-lg p-4" style={{ background: "white", border: `1px solid ${BORDER}` }} data-testid={testId}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}12` }}>
          <Icon className="w-4.5 h-4.5" style={{ color }} />
        </div>
        <div>
          <div className="text-2xl font-bold" style={{ color: TEXT }}>{value}</div>
          <div className="text-xs font-medium" style={{ color: MUTED }}>{label}</div>
        </div>
      </div>
    </div>
  );
}

function FlowBadge({ flowType }: { flowType: string }) {
  const config = FLOW_CONFIG[flowType] || FLOW_CONFIG.gatekeeper;
  const Icon = config.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold"
      style={{ background: config.bgLight, color: config.color }}
      data-testid={`badge-flow-${flowType}`}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function ActionRow({ action, onStartFocus }: { action: ActionItem; onStartFocus: (a: ActionItem) => void }) {
  const isOverdue = new Date(action.dueAt) < new Date();
  const config = FLOW_CONFIG[action.flowType] || FLOW_CONFIG.gatekeeper;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all hover:shadow-sm group"
      style={{
        background: "white",
        border: `1px solid ${isOverdue ? "rgba(239,68,68,0.3)" : BORDER}`,
      }}
      onClick={() => onStartFocus(action)}
      data-testid={`action-row-${action.id}`}
    >
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: isOverdue ? ERROR_RED : config.color }} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-sm truncate" style={{ color: TEXT }} data-testid={`text-company-${action.id}`}>
            {action.companyName}
          </span>
          <FlowBadge flowType={action.flowType} />
          {action.attemptNumber > 1 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: SUBTLE, color: MUTED }}>
              #{action.attemptNumber}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
          {action.contactName && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {action.contactName}
            </span>
          )}
          {action.companyCity && <span>{action.companyCity}</span>}
          {action.lastOutcome && (
            <span>Last: {OUTCOME_LABELS[action.lastOutcome] || action.lastOutcome}</span>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 text-right">
        <div className="text-xs font-medium" style={{ color: isOverdue ? ERROR_RED : MUTED }}>
          {action.recommendationText ? action.recommendationText.substring(0, 40) : "Ready"}
        </div>
      </div>

      <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: MUTED }} />
    </div>
  );
}

export default function TodayPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [seedingFlows, setSeedingFlows] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<FlowStats>({
    queryKey: ["/api/flows/stats"],
  });

  const { data: actions = [], isLoading: actionsLoading } = useQuery<ActionItem[]>({
    queryKey: ["/api/flows/action-queue"],
  });

  const { data: todayResponse } = useQuery<{ companies: TodayCompany[]; count: number }>({
    queryKey: ["/api/today-list"],
  });
  const todayList = Array.isArray(todayResponse) ? todayResponse : (todayResponse?.companies || []);

  const seedMutation = useMutation({
    mutationFn: async (companies: TodayCompany[]) => {
      const payload = companies.map(c => ({
        id: c.id,
        company_name: c.company_name,
        phone: c.phone,
        city: c.city,
        category: c.category,
        bucket: c.bucket,
        offer_dm_name: c.offer_dm_name,
        offer_dm_phone: c.offer_dm_phone,
        offer_dm_email: c.offer_dm_email,
        primary_dm_name: c.primary_dm_name,
      }));
      const res = await apiRequest("POST", "/api/flows/seed-from-today", { companies: payload });
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/flows/action-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flows/stats"] });
      toast({ title: "Flows created", description: `${data.created || 0} new flows seeded from today's list` });
      setSeedingFlows(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to seed flows", variant: "destructive" });
      setSeedingFlows(false);
    },
  });

  const filteredActions = useMemo(() => {
    if (activeFilter === "all") return actions;
    if (activeFilter === "overdue") return actions.filter(a => new Date(a.dueAt) < new Date());
    return actions.filter(a => a.flowType === activeFilter);
  }, [actions, activeFilter]);

  const overdueActions = useMemo(() =>
    actions.filter(a => new Date(a.dueAt) < new Date()), [actions]);

  const handleStartFocus = (action: ActionItem) => {
    navigate("/machine/focus");
  };

  const handleSeedFlows = () => {
    if (!todayList.length) {
      toast({ title: "No companies", description: "Run the pipeline first to populate today's list", variant: "destructive" });
      return;
    }
    setSeedingFlows(true);
    seedMutation.mutate(todayList);
  };

  const isLoading = statsLoading || actionsLoading;

  const FILTER_TABS = [
    { value: "all", label: "All", count: actions.length },
    { value: "overdue", label: "Overdue", count: overdueActions.length, color: ERROR_RED },
    { value: "gatekeeper", label: "Gatekeeper", count: stats?.flowsByType?.gatekeeper || 0 },
    { value: "dm_call", label: "DM Calls", count: stats?.flowsByType?.dm_call || 0 },
    { value: "email", label: "Email", count: stats?.flowsByType?.email || 0 },
    { value: "linkedin", label: "LinkedIn", count: stats?.flowsByType?.linkedin || 0 },
    { value: "nurture", label: "Nurture", count: stats?.flowsByType?.nurture || 0 },
  ];

  return (
    <AppLayout>
      <div className="px-4 py-6" data-testid="page-today">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold" style={{ color: TEXT }} data-testid="text-page-title">
              Today's Actions
            </h1>
            <p className="text-sm mt-0.5" style={{ color: MUTED }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {actions.length === 0 && todayList.length > 0 && (
              <Button
                onClick={handleSeedFlows}
                disabled={seedingFlows}
                className="text-sm font-semibold h-9"
                style={{ background: EMERALD, color: "white" }}
                data-testid="button-seed-flows"
              >
                {seedingFlows ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
                Activate Flows ({todayList.length})
              </Button>
            )}
            <Button
              onClick={() => navigate("/machine/focus")}
              className="text-sm font-semibold h-9"
              style={{ background: actions.length > 0 ? EMERALD : MUTED, color: "white" }}
              disabled={actions.length === 0}
              data-testid="button-start-focus"
            >
              <Play className="w-4 h-4 mr-1.5" />
              Start Focus Mode
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
              <StatCard label="Actions Due" value={stats?.todayTotal || 0} icon={Target} color={EMERALD} testId="stat-total" />
              <StatCard label="Calls Due" value={stats?.callsDue || 0} icon={Phone} color={AMBER} testId="stat-calls" />
              <StatCard label="Emails Due" value={stats?.emailsDue || 0} icon={Mail} color={BLUE} testId="stat-emails" />
              <StatCard label="LinkedIn Due" value={stats?.linkedinDue || 0} icon={Linkedin} color="#0A66C2" testId="stat-linkedin" />
              <StatCard label="Active Flows" value={stats?.activeFlows || 0} icon={TrendingUp} color={EMERALD} testId="stat-active" />
              <StatCard label="Overdue" value={stats?.overdue || 0} icon={AlertCircle} color={ERROR_RED} testId="stat-overdue" />
              <StatCard label="Done This Week" value={stats?.completedThisWeek || 0} icon={Zap} color="#059669" testId="stat-completed" />
            </div>

            {overdueActions.length > 0 && activeFilter !== "overdue" && (
              <div className="rounded-lg p-3 mb-4 flex items-center justify-between" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }} data-testid="overdue-banner">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" style={{ color: ERROR_RED }} />
                  <span className="text-sm font-semibold" style={{ color: ERROR_RED }}>
                    {overdueActions.length} overdue action{overdueActions.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs font-semibold h-7"
                  style={{ color: ERROR_RED }}
                  onClick={() => setActiveFilter("overdue")}
                  data-testid="button-show-overdue"
                >
                  Show overdue
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setActiveFilter(tab.value)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors"
                  style={{
                    background: activeFilter === tab.value ? (tab.color ? `${tab.color}15` : `${EMERALD}12`) : "transparent",
                    color: activeFilter === tab.value ? (tab.color || TEXT) : MUTED,
                    border: activeFilter === tab.value ? `1px solid ${tab.color || EMERALD}30` : "1px solid transparent",
                  }}
                  data-testid={`filter-${tab.value}`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="px-1.5 py-0 rounded-full text-[10px] font-bold" style={{
                      background: tab.color ? `${tab.color}20` : `${EMERALD}15`,
                      color: tab.color || EMERALD,
                    }}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="space-y-2" data-testid="action-list">
              {filteredActions.length === 0 ? (
                <div className="text-center py-16 rounded-lg" style={{ background: "white", border: `1px solid ${BORDER}` }}>
                  <Target className="w-10 h-10 mx-auto mb-3" style={{ color: MUTED }} />
                  <p className="text-sm font-medium" style={{ color: TEXT }}>
                    {actions.length === 0 ? "No active flows yet" : "No actions match this filter"}
                  </p>
                  <p className="text-xs mt-1" style={{ color: MUTED }}>
                    {actions.length === 0 && todayList.length > 0
                      ? 'Click "Activate Flows" to create flows from your today list'
                      : actions.length === 0
                      ? "Run the pipeline to populate your daily call list first"
                      : "Try a different filter"}
                  </p>
                </div>
              ) : (
                filteredActions.map((action) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    onStartFocus={handleStartFocus}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
