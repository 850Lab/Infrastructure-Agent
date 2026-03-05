import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

const navItems = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Today", path: "/today" },
  { label: "Follow-ups", path: "/followups" },
  { label: "Lead Engine", path: "/lead-engine" },
  { label: "Contacts", path: "/contacts" },
  { label: "Analytics", path: "/analytics" },
];

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

const pageVariants = {
  initial: { opacity: 0, x: 30, scale: 0.98 },
  animate: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { opacity: 0, x: -30, scale: 0.98, transition: { duration: 0.2, ease: "easeIn" } },
};

interface AppLayoutProps {
  children: ReactNode;
  runStatus?: "standby" | "running" | "error";
}

export default function AppLayout({ children, runStatus = "standby" }: AppLayoutProps) {
  const [location] = useLocation();
  const { logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-primary font-bold text-lg tracking-tight" data-testid="link-home">
              Motherboard
            </Link>
            <StatusPill status={runStatus} />
          </div>

          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link key={item.path} href={item.path}>
                <span
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                    location === item.path
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {item.label}
                </span>
              </Link>
            ))}
          </div>

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
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              data-testid="button-menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-border/50 bg-background px-4 py-2 space-y-1">
            {navItems.map((item) => (
              <Link key={item.path} href={item.path}>
                <span
                  className={`block px-3 py-2 rounded-md text-sm cursor-pointer ${
                    location === item.path
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </span>
              </Link>
            ))}
          </div>
        )}
      </nav>

      <AnimatePresence mode="wait">
        <motion.main
          key={location}
          variants={pageVariants}
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
