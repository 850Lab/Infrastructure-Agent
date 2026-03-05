import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useSSE } from "@/lib/use-sse";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

const NODES = [
  { id: "bootstrap", label: "Bootstrap", x: 90, y: 70, w: 160, h: 56 },
  { id: "lead_feed", label: "Lead Feed", x: 90, y: 200, w: 160, h: 56 },
  { id: "opportunity_engine", label: "Opportunity Engine", x: 310, y: 200, w: 180, h: 56 },
  { id: "dm_coverage", label: "DM Coverage", x: 530, y: 200, w: 160, h: 56 },
  { id: "dm_fit", label: "DM Fit", x: 710, y: 200, w: 160, h: 56 },
  { id: "playbooks", label: "Playbooks", x: 710, y: 320, w: 160, h: 56 },
  { id: "call_engine", label: "Call Engine", x: 310, y: 460, w: 180, h: 56 },
  { id: "query_intel", label: "Query Intel", x: 90, y: 460, w: 160, h: 56 },
] as const;

const EDGES = [
  { id: "bootstrap->lead_feed", d: "M 170 126 C 170 150, 130 150, 130 200" },
  { id: "lead_feed->opportunity_engine", d: "M 250 228 C 290 228, 270 228, 310 228" },
  { id: "opportunity_engine->dm_coverage", d: "M 490 228 C 520 228, 510 228, 530 228" },
  { id: "dm_coverage->dm_fit", d: "M 690 228 C 705 228, 695 228, 710 228" },
  { id: "dm_fit->playbooks", d: "M 790 256 C 790 285, 790 295, 790 320" },
  { id: "playbooks->call_engine", d: "M 790 376 C 720 410, 560 420, 400 460" },
  { id: "call_engine->query_intel", d: "M 310 488 L 250 488" },
  { id: "query_intel->lead_feed", d: "M 170 516 C 170 580, 80 580, 80 256 C 80 240, 120 240, 170 256" },
] as const;

const NODE_NAV: Record<string, string> = {
  opportunity_engine: "/today",
  dm_coverage: "/contacts",
  dm_fit: "/contacts",
  playbooks: "/today",
  call_engine: "/followups",
  query_intel: "/lead-engine",
  lead_feed: "/lead-engine",
  bootstrap: "/analytics",
};

const TRIGGER_EDGE_MAP: Record<string, string> = {
  lead_feed: "query_intel->lead_feed",
  opportunity_engine: "lead_feed->opportunity_engine",
  dm_coverage: "opportunity_engine->dm_coverage",
  dm_fit: "dm_coverage->dm_fit",
  playbooks: "dm_fit->playbooks",
  call_engine: "playbooks->call_engine",
  query_intel: "call_engine->query_intel",
  bootstrap: "bootstrap->lead_feed",
};

const EVENT_ICONS: Record<string, string> = {
  RUN_STARTED: "⏵",
  RUN_DONE: "⏹",
  STEP_STARTED: "▶",
  STEP_DONE: "✓",
  TRIGGER_FIRED: "⚡",
  ERROR: "⛔",
  HEARTBEAT: "·",
};

interface PulseDot {
  edgeId: string;
  startTime: number;
  duration: number;
}

