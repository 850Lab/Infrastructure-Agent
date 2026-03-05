import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useSSE } from "@/lib/use-sse";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Play, ChevronDown, ChevronUp } from "lucide-react";

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
  bootstrap: "Bootstrap",
  opportunity_engine: "Opp Engine",
  dm_coverage: "DM Coverage",
  dm_fit: "DM Fit",
  playbooks: "Playbooks",
  call_engine: "Call Engine",
  query_intel: "Query Intel",
  lead_feed: "Lead Feed",
};

const SECTION_BUTTONS = [
  { label: "Today", route: "/today", steps: ["opportunity_engine", "playbooks"] },
  { label: "Follow-ups", route: "/followups", steps: ["call_engine"] },
  { label: "Lead Engine", route: "/lead-engine", steps: ["lead_feed", "query_intel"] },
  { label: "Contacts", route: "/contacts", steps: ["dm_coverage", "dm_fit"] },
  { label: "Analytics", route: "/analytics", steps: ["bootstrap"] },
];

const EVENT_ICONS: Record<string, string> = {
  RUN_STARTED: "\u23F5",
  RUN_DONE: "\u23F9",
  STEP_STARTED: "\u25B6",
  STEP_DONE: "\u2713",
  TRIGGER_FIRED: "\u26A1",
  ERROR: "\u26D4",
};

