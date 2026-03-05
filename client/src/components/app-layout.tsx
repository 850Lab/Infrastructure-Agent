import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { LogOut, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface StatusPillProps {
  status: "standby" | "running" | "error";
}

function StatusPill({ status }: StatusPillProps) {
  const config = {
    standby: { label: "Standby", className: "bg-muted text-muted-foreground" },
    running: { label: "Running", className: "bg-primary/20 text-primary animate-pulse" },
    error: { label: "Error", className: "bg-destructive/20 text-destructive" },
  };
  const { label, className } = config[status];
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${className}`} data-testid="status-pill">
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
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            {showBackToChip && location !== "/dashboard" ? (
              <Link href="/dashboard">
                <Button variant="outline" size="sm" className="text-primary border-primary/30" data-testid="button-back-to-chip">
                  <Cpu className="w-4 h-4 mr-1" />
                  Back to Chip
                </Button>
              </Link>
            ) : (
              <Link href="/dashboard" className="text-primary font-bold text-lg tracking-tight flex items-center gap-2" data-testid="link-home">
                <Cpu className="w-5 h-5" />
                Motherboard
              </Link>
            )}
          </div>

          <StatusPill status={runStatus} />

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="text-muted-foreground hover:text-foreground"
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
