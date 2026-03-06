import { useState, useEffect, useRef, useMemo, useCallback } from "react";

const EMERALD = "#10B981";
const EMERALD_DIM = "rgba(16,185,129,0.25)";
const EMERALD_GLOW = "rgba(16,185,129,0.6)";
const ERROR_RED = "#EF4444";
const MUTED = "#94A3B8";

interface NeuralNode {
  id: string;
  label: string;
  step: string;
  route: string;
  x: number;
  y: number;
}

interface NeuralEdge {
  from: string;
  to: string;
}

const NODES: NeuralNode[] = [
  { id: "market",     label: "Market\nDiscovery",     step: "bootstrap",          route: "/lead-engine", x: 250, y: 42 },
  { id: "leadfeed",   label: "Lead\nExpansion",       step: "lead_feed",          route: "/lead-engine", x: 415, y: 105 },
  { id: "opportunity",label: "Market\nScanner",       step: "opportunity_engine", route: "/today",       x: 455, y: 240 },
  { id: "dm_map",     label: "Decision Maker\nMapping", step: "dm_coverage",      route: "/contacts",    x: 385, y: 365 },
  { id: "offer_fit",  label: "Buyer\nSelection",      step: "dm_fit",             route: "/contacts",    x: 250, y: 408 },
  { id: "playbook",   label: "Script\nGenerator",     step: "playbooks",          route: "/today",       x: 115, y: 365 },
  { id: "call_intel", label: "Signal\nProcessing",    step: "call_engine",        route: "/followups",   x: 45,  y: 240 },
  { id: "learning",   label: "Learning\nEngine",      step: "query_intel",        route: "/analytics",   x: 85,  y: 105 },
];

const EDGES: NeuralEdge[] = [
  { from: "market",     to: "leadfeed" },
  { from: "leadfeed",   to: "opportunity" },
  { from: "opportunity",to: "dm_map" },
  { from: "dm_map",     to: "offer_fit" },
  { from: "offer_fit",  to: "playbook" },
  { from: "playbook",   to: "call_intel" },
  { from: "call_intel", to: "learning" },
  { from: "learning",   to: "market" },
  { from: "opportunity",to: "playbook" },
  { from: "learning",   to: "leadfeed" },
];

const NODE_MAP = new Map(NODES.map(n => [n.id, n]));

function getNode(id: string) { return NODE_MAP.get(id)!; }

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  opacity: number;
  size: number;
}

interface EdgePulse {
  id: number;
  fromId: string;
  toId: string;
  progress: number;
}

interface NeuralNetworkProps {
  runStatus: "standby" | "running" | "error";
  activeNodes: Set<string>;
  doneSteps: Set<string>;
  shockwave: number;
  burst: number;
  machineMetrics: { wins_total: number | null; calls_total: number | null } | null;
  runHistory: Array<{ steps: Array<{ step: string; status: string }> }> | null;
  eventRate: number;
  confidenceScore: number;
  onNodeClick: (route: string) => void;
}

function computeEdgeWeights(history: Array<{ steps: Array<{ step: string }> }> | null): Map<string, number> {
  const freq = new Map<string, number>();
  if (!history) return freq;
  const recent = history.slice(0, 20);
  for (const run of recent) {
    for (const s of run.steps) {
      freq.set(s.step, (freq.get(s.step) || 0) + 1);
    }
  }
  const max = Math.max(1, ...freq.values());
  const normalized = new Map<string, number>();
  for (const [k, v] of freq) normalized.set(k, v / max);
  return normalized;
}

