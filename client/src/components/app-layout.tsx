import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { LogOut, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface StatusPillProps {
  status: "standby" | "running" | "error";
}

function StatusPill({ status }: StatusPillProps) {
  const config = {
    standby: { label: "Standby", color: "#2DD4BF", bg: "rgba(45,212,191,0.1)", border: "rgba(45,212,191,0.2)" },
    running: { label: "Running", color: "#22D3EE", bg: "rgba(34,211,238,0.15)", border: "rgba(34,211,238,0.3)" },
    error: { label: "Error", color: "#EF4444", bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.3)" },
  };
  const { label, color, bg, border } = config[status];
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-medium font-mono ${status === "running" ? "animate-pulse" : ""}`}
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
  const { logout } = useAuth();

  return (
    <div className="min-h-screen" style={{ background: "#070B12" }}>
      <nav className="sticky top-0 z-50" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(7,11,18,0.88)", backdropFilter: "blur(16px)" }}>
        <div className="max-w-[1400px] mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            {showBackToChip && location !== "/dashboard" ? (
              <Link href="/dashboard">
                <Button variant="outline" size="sm" style={{ color: "#2DD4BF", borderColor: "rgba(45,212,191,0.25)", background: "rgba(45,212,191,0.05)" }} data-testid="button-back-to-chip">
                  <Activity className="w-4 h-4 mr-1.5" />
                  Back to Dashboard
                </Button>
              </Link>
            ) : (
              <Link href="/dashboard" className="flex items-center gap-2.5" data-testid="link-home">
                <Activity className="w-5 h-5" style={{ color: "#2DD4BF" }} />
                <div className="flex flex-col">
                  <span className="font-bold text-base tracking-tight leading-none" style={{ color: "#2DD4BF" }}>Neural OS</span>
                  <span className="text-xs font-mono leading-none mt-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>Command Center</span>
                </div>
              </Link>
            )}
          </div>

          <StatusPill status={runStatus} />

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              style={{ color: "rgba(255,255,255,0.35)" }}
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
