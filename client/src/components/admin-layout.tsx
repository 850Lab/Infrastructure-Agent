import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { LogOut, LayoutDashboard, Users, PlusCircle, History, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

const navItems = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/clients", label: "Clients", icon: Users },
  { href: "/admin/provision", label: "Provision", icon: PlusCircle },
  { href: "/admin/runs", label: "Runs", icon: History },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { logout } = useAuth();

  return (
    <div className="min-h-screen" style={{ background: "#FFFFFF" }}>
      <nav className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #E2E8F0" }}>
        <div className="max-w-[1400px] mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link href="/admin/dashboard" className="flex items-center gap-2.5" data-testid="link-admin-home">
              <Activity className="w-5 h-5" style={{ color: "#10B981" }} />
              <div className="flex flex-col">
                <span className="font-bold text-base tracking-tight leading-none" style={{ color: "#0F172A" }}>
                  Texas Automation Systems
                </span>
                <span className="text-xs font-mono" style={{ color: "#94A3B8" }}>Admin Platform</span>
              </div>
            </Link>

            <div className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      style={{
                        color: isActive ? "#10B981" : "#64748B",
                        background: isActive ? "rgba(16,185,129,0.06)" : "transparent",
                      }}
                      data-testid={`nav-${item.label.toLowerCase()}`}
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              style={{ color: "#64748B" }}
              data-testid="button-admin-logout"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Logout</span>
            </Button>
          </div>
        </div>
      </nav>

      <main className="max-w-[1400px] mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
