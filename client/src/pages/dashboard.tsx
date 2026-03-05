import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useSSE } from "@/lib/use-sse";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/app-layout";
import NeuralNetwork from "@/components/neural-network";
import { Button } from "@/components/ui/button";
import { Play, ChevronDown, ChevronUp, FileText } from "lucide-react";

const STEP_ORDER = [
  "bootstrap",
  "opportunity_engine",
  "dm_coverage",
  "dm_fit",
  "playbooks",
  "call_engine",
  "query_intel",
  "lead_feed",
] as const;

const STEP_LABELS: Record<string, string> = {
  bootstrap: "System Boot",
  opportunity_engine: "Opportunity Scan",
  dm_coverage: "Contact Mapping",
  dm_fit: "Buyer Selection",
  playbooks: "Script Generation",
  call_engine: "Call Processing",
  query_intel: "Intel Engine",
  lead_feed: "Lead Expansion",
};

const SECTION_BUTTONS = [
  { label: "Today", route: "/today", steps: ["opportunity_engine", "playbooks"] },
  { label: "Follow-ups", route: "/followups", steps: ["call_engine"] },
  { label: "Lead Engine", route: "/lead-engine", steps: ["lead_feed", "query_intel"] },
  { label: "Contacts", route: "/contacts", steps: ["dm_coverage", "dm_fit"] },
  { label: "Analytics", route: "/analytics", steps: ["bootstrap"] },
];

const EMERALD = "#10B981";
const EMERALD_DARK = "#059669";
const ERROR_RED = "#EF4444";


