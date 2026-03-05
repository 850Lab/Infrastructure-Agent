import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useSSE } from "@/lib/use-sse";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, ChevronLeft, Zap } from "lucide-react";

const EMERALD = "#10B981";
const EMERALD_DARK = "#059669";

const MARKETS = [
  { value: "industrial", label: "Industrial / Manufacturing", desc: "Contractors, plants, heavy industry" },
  { value: "saas", label: "B2B SaaS", desc: "Software companies, tech startups" },
  { value: "real-estate", label: "Real Estate", desc: "Commercial property, development" },
  { value: "agency", label: "Agency", desc: "Marketing, staffing, consulting" },
];

const OPPORTUNITIES = [
  { value: "cooling-trailers", label: "Cooling Trailers", desc: "Mobile cooling solutions" },
  { value: "heat-mitigation", label: "Heat Mitigation", desc: "Worker heat stress prevention" },
  { value: "worker-safety", label: "Worker Safety", desc: "PPE, compliance, training" },
  { value: "site-logistics", label: "Site Logistics", desc: "Equipment, transport, staging" },
];

const GEOS = [
  { value: "Houston", label: "Houston Metro" },
  { value: "Gulf Coast", label: "Gulf Coast" },
  { value: "Texas", label: "All Texas" },
  { value: "Nationwide", label: "Nationwide" },
];

const DM_ROLES = [
  { value: "Safety", label: "Safety Manager / Director" },
  { value: "Project", label: "Project Manager" },
  { value: "Operations", label: "Operations / Plant Manager" },
  { value: "Executive", label: "Executive / C-Suite" },
];

const TOTAL_STEPS = 7;

interface WizardAnswers {
  market: string;
  customMarket: string;
  opportunity: string;
  customOpportunity: string;
  geo: string;
  customGeo: string;
  dmFocus: string;
  machineName: string;
}

function NodeLight({ on, delay }: { on: boolean; delay: number }) {
  return (
    <motion.div
      className="w-3 h-3 rounded-full"
      initial={{ opacity: 0.15, scale: 0.8 }}
      animate={on ? { opacity: 1, scale: 1, background: EMERALD } : { opacity: 0.15, scale: 0.8, background: "#CBD5E1" }}
      transition={{ duration: 0.5, delay }}
    />
  );
}

function OptionCard({
  label, desc, selected, onClick, testId,
}: { label: string; desc?: string; selected: boolean; onClick: () => void; testId: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-4 transition-all duration-200"
      style={{
        background: selected ? "rgba(16,185,129,0.06)" : "#F8FAFC",
        border: `2px solid ${selected ? EMERALD : "#E2E8F0"}`,
        boxShadow: selected ? "0 0 16px rgba(16,185,129,0.12)" : "none",
      }}
      data-testid={testId}
    >
      <p className="text-sm font-semibold" style={{ color: selected ? EMERALD_DARK : "#0F172A" }}>{label}</p>
      {desc && <p className="text-xs mt-0.5" style={{ color: "#94A3B8" }}>{desc}</p>}
    </button>
  );
}

function MiniReactor({ status }: { status: "standby" | "running" | "error" }) {
  const ringColor = status === "running" ? EMERALD_DARK : EMERALD;
  return (
    <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
      <motion.div
        className="absolute rounded-full"
        style={{ width: "80%", height: "80%", border: `2px solid ${ringColor}`, background: `rgba(16,185,129,0.04)` }}
        animate={status === "running" ? { scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] } : {}}
        transition={status === "running" ? { duration: 2, repeat: Infinity } : {}}
      />
      <motion.div
        className="rounded-full"
        style={{ width: 32, height: 32, background: ringColor }}
        animate={status === "running" ? { scale: [1, 1.15, 1] } : {}}
        transition={status === "running" ? { duration: 1.5, repeat: Infinity } : {}}
      />
    </div>
  );
}

