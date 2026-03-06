import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const EMERALD = "#10B981";
const EMERALD_DARK = "#059669";
const TEXT = "#0F172A";
const MUTED = "#94A3B8";

interface MeData {
  email: string;
  machine_config: {
    machine_name: string;
    opportunity: string;
    decision_maker_focus: string;
    geo: string;
  } | null;
}

const CINEMATIC_NODES = [
  { id: "discovery", label: "Discovery", sub: "Scanning market signals", delay: 0 },
  { id: "dm_mapping", label: "DM Mapping", sub: "Identifying decision makers", delay: 2200 },
  { id: "learning", label: "Learning", sub: "Calibrating intelligence", delay: 4400 },
];

const TOTAL_DURATION = 7800;

function CinematicNode({ node, active, done }: {
  node: typeof CINEMATIC_NODES[number];
  active: boolean;
  done: boolean;
}) {
  const baseR = 28;
  const r = active ? 34 : done ? 30 : baseR;

  return (
    <motion.div
      className="flex flex-col items-center gap-3"
      initial={{ opacity: 0.25 }}
      animate={{
        opacity: active || done ? 1 : 0.25,
      }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className="relative">
        <svg width={r * 2 + 24} height={r * 2 + 24} viewBox={`0 0 ${r * 2 + 24} ${r * 2 + 24}`}>
          <defs>
            <radialGradient id={`glow-${node.id}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={EMERALD} stopOpacity={active ? 0.5 : done ? 0.3 : 0} />
              <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
            </radialGradient>
            <filter id={`blur-${node.id}`}>
              <feGaussianBlur stdDeviation={active ? 6 : 3} />
            </filter>
          </defs>

          {(active || done) && (
            <motion.circle
              cx={r + 12} cy={r + 12} r={r + 8}
              fill={`url(#glow-${node.id})`}
              filter={`url(#blur-${node.id})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            />
          )}

          <motion.circle
            cx={r + 12} cy={r + 12}
            r={r}
            fill="none"
            stroke={active || done ? EMERALD : "rgba(255,255,255,0.1)"}
            strokeWidth={active ? 2.5 : 1.5}
            initial={false}
            animate={{
              r,
              stroke: active || done ? EMERALD : "rgba(255,255,255,0.1)",
              strokeWidth: active ? 2.5 : 1.5,
            }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />

          {done && (
            <motion.circle
              cx={r + 12} cy={r + 12}
              r={4}
              fill={EMERALD}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            />
          )}

          {active && (
            <motion.circle
              cx={r + 12} cy={r + 12}
              r={r}
              fill="none"
              stroke={EMERALD}
              strokeWidth={1}
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 1.5, opacity: 0 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
            />
          )}
        </svg>
      </div>

      <motion.div
        className="text-center"
        initial={{ y: 6, opacity: 0 }}
        animate={{
          y: active || done ? 0 : 6,
          opacity: active || done ? 1 : 0.3,
        }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        <p className="text-sm font-bold font-mono tracking-wider" style={{ color: active || done ? "#FFF" : MUTED }}>
          {node.label}
        </p>
        {active && (
          <motion.p
            className="text-xs font-mono mt-1"
            style={{ color: EMERALD }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            {node.sub}
          </motion.p>
        )}
      </motion.div>
    </motion.div>
  );
}

function ConnectorLine({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div className="flex items-center pt-3" style={{ width: 80 }}>
      <svg width="80" height="4" viewBox="0 0 80 4">
        <line x1="0" y1="2" x2="80" y2="2" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
        {(active || done) && (
          <motion.line
            x1="0" y1="2" x2="80" y2="2"
            stroke={EMERALD}
            strokeWidth="2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
          />
        )}
      </svg>
    </div>
  );
}

export default function CinematicPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const [, navigate] = useLocation();

  const [phase, setPhase] = useState<"nodes" | "transition" | "done">("nodes");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [doneIdxs, setDoneIdxs] = useState<Set<number>>(new Set());
  const timerRef = useRef<number[]>([]);

  const { data: meData } = useQuery<MeData>({
    queryKey: ["/api/me"],
    enabled: !!token,
    staleTime: 60000,
  });

  const mc = meData?.machine_config;
  const machineName = mc?.machine_name || "Your Machine";

  const goToBriefing = useCallback(() => {
    timerRef.current.forEach(clearTimeout);
    timerRef.current = [];
    try { localStorage.setItem("cinematic_seen", "true"); } catch {}
    navigate("/machine/briefing");
  }, [navigate]);

  useEffect(() => {
    CINEMATIC_NODES.forEach((node, idx) => {
      const activateTimer = window.setTimeout(() => {
        setActiveIdx(idx);
      }, node.delay);
      timerRef.current.push(activateTimer);

      const doneTimer = window.setTimeout(() => {
        setActiveIdx((prev) => (prev === idx ? -1 : prev));
        setDoneIdxs((prev) => new Set(prev).add(idx));
      }, node.delay + 1800);
      timerRef.current.push(doneTimer);
    });

    const transitionTimer = window.setTimeout(() => {
      setPhase("transition");
    }, TOTAL_DURATION - 1200);
    timerRef.current.push(transitionTimer);

    const doneTimer = window.setTimeout(() => {
      setPhase("done");
    }, TOTAL_DURATION);
    timerRef.current.push(doneTimer);

    const redirectTimer = window.setTimeout(() => {
      goToBriefing();
    }, TOTAL_DURATION + 2000);
    timerRef.current.push(redirectTimer);

    return () => {
      timerRef.current.forEach(clearTimeout);
    };
  }, [goToBriefing]);

  const skip = () => {
    timerRef.current.forEach(clearTimeout);
    goToBriefing();
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: TEXT }}
      data-testid="cinematic-page"
    >
      <AnimatePresence mode="wait">
        {phase === "nodes" && (
          <motion.div
            key="nodes"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center gap-12"
          >
            <motion.p
              className="text-xs font-mono uppercase tracking-[0.3em]"
              style={{ color: MUTED }}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              data-testid="text-initializing"
            >
              Initializing {machineName}
            </motion.p>

            <div className="flex items-start gap-0">
              {CINEMATIC_NODES.map((node, idx) => (
                <div key={node.id} className="flex items-start">
                  <CinematicNode
                    node={node}
                    active={activeIdx === idx}
                    done={doneIdxs.has(idx)}
                  />
                  {idx < CINEMATIC_NODES.length - 1 && (
                    <ConnectorLine
                      active={activeIdx > idx || doneIdxs.has(idx)}
                      done={doneIdxs.has(idx) && (doneIdxs.has(idx + 1) || activeIdx === idx + 1)}
                    />
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {(phase === "transition" || phase === "done") && (
          <motion.div
            key="transition"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="flex flex-col items-center gap-6 text-center px-6"
          >
            <motion.div
              className="w-3 h-3 rounded-full"
              style={{ background: EMERALD }}
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.8, 1] }}
              transition={{ duration: 0.6, times: [0, 0.6, 1] }}
            />

            <motion.h1
              className="text-2xl md:text-3xl font-bold font-mono tracking-tight"
              style={{ color: "#FFF" }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              data-testid="text-machine-ready"
            >
              {machineName} is online
            </motion.h1>

            <motion.p
              className="text-sm font-mono"
              style={{ color: MUTED }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              data-testid="text-config-summary"
            >
              {mc ? `${mc.opportunity} · ${mc.geo} · ${mc.decision_maker_focus}` : "Ready to operate"}
            </motion.p>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.0 }}
            >
              <Button
                onClick={goToBriefing}
                className="gap-2 text-sm font-bold font-mono px-6"
                style={{ background: EMERALD, color: "#FFF" }}
                data-testid="button-enter-briefing"
              >
                Enter Briefing
                <ArrowRight className="w-4 h-4" />
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="absolute bottom-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.0 }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={skip}
          className="text-xs font-mono"
          style={{ color: "rgba(255,255,255,0.2)" }}
          data-testid="button-skip-cinematic"
        >
          Skip
        </Button>
      </motion.div>
    </div>
  );
}