export default function NeuralNetwork({
  runStatus,
  activeNodes,
  doneSteps,
  shockwave,
  burst,
  machineMetrics,
  runHistory,
  eventRate,
  confidenceScore,
  onNodeClick,
}: NeuralNetworkProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [edgePulses, setEdgePulses] = useState<EdgePulse[]>([]);
  const [spikedNodes, setSpikedNodes] = useState<Set<string>>(new Set());
  const [successNodes, setSuccessNodes] = useState<Set<string>>(new Set());
  const [errorNodes, setErrorNodes] = useState<Set<string>>(new Set());
  const [brainwave, setBrainwave] = useState<number[]>(new Array(60).fill(0));
  const pulseIdRef = useRef(0);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  const calls = machineMetrics?.calls_total ?? 0;
  const confidence = confidenceScore;
  const edgeWeights = useMemo(() => computeEdgeWeights(runHistory ?? null), [runHistory]);

  useEffect(() => {
    const initial: Particle[] = [];
    for (let i = 0; i < 25; i++) {
      initial.push({
        id: i,
        x: Math.random() * 500,
        y: Math.random() * 450,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.3 + 0.05,
        size: Math.random() * 2 + 0.5,
      });
    }
    setParticles(initial);
  }, []);

  useEffect(() => {
    const animate = (time: number) => {
      if (time - lastTimeRef.current > 50) {
        lastTimeRef.current = time;
        setParticles(prev => prev.map(p => {
          let nx = p.x + p.vx;
          let ny = p.y + p.vy;
          if (nx < 0 || nx > 500) p.vx *= -1;
          if (ny < 0 || ny > 450) p.vy *= -1;
          nx = Math.max(0, Math.min(500, nx));
          ny = Math.max(0, Math.min(450, ny));
          return { ...p, x: nx, y: ny };
        }));
        setEdgePulses(prev => {
          const updated = prev.map(ep => ({ ...ep, progress: ep.progress + 0.025 }));
          return updated.filter(ep => ep.progress <= 1);
        });
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  useEffect(() => {
    setBrainwave(prev => {
      const next = [...prev.slice(1), eventRate];
      return next;
    });
  }, [eventRate]);

  const fireEdgePulse = useCallback((fromStep: string) => {
    const fromNode = NODES.find(n => n.step === fromStep);
    if (!fromNode) return;
    const outEdges = EDGES.filter(e => e.from === fromNode.id);
    for (const edge of outEdges) {
      pulseIdRef.current += 1;
      setEdgePulses(prev => [
        ...prev,
        { id: pulseIdRef.current, fromId: edge.from, toId: edge.to, progress: 0 },
      ]);
    }
  }, []);

  const prevShockwave = useRef(shockwave);
  useEffect(() => {
    if (shockwave !== prevShockwave.current) {
      prevShockwave.current = shockwave;
      for (const node of NODES) {
        if (activeNodes.has(node.step)) {
          setSpikedNodes(prev => new Set(prev).add(node.id));
          fireEdgePulse(node.step);
          setTimeout(() => {
            setSpikedNodes(prev => {
              const next = new Set(prev);
              next.delete(node.id);
              return next;
            });
          }, 600);
        }
      }
    }
  }, [shockwave, activeNodes, fireEdgePulse]);

  const prevBurst = useRef(burst);
  useEffect(() => {
    if (burst !== prevBurst.current) {
      prevBurst.current = burst;
      for (const node of NODES) {
        if (activeNodes.has(node.step)) {
          fireEdgePulse(node.step);
        }
      }
    }
  }, [burst, activeNodes, fireEdgePulse]);

  useEffect(() => {
    for (const node of NODES) {
      if (doneSteps.has(node.step) && !successNodes.has(node.id)) {
        setSuccessNodes(prev => new Set(prev).add(node.id));
        setTimeout(() => {
          setSuccessNodes(prev => {
            const next = new Set(prev);
            next.delete(node.id);
            return next;
          });
        }, 2000);
      }
    }
  }, [doneSteps, successNodes]);

  useEffect(() => {
    if (runStatus === "error") {
      for (const node of NODES) {
        if (activeNodes.has(node.step)) {
          setErrorNodes(prev => new Set(prev).add(node.id));
          setTimeout(() => {
            setErrorNodes(prev => {
              const next = new Set(prev);
              next.delete(node.id);
              return next;
            });
          }, 1500);
        }
      }
    }
  }, [runStatus, activeNodes]);

  const statusLabel = runStatus === "running"
    ? "Neural Engine: Active"
    : runStatus === "error"
      ? "Neural Engine: Fault"
      : "Neural Engine: Listening";

  const nodeGlowIntensity = confidence / 100;

  const maxBrainwave = Math.max(1, ...brainwave);

  return (
    <div className="relative w-full" data-testid="neural-network">
      <svg
        ref={svgRef}
        viewBox="0 0 500 450"
        className="w-full"
        style={{ filter: "drop-shadow(0 0 20px rgba(16,185,129,0.05))" }}
      >
        <defs>
          <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={EMERALD} stopOpacity={0.3 * nodeGlowIntensity} />
            <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="nodeGlowError" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ERROR_RED} stopOpacity={0.4} />
            <stop offset="100%" stopColor={ERROR_RED} stopOpacity={0} />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glowStrong">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {particles.map(p => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={p.size}
            fill={EMERALD}
            opacity={p.opacity * (runStatus === "running" ? 1.5 : 1)}
          />
        ))}

        {EDGES.map((edge, i) => {
          const from = getNode(edge.from);
          const to = getNode(edge.to);
          const stepWeight = edgeWeights.get(from.step) || 0;
          const baseWidth = 1 + stepWeight * 2;
          const isErrorEdge = errorNodes.has(edge.from) || errorNodes.has(edge.to);

          return (
            <g key={i}>
              <line
                x1={from.x} y1={from.y}
                x2={to.x} y2={to.y}
                stroke={isErrorEdge ? ERROR_RED : EMERALD_DIM}
                strokeWidth={baseWidth}
                opacity={isErrorEdge ? 0.6 : 0.4}
                strokeLinecap="round"
              />
              {runStatus === "standby" && (
                <line
                  x1={from.x} y1={from.y}
                  x2={to.x} y2={to.y}
                  stroke={EMERALD}
                  strokeWidth={baseWidth + 1}
                  opacity={0}
                  strokeLinecap="round"
                >
                  <animate
                    attributeName="opacity"
                    values="0;0.2;0"
                    dur={`${4 + i * 0.5}s`}
                    begin={`${i * 0.7}s`}
                    repeatCount="indefinite"
                  />
                </line>
              )}
            </g>
          );
        })}

        {edgePulses.map(ep => {
          const from = getNode(ep.fromId);
          const to = getNode(ep.toId);
          const px = from.x + (to.x - from.x) * ep.progress;
          const py = from.y + (to.y - from.y) * ep.progress;
          return (
            <circle
              key={ep.id}
              cx={px}
              cy={py}
              r={4}
              fill={EMERALD}
              opacity={1 - ep.progress}
              filter="url(#glow)"
            />
          );
        })}

        {NODES.map((node) => {
          const isActive = activeNodes.has(node.step);
          const isDone = doneSteps.has(node.step);
          const isSpiked = spikedNodes.has(node.id);
          const isSuccess = successNodes.has(node.id);
          const isError = errorNodes.has(node.id);
          const isLearning = node.id === "learning";
          const nodeRadius = isLearning ? 28 + Math.min(calls, 20) * 0.4 : 28;
          const glowRadius = nodeRadius + 15;

          let fillColor = "rgba(16,185,129,0.06)";
          let strokeColor = EMERALD_DIM;
          let strokeW = 1.5;

          if (isError) {
            fillColor = "rgba(239,68,68,0.12)";
            strokeColor = ERROR_RED;
            strokeW = 2.5;
          } else if (isSuccess) {
            fillColor = "rgba(16,185,129,0.15)";
            strokeColor = EMERALD_GLOW;
            strokeW = 2.5;
          } else if (isSpiked || isActive) {
            fillColor = "rgba(16,185,129,0.12)";
            strokeColor = EMERALD;
            strokeW = 2;
          } else if (isDone) {
            fillColor = "rgba(16,185,129,0.08)";
            strokeColor = "rgba(16,185,129,0.4)";
          }

          const lines = node.label.split("\n");

          return (
            <g
              key={node.id}
              style={{ cursor: "pointer" }}
              onClick={() => onNodeClick(node.route)}
              data-testid={`neural-node-${node.id}`}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={glowRadius}
                fill={isError ? "url(#nodeGlowError)" : "url(#nodeGlow)"}
                opacity={isSpiked || isSuccess ? 1 : 0.5}
              />

              <circle
                cx={node.x}
                cy={node.y}
                r={nodeRadius}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={strokeW}
                filter={isSpiked || isSuccess ? "url(#glowStrong)" : isActive ? "url(#glow)" : undefined}
              >
                {!isSpiked && !isActive && runStatus !== "error" && (
                  <animate
                    attributeName="r"
                    values={`${nodeRadius};${nodeRadius + 1.5};${nodeRadius}`}
                    dur={`${4 + Math.random() * 2}s`}
                    repeatCount="indefinite"
                  />
                )}
                {isSpiked && (
                  <animate
                    attributeName="r"
                    values={`${nodeRadius};${nodeRadius + 4};${nodeRadius}`}
                    dur="0.4s"
                    repeatCount="1"
                  />
                )}
              </circle>

              {lines.map((line, li) => (
                <text
                  key={li}
                  x={node.x}
                  y={node.y + (li - (lines.length - 1) / 2) * 11}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={isError ? ERROR_RED : isActive || isSpiked ? EMERALD : MUTED}
                  fontSize="8.5"
                  fontFamily="ui-monospace, monospace"
                  fontWeight={isActive || isSpiked ? "700" : "500"}
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>

      <div className="text-center mt-1">
        <span
          className="text-xs font-mono tracking-widest uppercase"
          style={{
            color: runStatus === "error" ? ERROR_RED : runStatus === "running" ? EMERALD : MUTED,
          }}
          data-testid="neural-status-label"
        >
          {statusLabel}
        </span>
      </div>

      <div
        className="mt-3 rounded-xl overflow-hidden"
        style={{ background: "rgba(248,250,252,0.6)", border: "1px solid #E2E8F0", height: 40, padding: "4px 8px" }}
        data-testid="brainwave-strip"
      >
        <svg viewBox={`0 0 ${brainwave.length} 32`} className="w-full h-full" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke={runStatus === "error" ? ERROR_RED : EMERALD}
            strokeWidth="1.5"
            opacity={0.7}
            points={brainwave.map((v, i) => `${i},${32 - (v / maxBrainwave) * 28}`).join(" ")}
          />
          <polyline
            fill={`${runStatus === "error" ? ERROR_RED : EMERALD}15`}
            stroke="none"
            points={`0,32 ${brainwave.map((v, i) => `${i},${32 - (v / maxBrainwave) * 28}`).join(" ")} ${brainwave.length - 1},32`}
          />
        </svg>
      </div>
      <p className="text-center mt-1">
        <span className="text-xs font-mono" style={{ color: "#CBD5E1" }}>
          {eventRate > 0 ? `${eventRate.toFixed(1)} events/sec` : "— brainwave —"}
        </span>
      </p>
    </div>
  );
}