export default function OnboardingPage() {
  const { getToken } = useAuth();
  const token = getToken();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [initLights, setInitLights] = useState(0);
  const [answers, setAnswers] = useState<WizardAnswers>({
    market: "", customMarket: "",
    opportunity: "", customOpportunity: "",
    geo: "", customGeo: "",
    dmFocus: "",
    machineName: "",
  });
  const [suggestedName, setSuggestedName] = useState("");
  const [buildRunId, setBuildRunId] = useState<string | null>(null);
  const [buildComplete, setBuildComplete] = useState(false);
  const [saveError, setSaveError] = useState("");

  const { runStatus, recentEvents } = useSSE(buildRunId ? token : null);

  useEffect(() => {
    if (step === 0) {
      const interval = setInterval(() => {
        setInitLights((prev) => {
          if (prev >= 8) {
            clearInterval(interval);
            setTimeout(() => setStep(1), 600);
            return 8;
          }
          return prev + 1;
        });
      }, 250);
      return () => clearInterval(interval);
    }
  }, [step]);

  useEffect(() => {
    if (buildRunId && recentEvents.length > 0) {
      const last = recentEvents[recentEvents.length - 1];
      if (last.type === "RUN_DONE") {
        setBuildComplete(true);
        setTimeout(() => navigate("/briefing"), 2000);
      }
    }
  }, [buildRunId, recentEvents, navigate]);

  const fetchSuggestedName = useCallback(async () => {
    try {
      const market = answers.market === "custom" ? answers.customMarket : answers.market;
      const opportunity = answers.opportunity === "custom" ? answers.customOpportunity : answers.opportunity;
      const geo = answers.geo === "custom" ? answers.customGeo : answers.geo;
      const res = await apiRequest("POST", "/api/onboarding/suggest-name", { market, opportunity, geo });
      const data = await res.json();
      setSuggestedName(data.suggested_name || "");
      if (!answers.machineName) {
        setAnswers((prev) => ({ ...prev, machineName: data.suggested_name || "" }));
      }
    } catch {}
  }, [answers.market, answers.customMarket, answers.opportunity, answers.customOpportunity, answers.geo, answers.customGeo, answers.machineName]);

  const handleNext = () => {
    if (step === 4) {
      fetchSuggestedName();
    }
    setStep((s) => s + 1);
  };

  const handleBack = () => setStep((s) => Math.max(1, s - 1));

  const handleSave = async () => {
    setSaveError("");
    try {
      const market = answers.market === "custom" ? answers.customMarket : answers.market;
      const opportunity = answers.opportunity === "custom" ? answers.customOpportunity : answers.opportunity;
      const geo = answers.geo === "custom" ? answers.customGeo : answers.geo;

      await apiRequest("POST", "/api/onboarding", {
        machine_name: answers.machineName,
        market,
        opportunity,
        decision_maker_focus: answers.dmFocus,
        geo,
      });

      setStep(6);

      try {
        const buildRes = await apiRequest("POST", "/api/onboarding/build");
        const data = await buildRes.json();
        setBuildRunId(data.run_id);
      } catch {
        setBuildComplete(true);
        setTimeout(() => navigate("/briefing"), 2000);
      }
    } catch (err: any) {
      setSaveError(err.message || "Failed to save configuration. Please try again.");
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1: return answers.market && (answers.market !== "custom" || answers.customMarket.trim());
      case 2: return answers.opportunity && (answers.opportunity !== "custom" || answers.customOpportunity.trim());
      case 3: return answers.geo && (answers.geo !== "custom" || answers.customGeo.trim());
      case 4: return !!answers.dmFocus;
      case 5: return answers.machineName.trim().length > 0;
      default: return true;
    }
  };

  const progress = Math.min(((step) / TOTAL_STEPS) * 100, 100);

  const buildEvents = buildRunId
    ? recentEvents.filter((e) => e.type === "STEP_STARTED" || e.type === "STEP_DONE" || e.type === "RUN_DONE").slice(-8)
    : [];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: "#FFFFFF" }}>
      <div className="w-full max-w-lg">
        {step > 0 && step < 6 && (
          <div className="mb-6">
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "#E2E8F0" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: EMERALD }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
            <p className="text-xs font-mono mt-2 text-right" style={{ color: "#94A3B8" }}>Step {step} of 5</p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="init"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center"
            >
              <p className="text-2xl font-bold mb-6" style={{ color: "#0F172A" }}>
                Initializing your intelligence engine...
              </p>
              <div className="flex items-center justify-center gap-2 mb-8">
                {Array.from({ length: 8 }).map((_, i) => (
                  <NodeLight key={i} on={i < initLights} delay={i * 0.1} />
                ))}
              </div>
              <p className="text-sm font-mono" style={{ color: "#94A3B8" }}>Warming up systems</p>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="market"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-xl font-bold mb-2" style={{ color: "#0F172A" }}>What's your target market?</p>
              <p className="text-sm mb-6" style={{ color: "#64748B" }}>This determines how we score and prioritize leads.</p>
              <div className="space-y-3">
                {MARKETS.map((m) => (
                  <OptionCard
                    key={m.value}
                    label={m.label}
                    desc={m.desc}
                    selected={answers.market === m.value}
                    onClick={() => setAnswers({ ...answers, market: m.value })}
                    testId={`option-market-${m.value}`}
                  />
                ))}
                <OptionCard
                  label="Custom"
                  desc="Enter your own market"
                  selected={answers.market === "custom"}
                  onClick={() => setAnswers({ ...answers, market: "custom" })}
                  testId="option-market-custom"
                />
                {answers.market === "custom" && (
                  <Input
                    placeholder="e.g. Healthcare, Energy..."
                    value={answers.customMarket}
                    onChange={(e) => setAnswers({ ...answers, customMarket: e.target.value })}
                    className="mt-2"
                    data-testid="input-custom-market"
                  />
                )}
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="opportunity"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-xl font-bold mb-2" style={{ color: "#0F172A" }}>What opportunity are you selling?</p>
              <p className="text-sm mb-6" style={{ color: "#64748B" }}>We'll tailor playbooks and call scripts to this offer.</p>
              <div className="space-y-3">
                {OPPORTUNITIES.map((o) => (
                  <OptionCard
                    key={o.value}
                    label={o.label}
                    desc={o.desc}
                    selected={answers.opportunity === o.value}
                    onClick={() => setAnswers({ ...answers, opportunity: o.value })}
                    testId={`option-opp-${o.value}`}
                  />
                ))}
                <OptionCard
                  label="Custom"
                  desc="Enter your own"
                  selected={answers.opportunity === "custom"}
                  onClick={() => setAnswers({ ...answers, opportunity: "custom" })}
                  testId="option-opp-custom"
                />
                {answers.opportunity === "custom" && (
                  <Input
                    placeholder="e.g. Insulation Services..."
                    value={answers.customOpportunity}
                    onChange={(e) => setAnswers({ ...answers, customOpportunity: e.target.value })}
                    className="mt-2"
                    data-testid="input-custom-opportunity"
                  />
                )}
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="geo"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-xl font-bold mb-2" style={{ color: "#0F172A" }}>Where do you operate?</p>
              <p className="text-sm mb-6" style={{ color: "#64748B" }}>Geographic focus for lead sourcing.</p>
              <div className="space-y-3">
                {GEOS.map((g) => (
                  <OptionCard
                    key={g.value}
                    label={g.label}
                    selected={answers.geo === g.value}
                    onClick={() => setAnswers({ ...answers, geo: g.value })}
                    testId={`option-geo-${g.value}`}
                  />
                ))}
                <OptionCard
                  label="Custom"
                  desc="Enter your own region"
                  selected={answers.geo === "custom"}
                  onClick={() => setAnswers({ ...answers, geo: "custom" })}
                  testId="option-geo-custom"
                />
                {answers.geo === "custom" && (
                  <Input
                    placeholder="e.g. Southeast US..."
                    value={answers.customGeo}
                    onChange={(e) => setAnswers({ ...answers, customGeo: e.target.value })}
                    className="mt-2"
                    data-testid="input-custom-geo"
                  />
                )}
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="dm"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-xl font-bold mb-2" style={{ color: "#0F172A" }}>Who do you need to reach?</p>
              <p className="text-sm mb-6" style={{ color: "#64748B" }}>The typical decision maker for your product.</p>
              <div className="space-y-3">
                {DM_ROLES.map((r) => (
                  <OptionCard
                    key={r.value}
                    label={r.label}
                    selected={answers.dmFocus === r.value}
                    onClick={() => setAnswers({ ...answers, dmFocus: r.value })}
                    testId={`option-dm-${r.value}`}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div
              key="name"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-xl font-bold mb-2" style={{ color: "#0F172A" }}>Name your machine</p>
              <p className="text-sm mb-6" style={{ color: "#64748B" }}>
                This is your engine's identity. We suggest <span className="font-mono font-semibold" style={{ color: EMERALD }}>{suggestedName || "..."}</span> but you can change it.
              </p>
              <Input
                value={answers.machineName}
                onChange={(e) => setAnswers({ ...answers, machineName: e.target.value })}
                placeholder="Machine name"
                className="text-lg font-mono font-bold text-center mb-4"
                style={{ letterSpacing: "0.05em" }}
                data-testid="input-machine-name"
              />
              {suggestedName && answers.machineName !== suggestedName && (
                <button
                  onClick={() => setAnswers({ ...answers, machineName: suggestedName })}
                  className="text-xs font-mono underline"
                  style={{ color: "#94A3B8" }}
                  data-testid="button-use-suggested"
                >
                  Use suggested: {suggestedName}
                </button>
              )}
            </motion.div>
          )}

          {step === 6 && (
            <motion.div
              key="build"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <p className="text-2xl font-bold mb-2" style={{ color: "#0F172A" }}>
                {buildComplete ? "Your machine is ready." : "Building your machine..."}
              </p>
              <p className="text-sm font-mono mb-6" style={{ color: "#94A3B8" }}>
                {answers.machineName}
              </p>

              <div className="flex justify-center mb-6">
                <MiniReactor status={buildComplete ? "standby" : (buildRunId ? "running" : "standby")} />
              </div>

              <div className="text-left rounded-xl p-4 mb-4" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }} data-testid="build-event-log">
                {buildEvents.length === 0 ? (
                  <p className="text-xs font-mono text-center" style={{ color: "#CBD5E1" }}>Waiting for engine start...</p>
                ) : (
                  buildEvents.map((evt, i) => (
                    <div key={i} className="flex items-start gap-2 py-1" style={{ borderBottom: i < buildEvents.length - 1 ? "1px solid #F1F5F9" : "none" }}>
                      <span className="text-xs mt-0.5" style={{ color: evt.payload.severity === "success" ? EMERALD : "#94A3B8" }}>
                        {evt.payload.severity === "success" ? "\u2713" : "\u25B6"}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold" style={{ color: "#0F172A" }}>{evt.payload.human_title}</p>
                        <p className="text-xs font-mono truncate" style={{ color: "#64748B" }}>{evt.payload.human_message}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {buildComplete && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <p className="text-sm font-mono mb-4" style={{ color: EMERALD }}>Redirecting to your first briefing...</p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {step >= 1 && step <= 5 && (
          <div className="flex items-center justify-between mt-8">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={step <= 1}
              className="text-sm"
              style={{ color: "#64748B" }}
              data-testid="button-back"
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>

            {step < 5 ? (
              <Button
                onClick={handleNext}
                disabled={!canProceed()}
                className="text-sm font-bold px-6"
                style={{
                  background: canProceed() ? "#0F172A" : "#E2E8F0",
                  color: canProceed() ? "#FFFFFF" : "#94A3B8",
                }}
                data-testid="button-next"
              >
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <div className="text-right">
                {saveError && (
                  <p className="text-xs mb-2" style={{ color: "#EF4444" }} data-testid="text-save-error">{saveError}</p>
                )}
                <Button
                  onClick={handleSave}
                  disabled={!canProceed()}
                  className="text-sm font-bold px-6"
                  style={{
                    background: canProceed() ? EMERALD : "#E2E8F0",
                    color: canProceed() ? "#FFFFFF" : "#94A3B8",
                  }}
                  data-testid="button-build"
                >
                  <Zap className="w-4 h-4 mr-1" /> Build Machine
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