export default function DashboardPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const { recentEvents, activeNodes, runStatus, eventRate, connected } = useSSE(token);
  const [, navigate] = useLocation();
  const [runLoading, setRunLoading] = useState(false);
  const [pulseDots, setPulseDots] = useState<PulseDot[]>([]);
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());
  const [dotPositions, setDotPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const lastEventCount = useRef(0);
  const [brainwaveTick, setBrainwaveTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setBrainwaveTick((t) => t + 1), 100);
    return () => clearInterval(interval);
  }, []);

  const handleRunNow = async () => {
    if (runStatus === "running" || runLoading) return;
    setRunLoading(true);
    try {
      const res = await fetch("/api/run-daily", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 409) return;
      if (!res.ok) throw new Error("Failed to start run");
    } catch {} finally {
      setRunLoading(false);
    }
  };

  const addPulseDot = useCallback((edgeId: string) => {
    setPulseDots((prev) => {
      const active = prev.filter((d) => Date.now() - d.startTime < d.duration);
      const next = [...active.slice(-1), { edgeId, startTime: Date.now(), duration: 800 }];
      return next;
    });
  }, []);

  useEffect(() => {
    if (recentEvents.length === 0 || recentEvents.length === lastEventCount.current) return;
    lastEventCount.current = recentEvents.length;
    const lastEvent = recentEvents[recentEvents.length - 1];
    if (lastEvent.type === "TRIGGER_FIRED") {
      const trigger = lastEvent.payload.trigger || lastEvent.payload.step;
      const edgeId = TRIGGER_EDGE_MAP[trigger];
      if (edgeId) addPulseDot(edgeId);
    }
  }, [recentEvents, addPulseDot]);

  useEffect(() => {
    if (pulseDots.length === 0) return;
    let frame: number;
    const animate = () => {
      const now = Date.now();
      const active = pulseDots.filter((d) => now - d.startTime < d.duration);
      if (active.length === 0) {
        setPulseDots([]);
        setDotPositions(new Map());
        return;
      }
      const newPositions = new Map<string, { x: number; y: number }>();
      for (const dot of active) {
        const path = pathRefs.current.get(dot.edgeId);
        if (!path) continue;
        const t = Math.min((now - dot.startTime) / dot.duration, 1);
        const len = path.getTotalLength();
        const pt = path.getPointAtLength(t * len);
        newPositions.set(dot.edgeId, { x: pt.x, y: pt.y });
      }
      setDotPositions(newPositions);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [pulseDots]);

  const statusText =
    runStatus === "running"
      ? `Neural Net: firing — step: ${[...activeNodes].join(", ") || "initializing"}`
      : runStatus === "error"
        ? "Neural Net: fault detected — check event log"
        : "Neural Net: idle — listening for triggers";

  const displayEvents = recentEvents.slice(-30).reverse();

  return (
    <AppLayout runStatus={runStatus}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold glow-text" data-testid="text-title">Motherboard</h1>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-status-line">{statusText}</p>
          </div>
          <div className="flex items-center gap-3">
            {connected && (
              <span className="text-xs text-muted-foreground" data-testid="text-sse-status">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1"></span>
                SSE Connected
              </span>
            )}
            <Button
              onClick={handleRunNow}
              disabled={runStatus === "running" || runLoading}
              className="glow-border"
              data-testid="button-run-now"
            >
              <Play className="w-4 h-4 mr-2" />
              {runLoading ? "Starting..." : runStatus === "running" ? "Running..." : "Run Now"}
            </Button>
          </div>
        </div>

        <div className="relative">
          <svg
            viewBox="0 0 1200 700"
            className="w-full"
            style={{ maxHeight: "calc(100vh - 160px)" }}
            data-testid="svg-motherboard"
          >
            <defs>
              <filter id="glow-cyan">
                <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="hsl(175, 80%, 50%)" floodOpacity="0.8" />
              </filter>
              <filter id="glow-red">
                <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="hsl(0, 84%, 60%)" floodOpacity="0.8" />
              </filter>
              <filter id="glow-dim">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="hsl(175, 80%, 50%)" floodOpacity="0.2" />
              </filter>
            </defs>

            {EDGES.map((edge) => (
              <path
                key={edge.id}
                id={`edge-${edge.id}`}
                ref={(el) => { if (el) pathRefs.current.set(edge.id, el); }}
                d={edge.d}
                fill="none"
                stroke="hsl(175, 80%, 50%)"
                strokeWidth="2"
                strokeOpacity="0.3"
                data-testid={`edge-${edge.id}`}
              />
            ))}

            {Array.from(dotPositions.entries()).map(([edgeId, pos]) => (
              <circle
                key={`dot-${edgeId}`}
                cx={pos.x}
                cy={pos.y}
                r={5}
                fill="hsl(175, 80%, 50%)"
                filter="url(#glow-cyan)"
                opacity={0.9}
              />
            ))}

            {NODES.map((node, i) => {
              const isActive = activeNodes.has(node.id);
              const isError = runStatus === "error" && activeNodes.has(node.id);
              const filter = isError ? "url(#glow-red)" : isActive ? "url(#glow-cyan)" : "url(#glow-dim)";
              const strokeColor = isError
                ? "hsl(0, 84%, 60%)"
                : isActive
                  ? "hsl(175, 80%, 60%)"
                  : "hsl(175, 80%, 50%)";
              const strokeOpacity = isActive ? 1 : 0.4;

              return (
                <g
                  key={node.id}
                  onClick={() => {
                    const target = NODE_NAV[node.id];
                    if (target) navigate(target);
                  }}
                  style={{
                    cursor: NODE_NAV[node.id] ? "pointer" : "default",
                    animation: !isActive ? `node-breathe 3s ease-in-out infinite` : undefined,
                    animationDelay: `${i * 0.4}s`,
                  }}
                  filter={filter}
                  data-testid={`node-${node.id}`}
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.w}
                    height={node.h}
                    rx={14}
                    fill="hsl(222, 18%, 12%)"
                    stroke={strokeColor}
                    strokeWidth={isActive ? 2 : 1.5}
                    strokeOpacity={strokeOpacity}
                  />
                  <text
                    x={node.x + node.w / 2}
                    y={node.y + node.h / 2 + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={isActive ? "hsl(175, 80%, 70%)" : "hsl(210, 20%, 75%)"}
                    fontSize="13"
                    fontWeight={isActive ? "600" : "400"}
                    fontFamily="Open Sans, sans-serif"
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}

            <rect x="850" y="40" width="330" height="570" rx="12" fill="hsl(222, 18%, 9%)" stroke="hsl(220, 15%, 16%)" strokeWidth="1" />
            <text x="870" y="68" fill="hsl(175, 80%, 50%)" fontSize="14" fontWeight="600" fontFamily="Open Sans, sans-serif">
              Event Log
            </text>
            <line x1="860" y1="78" x2="1170" y2="78" stroke="hsl(220, 15%, 16%)" strokeWidth="1" />

            <foreignObject x="855" y="85" width="320" height="520">
              <div
                style={{
                  height: "520px",
                  overflow: "auto",
                  padding: "4px 8px",
                  fontSize: "11px",
                  fontFamily: "Menlo, monospace",
                  color: "hsl(210, 20%, 70%)",
                }}
                data-testid="panel-event-log"
              >
                {displayEvents.length === 0 ? (
                  <div style={{ color: "hsl(215, 15%, 45%)", padding: "16px 0", textAlign: "center" }}>
                    Waiting for events...
                  </div>
                ) : (
                  displayEvents.map((evt, i) => {
                    const time = new Date(evt.receivedAt).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    });
                    const icon = EVENT_ICONS[evt.type] || "•";
                    const isErr = evt.type === "ERROR";
                    const msg =
                      evt.payload.step || evt.payload.trigger || evt.payload.message || evt.payload.status || "";
                    return (
                      <div
                        key={`${evt.receivedAt}-${i}`}
                        style={{
                          padding: "3px 0",
                          borderBottom: "1px solid hsl(220, 15%, 14%)",
                          color: isErr ? "hsl(0, 84%, 65%)" : undefined,
                          display: "flex",
                          gap: "6px",
                          alignItems: "flex-start",
                        }}
                      >
                        <span style={{ width: "16px", textAlign: "center", flexShrink: 0 }}>{icon}</span>
                        <span style={{ color: "hsl(215, 15%, 45%)", flexShrink: 0 }}>{time}</span>
                        <span style={{ color: isErr ? "hsl(0, 84%, 65%)" : "hsl(175, 60%, 55%)", flexShrink: 0 }}>
                          {evt.type}
                        </span>
                        <span style={{ opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {msg}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </foreignObject>

            <rect x="40" y="630" width="1140" height="60" rx="8" fill="hsl(222, 18%, 9%)" stroke="hsl(220, 15%, 16%)" strokeWidth="1" />
            {Array.from({ length: 40 }, (_, i) => {
              const barWidth = 1140 / 40 - 4;
              const x = 42 + i * (barWidth + 4);
              const maxH = 50;
              const baseH = 4;
              const rateH = Math.min(eventRate * 8, maxH);
              const phase = brainwaveTick * 0.15;
              const noise = Math.sin(phase + i * 0.5) * 3 + 3;
              const h = Math.max(baseH, runStatus === "running" ? rateH + noise : baseH + Math.sin(i * 0.3 + phase * 0.3) * 2);
              const barColor =
                runStatus === "error"
                  ? "hsl(0, 70%, 55%)"
                  : "hsl(175, 80%, 50%)";
              const opacity = runStatus === "running" ? 0.7 : 0.2;

              return (
                <rect
                  key={`bar-${i}`}
                  x={x}
                  y={635 + (maxH - h)}
                  width={barWidth}
                  height={h}
                  rx={2}
                  fill={barColor}
                  opacity={opacity}
                />
              );
            })}
          </svg>
        </div>
      </div>
    </AppLayout>
  );
}
