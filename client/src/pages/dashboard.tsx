import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useSSE } from "@/lib/use-sse";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

const NODES = [
  { id: "bootstrap",          label: "Bootstrap",            cx: 210, cy: 520, r: 22 },
  { id: "lead_feed",          label: "Lead Feed",            cx: 260, cy: 315, r: 24 },
  { id: "opportunity_engine", label: "Opportunity\nEngine",  cx: 360, cy: 240, r: 28 },
  { id: "dm_coverage",        label: "DM Coverage",          cx: 430, cy: 355, r: 24 },
  { id: "dm_fit",             label: "DM Fit",               cx: 480, cy: 270, r: 22 },
  { id: "playbooks",          label: "Playbooks",            cx: 560, cy: 240, r: 24 },
  { id: "call_engine",        label: "Call Engine",           cx: 320, cy: 500, r: 24 },
  { id: "query_intel",        label: "Query Intel",           cx: 210, cy: 430, r: 22 },
] as const;

const SYNAPSES = [
  { id: "edge-bootstrap-lead_feed",           d: "M 210 520 C 220 470, 240 390, 260 315" },
  { id: "edge-lead_feed-opportunity_engine",   d: "M 260 315 C 300 290, 320 270, 360 240" },
  { id: "edge-opportunity_engine-dm_coverage", d: "M 360 240 C 400 260, 410 310, 430 355" },
  { id: "edge-dm_coverage-dm_fit",             d: "M 430 355 C 450 330, 465 300, 480 270" },
  { id: "edge-dm_fit-playbooks",               d: "M 480 270 C 510 255, 535 245, 560 240" },
  { id: "edge-playbooks-call_engine",          d: "M 560 240 C 520 320, 430 430, 320 500" },
  { id: "edge-call_engine-query_intel",        d: "M 320 500 C 290 485, 250 460, 210 430" },
  { id: "edge-query_intel-lead_feed",          d: "M 210 430 C 210 380, 230 340, 260 315" },
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
  bootstrap: "edge-bootstrap-lead_feed",
  lead_feed: "edge-lead_feed-opportunity_engine",
  opportunity_engine: "edge-opportunity_engine-dm_coverage",
  dm_coverage: "edge-dm_coverage-dm_fit",
  dm_fit: "edge-dm_fit-playbooks",
  playbooks: "edge-playbooks-call_engine",
  call_engine: "edge-call_engine-query_intel",
  query_intel: "edge-query_intel-lead_feed",
};

const EVENT_ICONS: Record<string, string> = {
  RUN_STARTED: "\u23F5",
  RUN_DONE: "\u23F9",
  STEP_STARTED: "\u25B6",
  STEP_DONE: "\u2713",
  TRIGGER_FIRED: "\u26A1",
  ERROR: "\u26D4",
};

const REGION_TOOLTIPS: Record<string, string> = {
  frontal: "Frontal: Today Console",
  temporal: "Temporal: Contacts & DMs",
  parietal: "Parietal/Occipital: Lead Engine",
  cerebellum: "Cerebellum: Follow-ups",
  brainstem: "Brainstem: Analytics / System",
};

const REGION_NAV: Record<string, string> = {
  frontal: "/today",
  temporal: "/contacts",
  parietal: "/lead-engine",
  cerebellum: "/followups",
  brainstem: "/analytics",
};

interface PulseDot {
  edgeId: string;
  startTime: number;
  duration: number;
}

