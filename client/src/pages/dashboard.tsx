import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useSSE } from "@/lib/use-sse";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

const NODES = [
  { id: "bootstrap",          label: "Bootstrap",          cx: 450, cy: 120, r: 28 },
  { id: "lead_feed",          label: "Lead Feed",          cx: 200, cy: 210, r: 30 },
  { id: "opportunity_engine", label: "Opportunity\nEngine", cx: 420, cy: 250, r: 34 },
  { id: "dm_coverage",        label: "DM\nCoverage",       cx: 620, cy: 195, r: 30 },
  { id: "dm_fit",             label: "DM Fit",             cx: 700, cy: 310, r: 28 },
  { id: "playbooks",          label: "Playbooks",          cx: 560, cy: 370, r: 30 },
  { id: "call_engine",        label: "Call\nEngine",        cx: 340, cy: 410, r: 32 },
  { id: "query_intel",        label: "Query\nIntel",        cx: 160, cy: 370, r: 28 },
] as const;

const SYNAPSES = [
  { id: "bootstrap->lead_feed",             d: "M 425 138 C 360 160, 280 170, 225 198" },
  { id: "lead_feed->opportunity_engine",     d: "M 228 202 C 280 195, 340 210, 390 240" },
  { id: "opportunity_engine->dm_coverage",   d: "M 452 242 C 500 225, 560 205, 592 200" },
  { id: "dm_coverage->dm_fit",               d: "M 640 218 C 660 250, 680 275, 690 285" },
  { id: "dm_fit->playbooks",                 d: "M 678 328 C 650 345, 610 358, 585 362" },
  { id: "playbooks->call_engine",            d: "M 535 385 C 490 400, 420 410, 370 412" },
  { id: "call_engine->query_intel",          d: "M 310 418 C 270 420, 220 405, 188 385" },
  { id: "query_intel->lead_feed",            d: "M 165 342 C 160 310, 165 270, 185 238" },
] as const;

const MODULE_NAV: Record<string, string> = {
  lead_feed: "/lead-engine",
  query_intel: "/lead-engine",
  opportunity_engine: "/today",
  playbooks: "/today",
  dm_coverage: "/contacts",
  dm_fit: "/contacts",
  call_engine: "/followups",
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
  RUN_STARTED: ">>",
  RUN_DONE: "||",
  STEP_STARTED: ">",
  STEP_DONE: "ok",
  TRIGGER_FIRED: "~~",
  ERROR: "!!",
};

interface PulseDot {
  edgeId: string;
  startTime: number;
  duration: number;
}

function BrainOutline() {
  return (
    <g opacity="0.12">
      <path
        d="M 420 60 C 560 50, 720 80, 780 170 C 830 240, 810 340, 760 400 C 710 460, 600 490, 480 490 C 380 490, 280 480, 200 440 C 120 400, 80 330, 90 260 C 95 200, 130 140, 200 100 C 270 65, 340 60, 420 60 Z"
        fill="none"
        stroke="hsl(175, 60%, 40%)"
        strokeWidth="1.5"
      />
      <path
        d="M 420 65 C 430 180, 440 300, 420 480"
        fill="none"
        stroke="hsl(175, 50%, 35%)"
        strokeWidth="0.8"
        strokeDasharray="4 6"
      />
      <path
        d="M 310 85 C 320 140, 290 200, 250 260 C 220 310, 160 370, 140 420"
        fill="none"
        stroke="hsl(175, 50%, 35%)"
        strokeWidth="0.6"
        strokeDasharray="3 5"
      />
      <path
        d="M 550 75 C 580 130, 620 200, 660 280 C 690 340, 720 390, 730 440"
        fill="none"
        stroke="hsl(175, 50%, 35%)"
        strokeWidth="0.6"
        strokeDasharray="3 5"
      />
    </g>
  );
}

