import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import AppLayout from "@/components/app-layout";
import { Phone, PhoneCall, User, Building2, Clock, ChevronRight, Loader2, AlertCircle } from "lucide-react";

const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const EMERALD = "#10B981";
const AMBER = "#F59E0B";
const ERROR_RED = "#EF4444";

const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No Answer", general_voicemail: "General Voicemail",
  receptionist_answered: "Receptionist", gave_dm_name: "Gave DM Name",
  gave_direct_extension: "Gave Extension", gave_email: "Gave Email",
  transferred: "Transferred", refused: "Refused", message_taken: "Message Taken",
  voicemail_left: "Voicemail Left", live_answer: "Live Answer",
  asked_to_call_later: "Call Later", wrong_person: "Wrong Person",
  interested: "Interested", meeting_requested: "Meeting", followup_scheduled: "Follow-up Set",
};

interface ActionItem {
  id: number;
  companyId: string;
  companyName: string;
  contactName: string | null;
  flowType: string;
  taskType: string;
  dueAt: string;
  priority: number;
  recommendationText: string | null;
  lastOutcome: string | null;
  attemptNumber: number;
  companyPhone: string | null;
  contactPhone: string | null;
  companyCity: string | null;
}

export default function CallQueuePage() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "gatekeeper" | "dm_call">("all");

  const { data: actions = [], isLoading } = useQuery<ActionItem[]>({
    queryKey: ["/api/flows/action-queue?filter=all"],
  });

  const callActions = actions.filter(a =>
    a.taskType === "gatekeeper_call" || a.taskType === "dm_call"
  );

  const filtered = filter === "all" ? callActions :
    callActions.filter(a => a.flowType === filter);

  const gkCount = callActions.filter(a => a.flowType === "gatekeeper").length;
  const dmCount = callActions.filter(a => a.flowType === "dm_call").length;

  return (
    <AppLayout>
      <div className="px-4 py-6" data-testid="page-call-queue">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold" style={{ color: TEXT }}>Call Queue</h1>
            <p className="text-sm mt-0.5" style={{ color: MUTED }}>
              {callActions.length} call{callActions.length !== 1 ? "s" : ""} pending
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 mb-4">
          {[
            { value: "all" as const, label: "All Calls", count: callActions.length },
            { value: "gatekeeper" as const, label: "Gatekeeper", count: gkCount },
            { value: "dm_call" as const, label: "DM Direct", count: dmCount },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: filter === tab.value ? `${EMERALD}12` : "transparent",
                color: filter === tab.value ? TEXT : MUTED,
                border: filter === tab.value ? `1px solid ${EMERALD}30` : "1px solid transparent",
              }}
              data-testid={`filter-${tab.value}`}
            >
              {tab.label}
              <span className="px-1.5 rounded-full text-[10px] font-bold" style={{ background: `${EMERALD}15`, color: EMERALD }}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: EMERALD }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 rounded-lg" style={{ background: "white", border: `1px solid ${BORDER}` }}>
            <Phone className="w-10 h-10 mx-auto mb-3" style={{ color: MUTED }} />
            <p className="text-sm font-medium" style={{ color: TEXT }}>No calls in queue</p>
            <p className="text-xs mt-1" style={{ color: MUTED }}>Activate flows from the Today page to populate your call queue</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(action => {
              const isOverdue = new Date(action.dueAt) < new Date();
              const isGK = action.flowType === "gatekeeper";
              return (
                <div
                  key={action.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all hover:shadow-sm group"
                  style={{ background: "white", border: `1px solid ${isOverdue ? "rgba(239,68,68,0.3)" : BORDER}` }}
                  onClick={() => navigate("/machine/focus")}
                  data-testid={`call-row-${action.id}`}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: isGK ? `${AMBER}15` : `${EMERALD}12` }}>
                    {isGK ? <Phone className="w-4 h-4" style={{ color: AMBER }} /> : <PhoneCall className="w-4 h-4" style={{ color: EMERALD }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm truncate" style={{ color: TEXT }}>{action.companyName}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{
                        background: isGK ? `${AMBER}12` : `${EMERALD}10`,
                        color: isGK ? AMBER : EMERALD,
                      }}>
                        {isGK ? "GK" : "DM"} #{action.attemptNumber}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                      {action.contactName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{action.contactName}</span>}
                      {action.companyCity && <span>{action.companyCity}</span>}
                      {action.lastOutcome && <span>Last: {OUTCOME_LABELS[action.lastOutcome] || action.lastOutcome}</span>}
                    </div>
                  </div>
                  <div className="text-xs font-medium text-right flex-shrink-0" style={{ color: isOverdue ? ERROR_RED : MUTED }}>
                    {isOverdue ? "Overdue" : "Due today"}
                  </div>
                  <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-0 group-hover:opacity-100" style={{ color: MUTED }} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