function BrainSilhouette({ runStatus, onRegionClick, hoveredRegion, onRegionHover }: {
  runStatus: string;
  onRegionClick: (region: string) => void;
  hoveredRegion: string | null;
  onRegionHover: (region: string | null) => void;
}) {
  const brainOutline = "M 580 160 C 620 140, 660 140, 690 160 C 720 180, 730 200, 720 230 C 710 260, 680 280, 660 310 C 640 340, 630 360, 640 380 C 650 400, 640 420, 620 430 C 600 440, 570 440, 540 430 C 510 420, 480 400, 450 390 C 420 380, 380 380, 350 390 C 320 400, 290 420, 260 440 C 230 460, 200 470, 180 460 C 160 450, 150 430, 155 400 C 160 370, 170 340, 165 310 C 160 280, 140 260, 130 230 C 120 200, 130 170, 160 150 C 190 130, 230 120, 270 115 C 310 110, 360 110, 400 115 C 440 120, 480 130, 520 140 C 550 148, 565 155, 580 160 Z";

  const cerebellumPath = "M 250 460 C 260 480, 280 500, 310 510 C 340 520, 370 520, 390 510 C 370 530, 340 540, 310 540 C 280 540, 255 530, 240 510 C 230 495, 235 475, 250 460 Z";

  const brainstemPath = "M 200 470 C 205 490, 210 510, 215 530 C 218 545, 215 555, 210 560 C 205 555, 200 545, 197 530 C 192 510, 188 490, 190 470 Z";

  const frontalFill = "M 460 130 C 500 138, 540 148, 570 158 C 600 145, 640 140, 680 160 C 710 175, 725 200, 718 228 C 700 220, 670 210, 630 210 C 580 210, 530 220, 490 240 C 460 200, 450 165, 460 130 Z";
  const parietalFill = "M 270 118 C 310 112, 360 112, 400 118 C 440 124, 460 135, 460 135 C 450 170, 460 200, 490 240 C 450 260, 400 270, 350 265 C 300 260, 260 240, 240 210 C 230 185, 240 155, 270 118 Z";
  const temporalFill = "M 240 210 C 260 240, 300 260, 350 265 C 330 290, 300 310, 270 330 C 240 350, 210 360, 180 355 C 160 345, 145 320, 140 290 C 138 265, 145 240, 160 215 C 175 200, 200 200, 240 210 Z";
  const occipitalFill = "M 180 355 C 170 370, 165 390, 165 400 C 165 420, 175 440, 195 455 C 215 465, 235 460, 250 450 C 230 430, 210 400, 200 370 C 195 360, 188 355, 180 355 Z";
  const cerebellumFill = "M 250 460 C 260 480, 280 500, 310 510 C 340 520, 370 520, 390 510 C 370 530, 340 540, 310 540 C 280 540, 255 530, 240 510 C 230 495, 235 475, 250 460 Z";

  const regionOpacity = (r: string) => hoveredRegion === r ? 0.18 : 0.09;

  return (
    <g>
      <path d={frontalFill} fill="#2DD4BF" opacity={regionOpacity("frontal")} style={{ cursor: "pointer" }}
        onClick={() => onRegionClick("frontal")} onMouseEnter={() => onRegionHover("frontal")} onMouseLeave={() => onRegionHover(null)}
        data-testid="region-frontal">
        <title>{REGION_TOOLTIPS.frontal}</title>
      </path>
      <path d={parietalFill} fill="#22D3EE" opacity={regionOpacity("parietal")} style={{ cursor: "pointer" }}
        onClick={() => onRegionClick("parietal")} onMouseEnter={() => onRegionHover("parietal")} onMouseLeave={() => onRegionHover(null)}
        data-testid="region-parietal">
        <title>{REGION_TOOLTIPS.parietal}</title>
      </path>
      <path d={temporalFill} fill="#2DD4BF" opacity={regionOpacity("temporal")} style={{ cursor: "pointer" }}
        onClick={() => onRegionClick("temporal")} onMouseEnter={() => onRegionHover("temporal")} onMouseLeave={() => onRegionHover(null)}
        data-testid="region-temporal">
        <title>{REGION_TOOLTIPS.temporal}</title>
      </path>
      <path d={occipitalFill} fill="#38BDF8" opacity={regionOpacity("parietal")} style={{ cursor: "pointer" }}
        onClick={() => onRegionClick("parietal")} onMouseEnter={() => onRegionHover("parietal")} onMouseLeave={() => onRegionHover(null)}
        data-testid="region-occipital">
        <title>{REGION_TOOLTIPS.parietal}</title>
      </path>
      <path d={cerebellumFill} fill="#22D3EE" opacity={regionOpacity("cerebellum")} style={{ cursor: "pointer" }}
        onClick={() => onRegionClick("cerebellum")} onMouseEnter={() => onRegionHover("cerebellum")} onMouseLeave={() => onRegionHover(null)}
        data-testid="region-cerebellum">
        <title>{REGION_TOOLTIPS.cerebellum}</title>
      </path>
      <path d={brainstemPath} fill="#38BDF8" opacity={regionOpacity("brainstem")} style={{ cursor: "pointer" }}
        onClick={() => onRegionClick("brainstem")} onMouseEnter={() => onRegionHover("brainstem")} onMouseLeave={() => onRegionHover(null)}
        data-testid="region-brainstem">
        <title>{REGION_TOOLTIPS.brainstem}</title>
      </path>

      <path d={brainOutline} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d={cerebellumPath} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.4" />
      <path d={brainstemPath} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.2" />

      <text x="560" y="185" fill="rgba(255,255,255,0.12)" fontSize="10" fontFamily="Menlo, monospace" letterSpacing="1.5" data-testid="label-frontal">FRONTAL</text>
      <text x="300" y="185" fill="rgba(255,255,255,0.12)" fontSize="10" fontFamily="Menlo, monospace" letterSpacing="1.5" data-testid="label-parietal">PARIETAL</text>
      <text x="175" y="300" fill="rgba(255,255,255,0.12)" fontSize="9" fontFamily="Menlo, monospace" letterSpacing="1" data-testid="label-temporal">TEMPORAL</text>
      <text x="160" y="405" fill="rgba(255,255,255,0.12)" fontSize="8" fontFamily="Menlo, monospace" letterSpacing="1" data-testid="label-occipital">OCCIPITAL</text>
      <text x="290" y="535" fill="rgba(255,255,255,0.12)" fontSize="8" fontFamily="Menlo, monospace" letterSpacing="1" data-testid="label-cerebellum">CEREBELLUM</text>
      <text x="175" y="570" fill="rgba(255,255,255,0.10)" fontSize="7" fontFamily="Menlo, monospace" letterSpacing="1" data-testid="label-brainstem">BRAINSTEM</text>
    </g>
  );
}

