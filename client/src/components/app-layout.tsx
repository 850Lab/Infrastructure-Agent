import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Activity, Shield, Cog } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface StatusPillProps {
  status: "standby" | "running" | "error";
}

function StatusPill({ status }: StatusPillProps) {
  const config = {
    standby: { label: "Standby", color: "#10B981", bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.2)" },
    running: { label: "Running", color: "#059669", bg: "rgba(5,150,105,0.08)", border: "rgba(5,150,105,0.25)" },
    error: { label: "Error", color: "#EF4444", bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.2)" },
  };
  const { label, color, bg, border } = config[status];
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-semibold ${status === "running" ? "animate-pulse" : ""}`}
      style={{ background: bg, color, border: `1px solid ${border}` }}
      data-testid="status-pill"
    >
      {label}
    </span>
  );
}

const cameraIn = {
  initial: { opacity: 0, scale: 1.08, y: 20 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, scale: 0.95, y: -10, transition: { duration: 0.25, ease: "easeIn" } },
};

interface AppLayoutProps {
  children: ReactNode;
  runStatus?: "standby" | "running" | "error";
  showBackToChip?: boolean;
}

export default function AppLayout({ children, runStatus = "standby", showBackToChip = false }: AppLayoutProps) {
  const [location] = useLocation();
  const { logout, role, isAuthenticated } = useAuth();

  const { data: me } = useQuery<{ email: string; role: string; client: any; permissions: string[] }>({
    queryKey: ["/api/me"],
    enabled: isAuthenticated,
    staleTime: 30000,
  });

  const isPlatformAdmin = role === "platform_admin";
  const canEditSettings = me?.permissions?.includes("edit_settings") ?? false;
  const clientName = me?.client?.client_name;
  const machineName = me?.client?.machine_name;

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #E2E8F0" }}>
        <div className="max-w-[1400px] mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            {showBackToChip && location !== "/machine/dashboard" ? (
              <Link href="/machine/dashboard">
                <Button variant="outline" size="sm" className="font-semibold" style={{ color: "#0F172A", borderColor: "#E2E8F0" }} data-testid="button-back-to-chip">
                  <Activity className="w-4 h-4 mr-1.5" style={{ color: "#10B981" }} />
                  Back to Dashboard
                </Button>
              </Link>
            ) : (
              <Link href="/machine/dashboard" className="flex items-center gap-2.5" data-testid="link-home">
                <Activity className="w-5 h-5" style={{ color: "#10B981" }} />
                <div className="flex flex-col">
                  {clientName && (
                    <span className="text-[10px] font-medium uppercase tracking-wider leading-none mb-0.5" style={{ color: "#94A3B8" }} data-testid="text-client-name">{clientName}</span>
                  )}
                  <span className="font-bold text-base tracking-tight leading-none" style={{ color: "#0F172A" }} data-testid="text-machine-name">{machineName || "Texas Automation Systems"}</span>
                </div>
              </Link>
            )}
          </div>

          <StatusPill status={runStatus} />

          <div className="flex items-center gap-2">
            {isPlatformAdmin && (
              <Link href="/admin/dashboard">
                <Button variant="outline" size="sm" style={{ color: "#64748B", borderColor: "#E2E8F0" }} data-testid="button-switch-admin">
                  <Shield className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Admin</span>
                </Button>
              </Link>
            )}
            {canEditSettings && (
              <Link href="/machine/settings">
                <Button variant="ghost" size="sm" style={{ color: "#64748B" }} data-testid="button-settings">
                  <Cog className="w-4 h-4" />
                </Button>
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              style={{ color: "#64748B" }}
              className="hover:text-foreground"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Logout</span>
            </Button>
          </div>
        </div>
      </nav>

      <AnimatePresence mode="wait">
        <motion.main
          key={location}
          variants={cameraIn}
          initial="initial"
          animate="animate"
          exit="exit"
          className="max-w-[1400px] mx-auto"
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