function BrainFolds() {
  return (
    <g opacity="0.06">
      {[
        "M 150 200 C 200 180, 300 170, 380 185 C 450 195, 530 175, 600 190",
        "M 130 280 C 200 260, 320 270, 420 285 C 520 300, 620 280, 700 300",
        "M 180 350 C 250 330, 380 340, 470 355 C 560 370, 650 350, 720 370",
        "M 220 420 C 310 400, 430 410, 520 425 C 600 435, 670 420, 720 430",
        "M 280 140 C 340 125, 440 130, 520 140 C 590 150, 660 135, 720 150",
      ].map((d, i) => (
        <path key={`fold-${i}`} d={d} fill="none" stroke="hsl(175, 40%, 50%)" strokeWidth="1" />
      ))}
    </g>
  );
}

function SecondaryDendrites({ tick }: { tick: number }) {
  const dendrites = useMemo(() => [
    { d: "M 320 130 C 340 155, 300 175, 280 160", o: 0 },
    { d: "M 550 140 C 580 155, 610 145, 595 170", o: 1 },
    { d: "M 160 280 C 130 295, 120 320, 140 335", o: 2 },
    { d: "M 740 260 C 760 280, 770 310, 750 330", o: 3 },
    { d: "M 280 450 C 310 470, 350 475, 380 460", o: 4 },
    { d: "M 500 450 C 530 465, 570 460, 590 440", o: 5 },
    { d: "M 130 180 C 110 200, 100 230, 115 250", o: 6 },
    { d: "M 770 200 C 790 220, 795 250, 780 270", o: 7 },
    { d: "M 250 130 C 230 150, 200 165, 190 185", o: 8 },
    { d: "M 650 130 C 670 150, 690 170, 685 195", o: 9 },
    { d: "M 480 440 C 500 455, 520 460, 540 445", o: 10 },
    { d: "M 200 310 C 175 330, 165 355, 175 370", o: 11 },
  ], []);

  return (
    <g>
      {dendrites.map((den, i) => {
        const phase = tick * 0.08 + den.o * 0.8;
        const op = 0.04 + Math.sin(phase) * 0.03;
        return (
          <path key={`den-${i}`} d={den.d} fill="none" stroke="hsl(175, 60%, 45%)" strokeWidth="0.7" opacity={op} />
        );
      })}
    </g>
  );
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
  const [hoveredModule, setHoveredModule] = useState<string | null>(null);
  const [clickedModule, setClickedModule] = useState<string | null>(null);
  const [firedModules, setFiredModules] = useState<Set<string>>(new Set());
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const brainContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setBrainwaveTick((t) => t + 1), 100);
    return () => clearInterval(interval);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!brainContainerRef.current) return;
    const rect = brainContainerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setMousePos({ x, y });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMousePos({ x: 0.5, y: 0.5 });
  }, []);

  const brainTransform = useMemo(() => {
    const rotY = (mousePos.x - 0.5) * 10;
    const rotX = -(mousePos.y - 0.5) * 8;
    return `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }, [mousePos]);

  const handleRunNow = async () => {
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
  };

  const handleModuleClick = useCallback((moduleId: string) => {
    const target = MODULE_NAV[moduleId];
    if (!target) return;
    setClickedModule(moduleId);
    setTimeout(() => {
      navigate(target);
      setClickedModule(null);
    }, 350);
  }, [navigate]);

  const addPulseDot = useCallback((edgeId: string) => {
    setPulseDots((prev) => {
      const active = prev.filter((d) => Date.now() - d.startTime < d.duration);
      return [...active.slice(-1), { edgeId, startTime: Date.now(), duration: 800 }];
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
    if (lastEvent.type === "STEP_STARTED") {
      const step = lastEvent.payload.step;
      if (step) {
        setFiredModules((prev) => new Set([...prev, step]));
        setTimeout(() => {
          setFiredModules((prev) => { const next = new Set(prev); next.delete(step); return next; });
        }, 600);
      }
    }
  }, [recentEvents, addPulseDot]);

  useEffect(() => {
    if (pulseDots.length === 0) return;
    let frame: number;
    const animate = () => {
      const now = Date.now();
      const active = pulseDots.filter((d) => now - d.startTime < d.duration);
      if (active.length === 0) { setPulseDots([]); setDotPositions(new Map()); return; }
      const newPos = new Map<string, { x: number; y: number }>();
      for (const dot of active) {
        const path = pathRefs.current.get(dot.edgeId);
        if (!path) continue;
        const t = Math.min((now - dot.startTime) / dot.duration, 1);
        const pt = path.getPointAtLength(t * path.getTotalLength());
        newPos.set(dot.edgeId, { x: pt.x, y: pt.y });
      }
      setDotPositions(newPos);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [pulseDots]);

  const statusText =
    runStatus === "running"
      ? `Neural Net: firing -- step: ${[...activeNodes].join(", ") || "initializing"}`
      : runStatus === "error"
        ? "Neural Net: fault detected -- check synaptic log"
        : "Neural Net: idle -- awaiting stimulus";

  const displayEvents = recentEvents.slice(-25).reverse();

  return (
    <AppLayout runStatus={runStatus}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold glow-text" data-testid="text-title">Motherboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono" data-testid="text-status-line">{statusText}</p>
          </div>
          <div className="flex items-center gap-3">
            {connected && (
              <span className="text-xs text-muted-foreground" data-testid="text-sse-status">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />
                SSE
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

        <div
          ref={brainContainerRef}
          className="chip-perspective"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <motion.div
            className="chip-surface"
            style={{ transform: brainTransform }}
            animate={{ scale: runStatus === "running" ? 1 : [1, 1.006, 1] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <svg
              viewBox="0 0 1200 560"
              className="w-full"
              style={{ maxHeight: "calc(100vh - 150px)" }}
              data-testid="svg-motherboard"
            >
              <defs>
                <filter id="glow-cyan">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <filter id="glow-cyan-strong">
                  <feGaussianBlur stdDeviation="10" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <filter id="glow-red">
                  <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="hsl(0, 84%, 60%)" floodOpacity="0.9" />
                </filter>
                <filter id="glow-dim">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="hsl(175, 80%, 50%)" floodOpacity="0.15" />
                </filter>
                <filter id="glow-hover">
                  <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="hsl(175, 80%, 50%)" floodOpacity="0.5" />
                </filter>
                <radialGradient id="node-grad-idle" cx="50%" cy="40%" r="55%">
                  <stop offset="0%" stopColor="hsl(175, 50%, 22%)" />
                  <stop offset="100%" stopColor="hsl(222, 20%, 10%)" />
                </radialGradient>
                <radialGradient id="node-grad-active" cx="50%" cy="40%" r="55%">
                  <stop offset="0%" stopColor="hsl(175, 70%, 35%)" />
                  <stop offset="100%" stopColor="hsl(175, 50%, 15%)" />
                </radialGradient>
                <radialGradient id="node-grad-hover" cx="50%" cy="40%" r="55%">
                  <stop offset="0%" stopColor="hsl(175, 60%, 28%)" />
                  <stop offset="100%" stopColor="hsl(222, 18%, 12%)" />
                </radialGradient>
                <radialGradient id="brain-ambient" cx="50%" cy="45%" r="50%">
                  <stop offset="0%" stopColor="hsl(175, 40%, 15%)" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="transparent" />
                </radialGradient>
              </defs>

              <ellipse cx="430" cy="280" rx="380" ry="240" fill="url(#brain-ambient)" />

              <BrainOutline />
              <BrainFolds />
              <SecondaryDendrites tick={brainwaveTick} />

              {SYNAPSES.map((syn) => (
                <path
                  key={`syn-bg-${syn.id}`}
                  d={syn.d}
                  fill="none"
                  stroke="hsl(175, 60%, 30%)"
                  strokeWidth="4"
                  strokeOpacity="0.08"
                  strokeLinecap="round"
                />
              ))}
              {SYNAPSES.map((syn) => (
                <path
                  key={syn.id}
                  ref={(el) => { if (el) pathRefs.current.set(syn.id, el); }}
                  d={syn.d}
                  fill="none"
                  stroke="hsl(175, 80%, 50%)"
                  strokeWidth={runStatus === "running" ? 1.8 : 1.2}
                  strokeOpacity={runStatus === "running" ? 0.45 : 0.2}
                  strokeLinecap="round"
                  strokeDasharray={runStatus === "running" ? "6 6" : "none"}
                  style={runStatus === "running" ? { animation: "trace-shimmer 2s linear infinite" } : undefined}
                  data-testid={`trace-${syn.id}`}
                />
              ))}

              {Array.from(dotPositions.entries()).map(([edgeId, pos]) => (
                <g key={`pulse-${edgeId}`}>
                  <circle cx={pos.x} cy={pos.y} r={10} fill="hsl(175, 80%, 50%)" opacity={0.15} />
                  <circle cx={pos.x} cy={pos.y} r={5} fill="hsl(175, 85%, 60%)" filter="url(#glow-cyan)" opacity={0.9} />
                </g>
              ))}

              {NODES.map((node, i) => {
                const isActive = activeNodes.has(node.id);
                const isError = runStatus === "error" && activeNodes.has(node.id);
                const isHovered = hoveredModule === node.id;
                const isClicked = clickedModule === node.id;
                const isFiring = firedModules.has(node.id);
                const hasNav = !!MODULE_NAV[node.id];

                let filter = "url(#glow-dim)";
                if (isError) filter = "url(#glow-red)";
                else if (isFiring || isActive) filter = "url(#glow-cyan-strong)";
                else if (isClicked) filter = "url(#glow-cyan)";
                else if (isHovered) filter = "url(#glow-hover)";

                const grad = (isActive || isFiring)
                  ? "url(#node-grad-active)"
                  : (isHovered || isClicked)
                    ? "url(#node-grad-hover)"
                    : "url(#node-grad-idle)";

                const strokeColor = isError
                  ? "hsl(0, 84%, 60%)"
                  : (isActive || isFiring)
                    ? "hsl(175, 80%, 60%)"
                    : (isHovered || isClicked)
                      ? "hsl(175, 70%, 50%)"
                      : "hsl(175, 50%, 30%)";

                const textColor = (isActive || isFiring)
                  ? "hsl(175, 90%, 75%)"
                  : isHovered
                    ? "hsl(175, 60%, 65%)"
                    : "hsl(210, 20%, 70%)";

                let animStyle: string | undefined;
                if (isError) animStyle = "module-fire-red 0.6s ease-out";
                else if (isFiring) animStyle = "module-fire 0.6s ease-out";
                else if (!isActive && !isHovered && !isClicked) animStyle = "node-breathe 3s ease-in-out infinite";

                const lines = node.label.split("\n");
                const displayR = isClicked ? node.r * 1.15 : isHovered ? node.r * 1.05 : node.r;

                return (
                  <g
                    key={node.id}
                    onClick={() => handleModuleClick(node.id)}
                    onMouseEnter={() => setHoveredModule(node.id)}
                    onMouseLeave={() => setHoveredModule(null)}
                    style={{
                      cursor: hasNav ? "pointer" : "default",
                      animation: animStyle,
                      animationDelay: (!isFiring && !isError) ? `${i * 0.4}s` : undefined,
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                    filter={filter}
                    data-testid={`module-${node.id}`}
                  >
                    {(isActive || isFiring) && (
                      <circle cx={node.cx} cy={node.cy} r={displayR + 8} fill="none" stroke="hsl(175, 80%, 50%)" strokeWidth="0.5" strokeOpacity="0.3" strokeDasharray="3 3" />
                    )}
                    <circle
                      cx={node.cx}
                      cy={node.cy}
                      r={displayR}
                      fill={grad}
                      stroke={strokeColor}
                      strokeWidth={isActive || isFiring ? 2 : 1.2}
                    />
                    <circle
                      cx={node.cx}
                      cy={node.cy}
                      r={displayR * 0.6}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth="0.4"
                      strokeOpacity="0.3"
                    />
                    <circle
                      cx={node.cx - displayR * 0.2}
                      cy={node.cy - displayR * 0.25}
                      r={displayR * 0.15}
                      fill="hsl(175, 80%, 60%)"
                      opacity={(isActive || isFiring) ? 0.4 : 0.1}
                    />
                    {lines.map((line, li) => (
                      <text
                        key={`${node.id}-t-${li}`}
                        x={node.cx}
                        y={node.cy + (li - (lines.length - 1) / 2) * 11 + 1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={textColor}
                        fontSize="9"
                        fontWeight={(isActive || isFiring) ? "700" : "500"}
                        fontFamily="Menlo, monospace"
                        letterSpacing="0.3"
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                );
              })}

              <rect x="880" y="55" width="290" height="345" rx="14" fill="hsl(222, 20%, 7%)" stroke="hsl(220, 15%, 15%)" strokeWidth="1" opacity="0.92" />
              <text x="900" y="80" fill="hsl(175, 70%, 45%)" fontSize="10" fontWeight="600" fontFamily="Menlo, monospace" letterSpacing="1.5">
                SYNAPTIC LOG
              </text>
              <line x1="890" y1="90" x2="1160" y2="90" stroke="hsl(220, 15%, 16%)" strokeWidth="0.5" />

              <foreignObject x="885" y="95" width="280" height="298">
                <div
                  style={{
                    height: "298px",
                    overflow: "auto",
                    padding: "4px 6px",
                    fontSize: "10px",
                    fontFamily: "Menlo, monospace",
                    color: "hsl(210, 20%, 65%)",
                    lineHeight: "1.5",
                  }}
                  data-testid="panel-event-log"
                >
                  {displayEvents.length === 0 ? (
                    <div style={{ color: "hsl(215, 15%, 30%)", padding: "16px 0", textAlign: "center" }}>
                      [awaiting stimulus...]
                    </div>
                  ) : (
                    displayEvents.map((evt, idx) => {
                      const time = new Date(evt.receivedAt).toLocaleTimeString("en-US", {
                        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
                      });
                      const icon = EVENT_ICONS[evt.type] || "--";
                      const isErr = evt.type === "ERROR";
                      const msg = evt.payload.step || evt.payload.trigger || evt.payload.message || evt.payload.status || "";
                      return (
                        <div
                          key={`${evt.receivedAt}-${idx}`}
                          style={{
                            padding: "2px 0",
                            borderBottom: "1px solid hsl(220, 15%, 11%)",
                            color: isErr ? "hsl(0, 84%, 65%)" : undefined,
                            display: "flex",
                            gap: "4px",
                            alignItems: "flex-start",
                          }}
                        >
                          <span style={{ width: "18px", textAlign: "center", flexShrink: 0, color: "hsl(175, 60%, 40%)" }}>{icon}</span>
                          <span style={{ color: "hsl(215, 15%, 35%)", flexShrink: 0, fontSize: "9px" }}>{time}</span>
                          <span style={{ color: isErr ? "hsl(0, 84%, 55%)" : "hsl(175, 45%, 45%)", flexShrink: 0, fontSize: "9px" }}>
                            {evt.type}
                          </span>
                          <span style={{ opacity: 0.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "9px" }}>
                            {msg}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </foreignObject>

              <rect x="880" y="415" width="290" height="55" rx="10" fill="hsl(222, 20%, 7%)" stroke="hsl(220, 15%, 15%)" strokeWidth="1" opacity="0.92" />
              <text x="900" y="428" fill="hsl(175, 50%, 38%)" fontSize="8" fontFamily="Menlo, monospace" letterSpacing="0.5">
                EEG
              </text>
              {Array.from({ length: 30 }, (_, i) => {
                const barW = 270 / 30 - 3;
                const x = 890 + i * (barW + 3);
                const maxH = 28;
                const baseH = 3;
                const rateH = Math.min(eventRate * 6, maxH);
                const phase = brainwaveTick * 0.15;
                const noise = Math.sin(phase + i * 0.5) * 2 + 2;
                const h = Math.max(baseH, runStatus === "running" ? rateH + noise : baseH + Math.sin(i * 0.3 + phase * 0.3) * 1.5);
                const barColor = runStatus === "error" ? "hsl(0, 70%, 55%)" : "hsl(175, 80%, 50%)";
                const opacity = runStatus === "running" ? 0.65 : 0.18;
                return (
                  <rect key={`eeg-${i}`} x={x} y={438 + (maxH - h)} width={barW} height={h} rx={1} fill={barColor} opacity={opacity} />
                );
              })}
            </svg>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
}