function GyriLines() {
  return (
    <g>
      {[
        "M 300 140 C 350 135, 420 135, 470 145",
        "M 280 165 C 330 155, 400 155, 460 168",
        "M 240 195 C 290 180, 370 178, 440 195",
        "M 220 230 C 270 215, 360 210, 440 225",
        "M 190 270 C 230 255, 310 250, 390 265",
        "M 170 310 C 210 295, 290 290, 360 305",
        "M 165 350 C 200 335, 260 330, 320 345",
        "M 500 180 C 540 175, 590 180, 640 195",
        "M 520 210 C 560 200, 610 200, 660 215",
        "M 510 245 C 550 235, 600 235, 650 255",
        "M 490 280 C 530 270, 580 275, 630 295",
        "M 470 320 C 510 310, 560 315, 620 335",
        "M 440 355 C 480 345, 530 345, 590 360",
        "M 260 470 C 280 485, 310 495, 340 500",
        "M 270 480 C 290 495, 320 505, 350 510",
        "M 540 190 C 570 185, 600 185, 630 195",
      ].map((d, i) => (
        <path key={`gyri-${i}`} d={d} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" strokeLinecap="round" />
      ))}
    </g>
  );
}

function Dendrites({ tick }: { tick: number }) {
  const dendrites = useMemo(() => [
    { d: "M 360 240 C 340 220, 320 200, 310 180", o: 0 },
    { d: "M 360 240 C 380 220, 395 200, 400 180", o: 1 },
    { d: "M 560 240 C 580 220, 600 210, 620 200", o: 2 },
    { d: "M 560 240 C 590 250, 620 260, 650 270", o: 3 },
    { d: "M 260 315 C 240 295, 220 275, 200 260", o: 4 },
    { d: "M 260 315 C 280 295, 295 275, 300 255", o: 5 },
    { d: "M 430 355 C 410 375, 390 390, 370 400", o: 6 },
    { d: "M 480 270 C 500 250, 520 240, 535 230", o: 7 },
    { d: "M 210 430 C 190 410, 175 390, 168 370", o: 8 },
    { d: "M 210 430 C 195 445, 185 455, 180 465", o: 9 },
    { d: "M 320 500 C 340 515, 355 525, 370 530", o: 10 },
    { d: "M 210 520 C 200 540, 195 555, 195 565", o: 11 },
    { d: "M 430 355 C 450 365, 470 375, 490 380", o: 12 },
    { d: "M 560 240 C 570 225, 575 210, 575 195", o: 13 },
    { d: "M 360 240 C 350 260, 340 280, 325 295", o: 14 },
  ], []);

  return (
    <g>
      {dendrites.map((den, i) => {
        const phase = tick * 0.08 + den.o * 0.7;
        const op = 0.04 + Math.sin(phase) * 0.025;
        return (
          <path key={`den-${i}`} d={den.d} fill="none" stroke="#2DD4BF" strokeWidth="0.6" opacity={op} strokeLinecap="round" />
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
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
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
    setMousePos({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMousePos({ x: 0.5, y: 0.5 });
  }, []);

  const brainTransform = useMemo(() => {
    const rotY = (mousePos.x - 0.5) * 16;
    const rotX = -(mousePos.y - 0.5) * 12;
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

  const handleRegionClick = useCallback((region: string) => {
    const target = REGION_NAV[region];
    if (target) navigate(target);
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
      ? `Neural Net: firing \u2014 step: ${[...activeNodes].join(", ") || "initializing"}`
      : runStatus === "error"
        ? "Neural Net: fault detected \u2014 check event log"
        : "Neural Net: idle \u2014 listening for triggers";

  const displayEvents = recentEvents.slice(-30).reverse();

  return (
    <AppLayout runStatus={runStatus}>
      <div className="p-4" style={{ background: "#070B12" }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold glow-text" data-testid="text-title">Motherboard</h1>
            <p className="text-xs mt-0.5 font-mono" style={{ color: "rgba(255,255,255,0.4)" }} data-testid="text-status-line">{statusText}</p>
          </div>
          <div className="flex items-center gap-3">
            {connected && (
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }} data-testid="text-sse-status">
                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#2DD4BF" }} />
                SSE
              </span>
            )}
            <Button
              onClick={handleRunNow}
              disabled={runStatus === "running" || runLoading}
              className="glow-border"
              style={{ background: "rgba(45,212,191,0.15)", color: "#2DD4BF", border: "1px solid rgba(45,212,191,0.3)" }}
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
            animate={{ scale: runStatus === "running" ? 1 : [1, 1.01, 1] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <svg
              viewBox="0 0 1200 620"
              className="w-full"
              style={{ maxHeight: "calc(100vh - 140px)" }}
              data-testid="svg-motherboard"
            >
              <defs>
                <filter id="glow-teal">
                  <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#2DD4BF" floodOpacity="0.6" />
                </filter>
                <filter id="glow-cyan-strong">
                  <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#22D3EE" floodOpacity="0.9" />
                </filter>
                <filter id="glow-red">
                  <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#EF4444" floodOpacity="0.9" />
                </filter>
                <filter id="glow-dim">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#2DD4BF" floodOpacity="0.2" />
                </filter>
                <filter id="glow-hover">
                  <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#2DD4BF" floodOpacity="0.5" />
                </filter>
                <filter id="glow-pulse-dot">
                  <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#38BDF8" floodOpacity="0.8" />
                </filter>
                <filter id="glow-synapse">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <radialGradient id="node-idle" cx="50%" cy="40%" r="55%">
                  <stop offset="0%" stopColor="#1a3a35" />
                  <stop offset="100%" stopColor="#0a1520" />
                </radialGradient>
                <radialGradient id="node-active" cx="50%" cy="40%" r="55%">
                  <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#0d2d3a" />
                </radialGradient>
                <radialGradient id="node-hover" cx="50%" cy="40%" r="55%">
                  <stop offset="0%" stopColor="#2DD4BF" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#0f1f2a" />
                </radialGradient>
                <radialGradient id="brain-glow" cx="45%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#2DD4BF" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="transparent" />
                </radialGradient>
              </defs>

              <ellipse cx="400" cy="350" rx="350" ry="280" fill="url(#brain-glow)" />

              <BrainSilhouette
                runStatus={runStatus}
                onRegionClick={handleRegionClick}
                hoveredRegion={hoveredRegion}
                onRegionHover={setHoveredRegion}
              />
              <GyriLines />
              <Dendrites tick={brainwaveTick} />

              {SYNAPSES.map((syn) => (
                <path
                  key={`syn-bg-${syn.id}`}
                  d={syn.d}
                  fill="none"
                  stroke="rgba(45,212,191,0.08)"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
              ))}
              {SYNAPSES.map((syn) => (
                <path
                  key={syn.id}
                  ref={(el) => { if (el) pathRefs.current.set(syn.id, el); }}
                  d={syn.d}
                  fill="none"
                  stroke={runStatus === "running" ? "rgba(34,211,238,0.45)" : "rgba(45,212,191,0.25)"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={runStatus === "running" ? "8 6" : "none"}
                  style={runStatus === "running" ? { animation: "trace-shimmer 2s linear infinite" } : undefined}
                  filter="url(#glow-synapse)"
                  data-testid={`trace-${syn.id}`}
                />
              ))}

              {Array.from(dotPositions.entries()).map(([edgeId, pos]) => (
                <g key={`pulse-${edgeId}`}>
                  <circle cx={pos.x} cy={pos.y} r={12} fill="#38BDF8" opacity={0.12} />
                  <circle cx={pos.x} cy={pos.y} r={5} fill="#38BDF8" filter="url(#glow-pulse-dot)" opacity={0.9} />
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
                else if (isClicked) filter = "url(#glow-teal)";
                else if (isHovered) filter = "url(#glow-hover)";

                const grad = (isActive || isFiring)
                  ? "url(#node-active)"
                  : (isHovered || isClicked)
                    ? "url(#node-hover)"
                    : "url(#node-idle)";

                const strokeColor = isError
                  ? "#EF4444"
                  : (isActive || isFiring)
                    ? "#22D3EE"
                    : (isHovered || isClicked)
                      ? "#2DD4BF"
                      : "rgba(45,212,191,0.35)";

                const textColor = (isActive || isFiring)
                  ? "#22D3EE"
                  : isHovered
                    ? "#2DD4BF"
                    : "rgba(255,255,255,0.7)";

                let animStyle: string | undefined;
                if (isError) animStyle = "node-flicker 1.2s ease-out";
                else if (isFiring) animStyle = "module-fire 0.6s ease-out";
                else if (!isActive && !isHovered && !isClicked) animStyle = "node-breathe 3s ease-in-out infinite";

                const lines = node.label.split("\n");
                const displayR = isClicked ? node.r * 1.15 : isHovered ? node.r * 1.08 : node.r;

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
                      <circle cx={node.cx} cy={node.cy} r={displayR + 10} fill="none" stroke="#22D3EE" strokeWidth="0.5" strokeOpacity="0.4" strokeDasharray="3 3" />
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
                      r={displayR * 0.55}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth="0.3"
                      strokeOpacity="0.25"
                    />
                    <circle
                      cx={node.cx - displayR * 0.18}
                      cy={node.cy - displayR * 0.22}
                      r={displayR * 0.12}
                      fill="#2DD4BF"
                      opacity={(isActive || isFiring) ? 0.5 : 0.12}
                    />
                    {lines.map((line, li) => (
                      <text
                        key={`${node.id}-t-${li}`}
                        x={node.cx}
                        y={node.cy + (li - (lines.length - 1) / 2) * 10}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={textColor}
                        fontSize="8.5"
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

              <rect x="830" y="100" width="340" height="380" rx="14" fill="rgba(7,11,18,0.92)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <text x="855" y="128" fill="#2DD4BF" fontSize="11" fontWeight="600" fontFamily="Menlo, monospace" letterSpacing="1.5">
                Event Log
              </text>
              <line x1="845" y1="138" x2="1160" y2="138" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />

              <foreignObject x="840" y="142" width="320" height="330">
                <div
                  style={{
                    height: "330px",
                    overflow: "auto",
                    padding: "4px 8px",
                    fontSize: "10px",
                    fontFamily: "Menlo, monospace",
                    color: "rgba(255,255,255,0.55)",
                    lineHeight: "1.6",
                  }}
                  data-testid="panel-event-log"
                >
                  {displayEvents.length === 0 ? (
                    <div style={{ color: "rgba(255,255,255,0.15)", padding: "20px 0", textAlign: "center" }}>
                      [awaiting signal...]
                    </div>
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
                          style={{
                            padding: "3px 0",
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                            color: isErr ? "#EF4444" : undefined,
                            display: "flex",
                            gap: "6px",
                            alignItems: "flex-start",
                          }}
                        >
                          <span style={{ width: "16px", textAlign: "center", flexShrink: 0, color: isErr ? "#EF4444" : "#2DD4BF" }}>{icon}</span>
                          <span style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0, fontSize: "9px" }}>{time}</span>
                          <span style={{ color: isErr ? "#EF4444" : "rgba(45,212,191,0.7)", flexShrink: 0, fontSize: "9px", fontWeight: 600 }}>
                            {evt.type}
                          </span>
                          <span style={{ opacity: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "9px" }}>
                            {msg}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </foreignObject>

              <rect x="830" y="500" width="340" height="60" rx="10" fill="rgba(7,11,18,0.92)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <text x="855" y="515" fill="rgba(45,212,191,0.5)" fontSize="8" fontFamily="Menlo, monospace" letterSpacing="0.5">
                EEG
              </text>
              {Array.from({ length: 40 }, (_, i) => {
                const barW = 310 / 40 - 2;
                const x = 845 + i * (barW + 2);
                const maxH = 32;
                const baseH = 3;
                const rateH = Math.min(eventRate * 6, maxH);
                const phase = brainwaveTick * 0.15;
                const noise = Math.sin(phase + i * 0.5) * 2.5 + 2.5;
                const h = Math.max(baseH, runStatus === "running" ? rateH + noise : baseH + Math.sin(i * 0.3 + phase * 0.3) * 1.5);
                const barColor = runStatus === "error" ? "#EF4444" : "#2DD4BF";
                const opacity = runStatus === "running" ? 0.65 : 0.15;
                return (
                  <rect key={`eeg-${i}`} x={x} y={522 + (maxH - h)} width={barW} height={h} rx={1} fill={barColor} opacity={opacity} />
                );
              })}
            </svg>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
}