function StepTimeline({ activeNodes, doneSteps, runStatus }: {
  activeNodes: Set<string>;
  doneSteps: Set<string>;
  runStatus: string;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2" data-testid="step-timeline">
      {STEP_ORDER.map((step) => {
        const isActive = activeNodes.has(step);
        const isDone = doneSteps.has(step);
        const isError = runStatus === "error" && isActive;

        let bg = "#F8FAFC";
        let border = "#E2E8F0";
        let color = "#94A3B8";
        let shadow = "none";

        if (isError) {
          bg = "rgba(239,68,68,0.06)";
          border = "rgba(239,68,68,0.3)";
          color = ERROR_RED;
          shadow = "0 0 8px rgba(239,68,68,0.15)";
        } else if (isActive) {
          bg = "rgba(16,185,129,0.06)";
          border = "rgba(16,185,129,0.35)";
          color = EMERALD;
          shadow = "0 0 8px rgba(16,185,129,0.15)";
        } else if (isDone) {
          bg = "rgba(16,185,129,0.04)";
          border = "rgba(16,185,129,0.15)";
          color = "#6EE7B7";
        }

        return (
          <div
            key={step}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg font-mono text-xs font-medium transition-all duration-300"
            style={{ background: bg, border: `1px solid ${border}`, color, boxShadow: shadow }}
            data-testid={`timeline-step-${step}`}
          >
            {STEP_LABELS[step]}
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const { recentEvents, activeNodes, runStatus, connected } = useSSE(token);
  const [, navigate] = useLocation();
  const [runLoading, setRunLoading] = useState(false);
  const [doneSteps, setDoneSteps] = useState<Set<string>>(new Set());
  const [shockwave, setShockwave] = useState(0);
  const [burst, setBurst] = useState(0);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [eventRate, setEventRate] = useState(0);
  const lastEventCount = useRef(0);
  const eventTimestamps = useRef<number[]>([]);

  const { data: stats } = useQuery<{
    today_list_count: number | null;
    fresh_pool_count: number | null;
    dm_resolved_count: number | null;
    playbooks_ready_count: number | null;
  }>({
    queryKey: ["/api/dashboard/stats"],
    enabled: !!token,
  });

  const { data: machineMetrics } = useQuery<{
    companies_total: number | null;
    dms_total: number | null;
    calls_total: number | null;
    wins_total: number | null;
    opportunities_total: number | null;
    computed_at: number;
  }>({
    queryKey: ["/api/machine-metrics"],
    enabled: !!token,
    refetchInterval: 300000,
  });

  const { data: runHistory } = useQuery<Array<{
    run_id: string;
    started_at: string;
    finished_at: string | null;
    steps: Array<{ step: string; status: string; duration_ms?: number }>;
    summary: string;
    errors: string[];
  }>>({
    queryKey: ["/api/run-history"],
    enabled: !!token,
    refetchInterval: runStatus === "running" ? 5000 : 30000,
  });

  const { data: confidenceData } = useQuery<{
    confidence_score: number;
    explanation: string;
    components: {
      dm_reached_rate: number;
      qualified_rate: number;
      won_rate: number;
      not_interested_rate: number;
    };
  }>({
    queryKey: ["/api/confidence"],
    enabled: !!token,
    refetchInterval: 120000,
  });

  useEffect(() => {
    if (recentEvents.length === 0 || recentEvents.length === lastEventCount.current) return;
    const newCount = recentEvents.length - lastEventCount.current;
    lastEventCount.current = recentEvents.length;
    const last = recentEvents[recentEvents.length - 1];

    const now = Date.now();
    for (let i = 0; i < newCount; i++) eventTimestamps.current.push(now);
    eventTimestamps.current = eventTimestamps.current.filter(t => now - t < 3000);
    setEventRate(eventTimestamps.current.length / 3);

    if (last.type === "STEP_STARTED") {
      setShockwave((s) => s + 1);
    }
    if (last.type === "STEP_DONE") {
      const step = last.payload.step;
      if (step) setDoneSteps((prev) => new Set([...prev, step]));
    }
    if (last.type === "TRIGGER_FIRED") {
      setBurst((b) => b + 1);
    }
    if (last.type === "RUN_STARTED") {
      setDoneSteps(new Set());
    }
  }, [recentEvents]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      eventTimestamps.current = eventTimestamps.current.filter(t => now - t < 3000);
      setEventRate(eventTimestamps.current.length / 3);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRunNow = useCallback(async () => {
    if (runStatus === "running" || runLoading) return;
    setRunLoading(true);
    try {
      const res = await fetch("/api/run-daily", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (res.status === 409) return;
      if (!res.ok) throw new Error("Failed to start run");
    } catch {} finally {
      setRunLoading(false);
    }
  }, [runStatus, runLoading, token]);

  const statusLabel = runStatus === "running" ? "RUNNING" : runStatus === "error" ? "ERROR" : "STANDBY";
  const statusSub = runStatus === "running"
    ? "Processing run"
    : runStatus === "error"
      ? "Fault detected \u2014 check event log"
      : "Listening for triggers";

  const displayEvents = recentEvents.slice(-30).reverse();
  const displayHistory = (runHistory || []).slice(0, 5);

  const kpis = [
    { label: "Today List", value: stats?.today_list_count },
    { label: "Fresh Pool", value: stats?.fresh_pool_count },
    { label: "DMs Resolved", value: stats?.dm_resolved_count },
    { label: "Playbooks", value: stats?.playbooks_ready_count },
  ];

  return (
    <AppLayout runStatus={runStatus}>
      <div className="p-4 md:p-6" style={{ minHeight: "calc(100vh - 56px)" }}>
        <div className="flex flex-wrap items-center gap-2 mb-6" data-testid="section-nav">
          {SECTION_BUTTONS.map((sec) => {
            const isStepActive = sec.steps.some((s) => activeNodes.has(s));
            return (
              <button
                key={sec.route}
                onClick={() => navigate(sec.route)}
                className="px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300"
                style={{
                  background: isStepActive ? "rgba(16,185,129,0.08)" : "#F8FAFC",
                  border: `1px solid ${isStepActive ? "rgba(16,185,129,0.35)" : "#E2E8F0"}`,
                  color: isStepActive ? EMERALD : "#0F172A",
                  boxShadow: isStepActive ? "0 0 12px rgba(16,185,129,0.1)" : "none",
                }}
                data-testid={`nav-${sec.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {sec.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          <div className="lg:col-span-1 space-y-5">
            <div
              className="rounded-2xl p-5"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
              data-testid="card-system-status"
            >
              <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "#94A3B8" }}>
                System Status
              </p>
              <p
                className="text-3xl font-bold font-mono tracking-wider mb-1"
                style={{
                  color: runStatus === "error" ? ERROR_RED : runStatus === "running" ? EMERALD_DARK : "#0F172A",
                }}
                data-testid="text-system-status"
              >
                {statusLabel}
              </p>
              <p className="text-xs font-mono mb-4" style={{ color: "#94A3B8" }} data-testid="text-status-line">
                {statusSub}
              </p>

              {connected && (
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: EMERALD }} />
                  <span className="text-xs font-mono" style={{ color: "#94A3B8" }} data-testid="text-sse-status">SSE Connected</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {kpis.map((kpi) => (
                  <div key={kpi.label} className="rounded-lg p-2.5" style={{ background: "#F8FAFC", border: "1px solid #F1F5F9" }}>
                    <p className="text-xs font-mono" style={{ color: "#94A3B8" }}>{kpi.label}</p>
                    <p className="text-lg font-bold font-mono" style={{ color: "#0F172A" }} data-testid={`kpi-${kpi.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      {kpi.value != null ? kpi.value : "\u2014"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="rounded-2xl p-5"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
              data-testid="card-machine-memory"
            >
              <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "#94A3B8" }}>
                Machine Memory
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Companies", value: machineMetrics?.companies_total },
                  { label: "DMs", value: machineMetrics?.dms_total },
                  { label: "Calls", value: machineMetrics?.calls_total },
                  { label: "Wins", value: machineMetrics?.wins_total },
                  { label: "Opps", value: machineMetrics?.opportunities_total },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg p-2.5" style={{ background: "#F8FAFC", border: "1px solid #F1F5F9" }}>
                    <p className="text-xs font-mono" style={{ color: "#94A3B8" }}>{m.label}</p>
                    <p className="text-lg font-bold font-mono" style={{ color: "#0F172A" }} data-testid={`metric-${m.label.toLowerCase()}`}>
                      {m.value != null ? m.value.toLocaleString() : "\u2014"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="rounded-2xl p-5"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
              data-testid="card-targeting-accuracy"
            >
              <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "#94A3B8" }}>
                Targeting Accuracy
              </p>
              <div className="flex items-end gap-3 mb-2">
                <p
                  className="text-3xl font-bold font-mono"
                  style={{
                    color: (confidenceData?.confidence_score ?? 50) >= 70 ? EMERALD
                      : (confidenceData?.confidence_score ?? 50) >= 40 ? "#F59E0B"
                      : ERROR_RED,
                  }}
                  data-testid="text-confidence-score"
                >
                  {confidenceData?.confidence_score ?? 50}
                </p>
                <p className="text-xs font-mono mb-1" style={{ color: "#94A3B8" }}>/100</p>
              </div>
              <div className="w-full h-2 rounded-full mb-3" style={{ background: "#F1F5F9" }}>
                <div
                  className="h-2 rounded-full transition-all duration-700"
                  style={{
                    width: `${confidenceData?.confidence_score ?? 50}%`,
                    background: (confidenceData?.confidence_score ?? 50) >= 70 ? EMERALD
                      : (confidenceData?.confidence_score ?? 50) >= 40 ? "#F59E0B"
                      : ERROR_RED,
                  }}
                  data-testid="confidence-bar"
                />
              </div>
              <p className="text-xs" style={{ color: "#64748B" }} data-testid="text-confidence-explanation">
                {confidenceData?.explanation || "Baseline targeting score."}
              </p>
            </div>

            <Button
              onClick={handleRunNow}
              disabled={runStatus === "running" || runLoading}
              className="w-full h-12 text-base font-bold tracking-wider rounded-xl"
              style={{
                background: runStatus === "running" ? "#F8FAFC" : "#0F172A",
                color: runStatus === "running" ? "#64748B" : "#FFFFFF",
                border: `1px solid ${runStatus === "running" ? "#E2E8F0" : "#0F172A"}`,
              }}
              data-testid="button-run-now"
            >
              <Play className="w-5 h-5 mr-2" />
              {runLoading ? "STARTING..." : runStatus === "running" ? "RUNNING..." : "RUN NOW"}
            </Button>

            <Button
              onClick={() => navigate("/briefing")}
              className="w-full h-10 text-sm font-semibold tracking-wider rounded-xl"
              style={{
                background: "#F8FAFC",
                color: "#0F172A",
                border: "1px solid #E2E8F0",
              }}
              data-testid="button-daily-briefing"
            >
              <FileText className="w-4 h-4 mr-2" />
              Daily Briefing
            </Button>
          </div>

          <div className="lg:col-span-2 flex items-center justify-center">
            <div className="w-full max-w-lg">
              <NeuralNetwork
                runStatus={runStatus}
                activeNodes={activeNodes}
                doneSteps={doneSteps}
                shockwave={shockwave}
                burst={burst}
                machineMetrics={machineMetrics ? {
                  wins_total: machineMetrics.wins_total,
                  calls_total: machineMetrics.calls_total,
                } : null}
                runHistory={runHistory ?? null}
                eventRate={eventRate}
                confidenceScore={confidenceData?.confidence_score ?? 50}
                onNodeClick={(route) => navigate(route)}
              />
            </div>
          </div>

          <div className="lg:col-span-1 space-y-5">
            <div
              className="rounded-2xl p-4"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                maxHeight: "260px",
              }}
              data-testid="panel-run-history"
            >
              <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "#94A3B8" }}>
                Run History
              </p>
              <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                {displayHistory.length === 0 ? (
                  <p className="text-xs font-mono text-center py-4" style={{ color: "#CBD5E1" }}>No runs yet</p>
                ) : (
                  displayHistory.map((run) => {
                    const isExpanded = expandedRun === run.run_id;
                    const runTime = new Date(run.started_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
                    const hasErrors = run.errors && run.errors.length > 0;
                    return (
                      <div key={run.run_id} className="mb-1">
                        <button
                          onClick={() => setExpandedRun(isExpanded ? null : run.run_id)}
                          className="w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left transition-colors"
                          style={{ background: isExpanded ? "#F8FAFC" : "transparent" }}
                          data-testid={`run-${run.run_id}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: hasErrors ? ERROR_RED : run.finished_at ? EMERALD : "#F59E0B" }} />
                            <span className="text-xs font-mono" style={{ color: "#64748B" }}>{runTime}</span>
                            <span className="text-xs font-mono font-medium" style={{ color: hasErrors ? ERROR_RED : "#334155" }}>
                              {hasErrors ? "Error" : run.finished_at ? "Done" : "Running"}
                            </span>
                          </div>
                          {isExpanded ? <ChevronUp className="w-3 h-3" style={{ color: "#94A3B8" }} /> : <ChevronDown className="w-3 h-3" style={{ color: "#94A3B8" }} />}
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="pl-5 py-1 space-y-0.5">
                                {run.steps.map((s, si) => (
                                  <div key={si} className="flex items-center gap-2 text-xs font-mono" style={{ color: s.status === "error" ? ERROR_RED : "#64748B" }}>
                                    <span>{s.status === "done" ? "\u2713" : s.status === "error" ? "\u2717" : "\u00B7"}</span>
                                    <span>{STEP_LABELS[s.step] || s.step.replace(/_/g, " ")}</span>
                                    {s.duration_ms != null && <span style={{ color: "#CBD5E1" }}>{(s.duration_ms / 1000).toFixed(1)}s</span>}
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div
              className="rounded-2xl p-4"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                maxHeight: "300px",
              }}
              data-testid="card-event-log"
            >
              <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "#94A3B8" }}>
                Event Log
              </p>
              <div style={{ maxHeight: "248px", overflowY: "auto" }} data-testid="panel-event-log">
                {displayEvents.length === 0 ? (
                  <p className="text-xs font-mono text-center py-4" style={{ color: "#CBD5E1" }}>[awaiting signal...]</p>
                ) : (
                  displayEvents.map((evt, idx) => {
                    const time = new Date(evt.receivedAt).toLocaleTimeString("en-US", {
                      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
                    });
                    const severity = evt.payload.severity || "info";
                    const icon = severity === "error" ? "\u26D4" : severity === "warn" ? "\u26A0" : severity === "success" ? "\u2713" : "\u25B6";
                    const iconColor = severity === "error" ? ERROR_RED : severity === "warn" ? "#F59E0B" : severity === "success" ? EMERALD : "#94A3B8";
                    const titleColor = severity === "error" ? ERROR_RED : "#0F172A";
                    const title = evt.payload.human_title || evt.type;
                    const message = evt.payload.human_message || evt.payload.step || evt.payload.trigger || "";
                    return (
                      <div
                        key={`${evt.receivedAt}-${idx}`}
                        className="flex items-start gap-2 py-1.5"
                        style={{ borderBottom: "1px solid #F1F5F9" }}
                        data-testid={`event-row-${idx}`}
                      >
                        <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: iconColor, width: "14px", textAlign: "center" }}>{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold truncate" style={{ color: titleColor }} data-testid={`event-title-${idx}`}>{title}</span>
                            <span className="text-xs font-mono flex-shrink-0" style={{ color: "#94A3B8" }}>{time}</span>
                          </div>
                          <p className="text-xs font-mono truncate mt-0.5" style={{ color: "#64748B" }} data-testid={`event-message-${idx}`}>{message}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "#94A3B8" }}>
            Run Timeline
          </p>
          <StepTimeline activeNodes={activeNodes} doneSteps={doneSteps} runStatus={runStatus} />
        </div>
      </div>
    </AppLayout>
  );
}
