import { useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArrowRight, Building2, Users, Phone, Target, MapPin } from "lucide-react";

const EMERALD = "#10B981";

interface MeResponse {
  email: string;
  machine_config: {
    machine_name: string;
    market: string;
    opportunity: string;
    decision_maker_focus: string;
    geo: string;
    industry_config_selected: string;
  } | null;
  needsOnboarding: boolean;
}

interface MachineMetrics {
  companies_total: number | null;
  dms_total: number | null;
  calls_total: number | null;
  wins_total: number | null;
  opportunities_total: number | null;
}

interface DashboardStats {
  today_list_count: number | null;
  fresh_pool_count: number | null;
  dm_resolved_count: number | null;
  playbooks_ready_count: number | null;
}

export default function BriefingPage() {
  const { getToken, isAuthenticated } = useAuth();
  const token = getToken();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isAuthenticated) navigate("/login");
  }, [isAuthenticated, navigate]);

  const { data: me } = useQuery<MeResponse>({
    queryKey: ["/api/me"],
    enabled: !!token,
  });

  const { data: metrics } = useQuery<MachineMetrics>({
    queryKey: ["/api/machine-metrics"],
    enabled: !!token,
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    enabled: !!token,
  });

  const config = me?.machine_config;
  const machineName = config?.machine_name || "Your Machine";

  const briefingItems = [
    {
      icon: Building2,
      label: "Companies in Pipeline",
      value: metrics?.companies_total ?? 0,
      color: EMERALD,
    },
    {
      icon: Users,
      label: "Decision Makers Mapped",
      value: metrics?.dms_total ?? 0,
      color: EMERALD,
    },
    {
      icon: Target,
      label: "Today's Call List",
      value: stats?.today_list_count ?? 0,
      color: "#0F172A",
    },
    {
      icon: Phone,
      label: "Playbooks Ready",
      value: stats?.playbooks_ready_count ?? 0,
      color: "#0F172A",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: "#FFFFFF" }}>
      <motion.div
        className="w-full max-w-lg"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="text-center mb-8">
          <motion.div
            className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ background: "rgba(16,185,129,0.08)" }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
          >
            <div className="w-6 h-6 rounded-full" style={{ background: EMERALD }} />
          </motion.div>

          <h1 className="text-2xl font-bold mb-1" style={{ color: "#0F172A" }} data-testid="text-machine-name">
            {machineName}
          </h1>
          <p className="text-sm font-mono" style={{ color: "#94A3B8" }} data-testid="text-briefing-subtitle">
            First Intelligence Briefing
          </p>
        </div>

        {config && (
          <motion.div
            className="rounded-xl p-4 mb-6"
            style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            data-testid="card-config-summary"
          >
            <p className="text-xs font-mono tracking-widest uppercase mb-3" style={{ color: "#94A3B8" }}>
              Configuration
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs" style={{ color: "#94A3B8" }}>Market</p>
                <p className="text-sm font-semibold" style={{ color: "#0F172A" }}>{config.market}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "#94A3B8" }}>Opportunity</p>
                <p className="text-sm font-semibold" style={{ color: "#0F172A" }}>{config.opportunity}</p>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="w-3 h-3" style={{ color: "#94A3B8" }} />
                <div>
                  <p className="text-xs" style={{ color: "#94A3B8" }}>Geography</p>
                  <p className="text-sm font-semibold" style={{ color: "#0F172A" }}>{config.geo}</p>
                </div>
              </div>
              <div>
                <p className="text-xs" style={{ color: "#94A3B8" }}>DM Focus</p>
                <p className="text-sm font-semibold" style={{ color: "#0F172A" }}>{config.decision_maker_focus}</p>
              </div>
            </div>
          </motion.div>
        )}

        <div className="space-y-3 mb-8" data-testid="briefing-metrics">
          {briefingItems.map((item, i) => (
            <motion.div
              key={item.label}
              className="flex items-center gap-4 rounded-xl p-4"
              style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.1 }}
              data-testid={`briefing-metric-${i}`}
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${item.color}10` }}>
                <item.icon className="w-5 h-5" style={{ color: item.color }} />
              </div>
              <div className="flex-1">
                <p className="text-xs" style={{ color: "#94A3B8" }}>{item.label}</p>
                <p className="text-xl font-bold font-mono" style={{ color: "#0F172A" }}>
                  {item.value.toLocaleString()}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <Button
            onClick={() => navigate("/dashboard")}
            className="w-full h-12 text-base font-bold tracking-wider rounded-xl"
            style={{ background: "#0F172A", color: "#FFFFFF" }}
            data-testid="button-go-to-dashboard"
          >
            Enter Command Center <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
