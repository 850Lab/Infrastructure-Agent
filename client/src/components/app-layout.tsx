import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { LogOut, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface StatusPillProps {
  status: "standby" | "running" | "error";
}

function StatusPill({ status }: StatusPillProps) {
  const config = {
    standby: { label: "Standby", bg: "rgba(45,212,191,0.1)", color: "#2DD4BF", border: "rgba(45,212,191,0.2)" },
    running: { label: "Running", bg: "rgba(34,211,238,0.15)", color: "#22D3EE", border: "rgba(34,211,238,0.3)" },
    error: { label: "Error", bg: "rgba(239,68,68,0.15)", color: "#EF4444", border: "rgba(239,68,68,0.3)" },
  };
  const { label, bg, color, border } = config[status];
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-medium ${status === "running" ? "animate-pulse" : ""}`}
      style={{ background: bg, color, border: `1px solid ${border}` }}
      data-testid="status-pill"
    >
      {label}
    </span>
  );
}

const cameraIn = {
  initial: { opacity: 0, scale: 1.15, z: 200 },
  animate: { opacity: 1, scale: 1, z: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, scale: 0.92, z: -100, transition: { duration: 0.3, ease: "easeIn" } },
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
      <nav className="sticky top-0 z-50" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(7,11,18,0.85)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-[1400px] mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            {showBackToChip && location !== "/dashboard" ? (
              <Link href="/dashboard">
                <Button variant="outline" size="sm" style={{ color: "#2DD4BF", borderColor: "rgba(45,212,191,0.3)" }} data-testid="button-back-to-chip">
                  <Brain className="w-4 h-4 mr-1" />
                  Back to Brain
                </Button>
              </Link>
            ) : (
              <Link href="/dashboard" className="font-bold text-lg tracking-tight flex items-center gap-2" style={{ color: "#2DD4BF" }} data-testid="link-home">
                <Brain className="w-5 h-5" />
                <span>Neural OS</span>
                <span className="text-xs font-normal" style={{ color: "rgba(255,255,255,0.3)" }}>Motherboard</span>
              </Link>
            )}
          </div>

          <StatusPill status={runStatus} />

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              style={{ color: "rgba(255,255,255,0.4)" }}
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
          style={{ transformStyle: "preserve-3d" }}
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
