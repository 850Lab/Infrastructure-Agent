import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import AppLayout from "@/components/app-layout";
import { Mail, User, ChevronRight, Loader2 } from "lucide-react";

const TEXT = "#0F172A";
const MUTED = "#94A3B8";
const BORDER = "#E2E8F0";
const EMERALD = "#10B981";
const BLUE = "#3B82F6";
const ERROR_RED = "#EF4444";

const OUTCOME_LABELS: Record<string, string> = {
  sent: "Sent", opened: "Opened", clicked: "Clicked", replied: "Replied",
  bounced: "Bounced", not_relevant: "Not Relevant", interested: "Interested",
  followup_needed: "Follow-up Needed",
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
  contactEmail: string | null;
}

export default function EmailQueuePage() {
  const [, navigate] = useLocation();

  const { data: actions = [], isLoading } = useQuery<ActionItem[]>({
    queryKey: ["/api/flows/action-queue?filter=all"],
  });

  const emailActions = actions.filter(a => a.taskType === "send_email");

  return (
    <AppLayout>
      <div className="px-4 py-6" data-testid="page-email-queue">
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: TEXT }}>Email Queue</h1>
          <p className="text-sm mt-0.5" style={{ color: MUTED }}>
            {emailActions.length} email{emailActions.length !== 1 ? "s" : ""} pending
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: BLUE }} />
          </div>
        ) : emailActions.length === 0 ? (
          <div className="text-center py-16 rounded-lg" style={{ background: "white", border: `1px solid ${BORDER}` }}>
            <Mail className="w-10 h-10 mx-auto mb-3" style={{ color: MUTED }} />
            <p className="text-sm font-medium" style={{ color: TEXT }}>No emails in queue</p>
            <p className="text-xs mt-1" style={{ color: MUTED }}>Email actions will appear here when email flows are active</p>
          </div>
        ) : (
          <div className="space-y-2">
            {emailActions.map(action => {
              const isOverdue = new Date(action.dueAt) < new Date();
              return (
                <div
                  key={action.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all hover:shadow-sm group"
                  style={{ background: "white", border: `1px solid ${isOverdue ? "rgba(239,68,68,0.3)" : BORDER}` }}
                  onClick={() => navigate("/machine/focus")}
                  data-testid={`email-row-${action.id}`}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${BLUE}12` }}>
                    <Mail className="w-4 h-4" style={{ color: BLUE }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm truncate" style={{ color: TEXT }}>{action.companyName}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${BLUE}12`, color: BLUE }}>
                        Step {action.attemptNumber}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                      {action.contactName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{action.contactName}</span>}
                      {action.contactEmail && <span>{action.contactEmail}</span>}
                      {action.lastOutcome && <span>Last: {OUTCOME_LABELS[action.lastOutcome] || action.lastOutcome}</span>}
                    </div>
                  </div>
                  <div className="text-xs font-medium text-right flex-shrink-0" style={{ color: isOverdue ? ERROR_RED : MUTED }}>
                    {action.recommendationText ? action.recommendationText.substring(0, 35) : "Ready to send"}
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
