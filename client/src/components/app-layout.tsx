import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import {
  LogOut, Shield, Cog, Phone, Mail, Linkedin,
  Building2, BarChart3, Target, Calendar, ChevronRight, Flame
} from "lucide-react";
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
      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${status === "running" ? "animate-pulse" : ""}`}
      style={{ background: bg, color, border: `1px solid ${border}` }}
      data-testid="status-pill"
    >
      {label}
    </span>
  );
}

const cameraIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15, ease: "easeIn" } },
};

const NAV_ITEMS = [
  { href: "/machine/today", label: "Today", icon: Target, testId: "nav-today" },
  { href: "/machine/companies", label: "Companies", icon: Building2, testId: "nav-companies" },
  { href: "/machine/warm-leads", label: "Warm Leads", icon: Flame, testId: "nav-warm-leads" },
  { href: "/machine/call-queue", label: "Call Queue", icon: Phone, testId: "nav-call-queue" },
  { href: "/machine/email-queue", label: "Email Queue", icon: Mail, testId: "nav-email-queue" },
  { href: "/machine/linkedin-queue", label: "LinkedIn", icon: Linkedin, testId: "nav-linkedin" },
  { href: "/machine/pipeline", label: "Pipeline", icon: BarChart3, testId: "nav-pipeline" },
  { href: "/machine/analytics", label: "Analytics", icon: BarChart3, testId: "nav-analytics" },
];

interface AppLayoutProps {
  children: ReactNode;
  runStatus?: "standby" | "running" | "error";
  showBackToChip?: boolean;
}

export default function AppLayout({ children, runStatus = "standby" }: AppLayoutProps) {
  const [location] = useLocation();
  const { logout, role, isAuthenticated } = useAuth();

  const { data: me } = useQuery<{ email: string; role: string; client: any; permissions: string[] }>({
    queryKey: ["/api/me"],
    enabled: isAuthenticated,
    staleTime: 30000,
  });

  const isPlatformAdmin = role === "platform_admin";
  const clientName = me?.client?.client_name;

  return (
    <div className="min-h-screen" style={{ background: "#F8FAFC" }}>
      <nav className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #E2E8F0" }}>
        <div className="max-w-[1440px] mx-auto px-4">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-4">
              <Link href="/machine/today" className="flex items-center gap-2" data-testid="link-home">
                <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "#10B981" }}>
                  <Target className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-sm tracking-tight" style={{ color: "#0F172A" }} data-testid="text-client-name">
                  {clientName || "Sales Machine"}
                </span>
              </Link>
              <StatusPill status={runStatus} />
            </div>

            <div className="hidden md:flex items-center gap-0.5">
              {NAV_ITEMS.map((item) => {
                const isActive = location === item.href || (item.href !== "/machine/today" && location.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <button
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                      style={{
                        color: isActive ? "#0F172A" : "#64748B",
                        background: isActive ? "#F1F5F9" : "transparent",
                      }}
                      data-testid={item.testId}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {item.label}
                    </button>
                  </Link>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              {isPlatformAdmin && (
                <Link href="/admin/dashboard">
                  <Button variant="ghost" size="sm" className="h-8 text-xs" style={{ color: "#64748B" }} data-testid="button-switch-admin">
                    <Shield className="w-3.5 h-3.5 mr-1" />
                    Admin
                  </Button>
                </Link>
              )}
              <Link href="/machine/settings">
                <Button variant="ghost" size="sm" className="h-8" style={{ color: "#64748B" }} data-testid="button-settings">
                  <Cog className="w-3.5 h-3.5" />
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="h-8"
                style={{ color: "#64748B" }}
                data-testid="button-logout"
              >
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
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
          className="max-w-[1440px] mx-auto"
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