function PulseReactor({ runStatus, shockwave, burst }: {
  runStatus: "standby" | "running" | "error";
  shockwave: number;
  burst: number;
}) {
  const ringColor = runStatus === "error" ? "#EF4444" : runStatus === "running" ? "#22D3EE" : "#2DD4BF";
  const innerGlow = runStatus === "error" ? "rgba(239,68,68,0.15)" : runStatus === "running" ? "rgba(34,211,238,0.12)" : "rgba(45,212,191,0.06)";

  return (
    <div className="relative flex items-center justify-center" style={{ width: "100%", aspectRatio: "1" }}>
      <AnimatePresence>
        {shockwave > 0 && (
          <motion.div
            key={`shock-${shockwave}`}
            className="absolute rounded-full"
            style={{ border: `2px solid ${ringColor}` }}
            initial={{ width: "40%", height: "40%", opacity: 0.8 }}
            animate={{ width: "110%", height: "110%", opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {burst > 0 && (
          <motion.div
            key={`burst-${burst}`}
            className="absolute rounded-full"
            style={{ background: `radial-gradient(circle, ${ringColor}40 0%, transparent 70%)` }}
            initial={{ width: "50%", height: "50%", opacity: 0.6 }}
            animate={{ width: "90%", height: "90%", opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      <motion.div
        className="absolute rounded-full"
        style={{
          width: "85%",
          height: "85%",
          border: `1px solid rgba(45,212,191,0.08)`,
        }}
        animate={{ scale: runStatus === "running" ? [1, 1.03, 1] : [1, 1.01, 1] }}
        transition={{ duration: runStatus === "running" ? 1.5 : 3, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        className="absolute rounded-full"
        style={{
          width: "65%",
          height: "65%",
          border: `1px solid rgba(45,212,191,0.1)`,
        }}
        animate={{ scale: runStatus === "running" ? [1, 1.05, 1] : [1, 1.02, 1] }}
        transition={{ duration: runStatus === "running" ? 1.2 : 2.8, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
      />

      <motion.div
        className="absolute rounded-full"
        style={{
          width: "50%",
          height: "50%",
          background: innerGlow,
          boxShadow: `0 0 60px ${ringColor}30, 0 0 120px ${ringColor}10`,
        }}
        animate={{
          scale: runStatus === "running" ? [1, 1.08, 1] : runStatus === "error" ? [1, 1.1, 0.95, 1] : [1, 1.03, 1],
          opacity: runStatus === "error" ? [0.6, 1, 0.4, 0.8] : undefined,
        }}
        transition={{
          duration: runStatus === "running" ? 1 : runStatus === "error" ? 0.6 : 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {runStatus === "running" && (
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "50%",
            height: "50%",
            background: `conic-gradient(from 0deg, transparent 0deg, ${ringColor}30 30deg, transparent 60deg)`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />
      )}

      <motion.div
        className="absolute rounded-full"
        style={{
          width: "48%",
          height: "48%",
          border: `2px solid ${ringColor}`,
          boxShadow: `0 0 20px ${ringColor}40, inset 0 0 20px ${ringColor}10`,
        }}
        animate={{
          scale: runStatus === "running" ? [1, 1.04, 1] : [1, 1.015, 1],
          borderColor: runStatus === "error" ? ["#EF4444", "#EF444480", "#EF4444"] : undefined,
        }}
        transition={{
          duration: runStatus === "running" ? 1 : 3.2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <div className="absolute flex flex-col items-center justify-center text-center z-10">
        <span
          className="text-xs font-mono tracking-widest uppercase"
          style={{ color: "rgba(255,255,255,0.3)" }}
        >
          reactor
        </span>
        <span
          className="text-lg font-bold font-mono tracking-wider mt-1"
          style={{ color: ringColor }}
          data-testid="reactor-status"
        >
          {runStatus === "running" ? "ACTIVE" : runStatus === "error" ? "FAULT" : "IDLE"}
        </span>
      </div>
    </div>
  );
}

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

        let bg = "rgba(255,255,255,0.04)";
        let border = "rgba(255,255,255,0.08)";
        let color = "rgba(255,255,255,0.3)";
        let shadow = "none";

        if (isError) {
          bg = "rgba(239,68,68,0.15)";
          border = "rgba(239,68,68,0.4)";
          color = "#EF4444";
          shadow = "0 0 12px rgba(239,68,68,0.3)";
        } else if (isActive) {
          bg = "rgba(34,211,238,0.12)";
          border = "rgba(34,211,238,0.4)";
          color = "#22D3EE";
          shadow = "0 0 12px rgba(34,211,238,0.3)";
        } else if (isDone) {
          bg = "rgba(45,212,191,0.08)";
          border = "rgba(45,212,191,0.2)";
          color = "rgba(45,212,191,0.6)";
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
  const lastEventCount = useRef(0);

  const { data: stats } = useQuery<{
    today_list_count: number | null;
    fresh_pool_count: number | null;
    dm_resolved_count: number | null;
    playbooks_ready_count: number | null;
  }>({
    queryKey: ["/api/dashboard/stats"],
    enabled: !!token,
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

  useEffect(() => {
    if (recentEvents.length === 0 || recentEvents.length === lastEventCount.current) return;
    lastEventCount.current = recentEvents.length;
    const last = recentEvents[recentEvents.length - 1];

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
    ? `Processing run${recentEvents.length > 0 ? "" : ""}`
    : runStatus === "error"
      ? "Fault detected — check event log"
      : "Listening for triggers";

  const displayEvents = recentEvents.slice(-30).reverse();
  const displayHistory = (runHistory || []).slice(0, 10);

  const kpis = [
    { label: "Today List", value: stats?.today_list_count },
    { label: "Fresh Pool", value: stats?.fresh_pool_count },
    { label: "DMs Resolved", value: stats?.dm_resolved_count },
    { label: "Playbooks", value: stats?.playbooks_ready_count },
  ];

  return (
    <AppLayout runStatus={runStatus}>
      <div className="p-4 md:p-6" style={{ background: "#070B12", minHeight: "calc(100vh - 56px)" }}>
        <div className="flex flex-wrap items-center gap-2 mb-6" data-testid="section-nav">
          {SECTION_BUTTONS.map((sec) => {
            const isStepActive = sec.steps.some((s) => activeNodes.has(s));
            return (
              <button
                key={sec.route}
                onClick={() => navigate(sec.route)}
                className="px-5 py-2 rounded-full font-mono text-sm font-medium transition-all duration-300"
                style={{
                  background: isStepActive ? "rgba(34,211,238,0.12)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${isStepActive ? "rgba(34,211,238,0.35)" : "rgba(255,255,255,0.08)"}`,
                  color: isStepActive ? "#22D3EE" : "rgba(255,255,255,0.5)",
                  boxShadow: isStepActive ? "0 0 16px rgba(34,211,238,0.2)" : "none",
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
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                backdropFilter: "blur(12px)",
              }}
              data-testid="card-system-status"
            >
              <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "rgba(255,255,255,0.3)" }}>
                System Status
              </p>
              <p
                className="text-3xl font-bold font-mono tracking-wider mb-1"
                style={{
                  color: runStatus === "error" ? "#EF4444" : runStatus === "running" ? "#22D3EE" : "#2DD4BF",
                }}
                data-testid="text-system-status"
              >
                {statusLabel}
              </p>
              <p className="text-xs font-mono mb-4" style={{ color: "rgba(255,255,255,0.3)" }} data-testid="text-status-line">
                {statusSub}
              </p>

              {connected && (
                <div className="flex items-center gap-1.5 mb-4">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#2DD4BF" }} />
                  <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.25)" }} data-testid="text-sse-status">SSE Connected</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {kpis.map((kpi) => (
                  <div key={kpi.label} className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <p className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{kpi.label}</p>
                    <p className="text-lg font-bold font-mono" style={{ color: "#2DD4BF" }} data-testid={`kpi-${kpi.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      {kpi.value != null ? kpi.value : "\u2014"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <Button
              onClick={handleRunNow}
              disabled={runStatus === "running" || runLoading}
              className="w-full h-12 text-base font-mono font-bold tracking-wider rounded-xl"
              style={{
                background: runStatus === "running" ? "rgba(34,211,238,0.1)" : "rgba(45,212,191,0.12)",
                color: runStatus === "running" ? "#22D3EE" : "#2DD4BF",
                border: `1px solid ${runStatus === "running" ? "rgba(34,211,238,0.3)" : "rgba(45,212,191,0.3)"}`,
                boxShadow: "0 0 20px rgba(45,212,191,0.1)",
              }}
              data-testid="button-run-now"
            >
              <Play className="w-5 h-5 mr-2" />
              {runLoading ? "STARTING..." : runStatus === "running" ? "RUNNING..." : "RUN NOW"}
            </Button>
          </div>

          <div className="lg:col-span-2 flex items-center justify-center">
            <div className="w-full max-w-md">
              <PulseReactor runStatus={runStatus} shockwave={shockwave} burst={burst} />
            </div>
          </div>

          <div className="lg:col-span-1 space-y-5">
            <div
              className="rounded-2xl p-4"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                backdropFilter: "blur(12px)",
                maxHeight: "260px",
              }}
              data-testid="panel-run-history"
            >
              <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "rgba(255,255,255,0.3)" }}>
                Run History
              </p>
              <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                {displayHistory.length === 0 ? (
                  <p className="text-xs font-mono text-center py-4" style={{ color: "rgba(255,255,255,0.15)" }}>No runs yet</p>
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
                          style={{ background: isExpanded ? "rgba(255,255,255,0.04)" : "transparent" }}
                          data-testid={`run-${run.run_id}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: hasErrors ? "#EF4444" : run.finished_at ? "#2DD4BF" : "#22D3EE" }} />
                            <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{runTime}</span>
                            <span className="text-xs font-mono" style={{ color: hasErrors ? "#EF4444" : "rgba(255,255,255,0.3)" }}>
                              {hasErrors ? "Error" : run.finished_at ? "Done" : "Running"}
                            </span>
                          </div>
                          {isExpanded ? <ChevronUp className="w-3 h-3" style={{ color: "rgba(255,255,255,0.2)" }} /> : <ChevronDown className="w-3 h-3" style={{ color: "rgba(255,255,255,0.2)" }} />}
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
                                  <div key={si} className="flex items-center gap-2 text-xs font-mono" style={{ color: s.status === "error" ? "#EF4444" : "rgba(255,255,255,0.3)" }}>
                                    <span>{s.status === "done" ? "\u2713" : s.status === "error" ? "\u2717" : "\u00B7"}</span>
                                    <span>{s.step}</span>
                                    {s.duration_ms != null && <span style={{ color: "rgba(255,255,255,0.15)" }}>{(s.duration_ms / 1000).toFixed(1)}s</span>}
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
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                backdropFilter: "blur(12px)",
                maxHeight: "300px",
              }}
              data-testid="card-event-log"
            >
              <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "rgba(255,255,255,0.3)" }}>
                Event Log
              </p>
              <div style={{ maxHeight: "248px", overflowY: "auto" }} data-testid="panel-event-log">
                {displayEvents.length === 0 ? (
                  <p className="text-xs font-mono text-center py-4" style={{ color: "rgba(255,255,255,0.15)" }}>[awaiting signal...]</p>
                ) : (
                  displayEvents.map((evt, idx) => {
                    const time = new Date(evt.receivedAt).toLocaleTimeString("en-US", {
                      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
                    });
                    const icon = EVENT_ICONS[evt.type] || "\u00B7";
                    const isErr = evt.type === "ERROR";
                    const msg = evt.payload.step || evt.payload.trigger || evt.payload.message || evt.payload.status || "";
                    return (
                      <div
                        key={`${evt.receivedAt}-${idx}`}
                        className="flex items-start gap-2 py-1"
                        style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                      >
                        <span className="text-xs flex-shrink-0" style={{ color: isErr ? "#EF4444" : "#2DD4BF", width: "14px", textAlign: "center" }}>{icon}</span>
                        <span className="text-xs font-mono flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>{time}</span>
                        <span className="text-xs font-mono flex-shrink-0 font-semibold" style={{ color: isErr ? "#EF4444" : "rgba(45,212,191,0.6)" }}>{evt.type}</span>
                        <span className="text-xs font-mono truncate" style={{ color: "rgba(255,255,255,0.3)" }}>{msg}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "rgba(255,255,255,0.2)" }}>
            Run Timeline
          </p>
          <StepTimeline activeNodes={activeNodes} doneSteps={doneSteps} runStatus={runStatus} />
        </div>
      </div>
    </AppLayout>
  );
}
