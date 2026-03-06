import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import OnboardingPage from "@/pages/onboarding";
import BriefingPage from "@/pages/briefing";
import TodayPage from "@/pages/today";
import FollowupsPage from "@/pages/followups";
import LeadEnginePage from "@/pages/lead-engine";
import ContactsPage from "@/pages/contacts";
import AnalyticsPage from "@/pages/analytics";
import PipelinePage from "@/pages/pipeline";
import CallModePage from "@/pages/call-mode";
import MachineSettingsPage from "@/pages/machine-settings";
import CinematicPage from "@/pages/cinematic";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminClients from "@/pages/admin/clients";
import AdminProvision from "@/pages/admin/provision";
import AdminRuns from "@/pages/admin/runs";
import type { ReactNode } from "react";
import { useEffect } from "react";
import ErrorBoundary from "@/components/error-boundary";

interface MeResponse {
  email: string;
  role: string;
  client_id: string | null;
  client: Record<string, any> | null;
  machine_config: Record<string, any> | null;
  needsOnboarding: boolean;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }
  if (role !== "platform_admin") {
    return <Redirect to="/machine/dashboard" />;
  }
  return <>{children}</>;
}

function MachineRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }
  if (role === "platform_admin") {
    return <Redirect to="/admin/dashboard" />;
  }
  return <>{children}</>;
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, role } = useAuth();
  const [location, navigate] = useLocation();

  const { data: me, isLoading } = useQuery<MeResponse>({
    queryKey: ["/api/me"],
    enabled: isAuthenticated,
    staleTime: 30000,
  });

  useEffect(() => {
    if (!isAuthenticated || isLoading || !me) return;

    if (role === "platform_admin") return;

    const skipPaths = ["/login", "/machine/onboarding", "/machine/briefing", "/machine/cinematic"];
    const onProtectedPage = !skipPaths.includes(location);

    if (me.needsOnboarding && onProtectedPage) {
      navigate("/machine/onboarding");
    }
  }, [me, isAuthenticated, isLoading, location, navigate, role]);

  if (isAuthenticated && isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFFFFF" }}>
        <div className="text-center">
          <div className="w-8 h-8 rounded-full mx-auto mb-3" style={{ border: "2px solid #10B981", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />
          <p className="text-sm font-mono" style={{ color: "#94A3B8" }}>Loading...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function RoleRedirect() {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (role === "platform_admin") return <Redirect to="/admin/dashboard" />;
  return <Redirect to="/machine/dashboard" />;
}

function Router() {
  return (
    <OnboardingGate>
      <Switch>
        <Route path="/login" component={LoginPage} />

        <Route path="/admin/dashboard"><AdminRoute><AdminDashboard /></AdminRoute></Route>
        <Route path="/admin/clients"><AdminRoute><AdminClients /></AdminRoute></Route>
        <Route path="/admin/provision"><AdminRoute><AdminProvision /></AdminRoute></Route>
        <Route path="/admin/runs"><AdminRoute><AdminRuns /></AdminRoute></Route>

        <Route path="/machine/onboarding"><MachineRoute><OnboardingPage /></MachineRoute></Route>
        <Route path="/machine/briefing"><MachineRoute><BriefingPage /></MachineRoute></Route>
        <Route path="/machine/cinematic"><MachineRoute><CinematicPage /></MachineRoute></Route>
        <Route path="/machine/dashboard"><MachineRoute><Dashboard /></MachineRoute></Route>
        <Route path="/machine/today"><MachineRoute><TodayPage /></MachineRoute></Route>
        <Route path="/machine/followups"><MachineRoute><FollowupsPage /></MachineRoute></Route>
        <Route path="/machine/lead-engine"><MachineRoute><LeadEnginePage /></MachineRoute></Route>
        <Route path="/machine/contacts"><MachineRoute><ContactsPage /></MachineRoute></Route>
        <Route path="/machine/analytics"><MachineRoute><AnalyticsPage /></MachineRoute></Route>
        <Route path="/machine/pipeline"><MachineRoute><PipelinePage /></MachineRoute></Route>
        <Route path="/machine/call-mode"><MachineRoute><CallModePage /></MachineRoute></Route>
        <Route path="/machine/settings"><MachineRoute><MachineSettingsPage /></MachineRoute></Route>

        {/* Legacy routes redirect to new paths */}
        <Route path="/dashboard"><RoleRedirect /></Route>
        <Route path="/onboarding"><Redirect to="/machine/onboarding" /></Route>
        <Route path="/briefing"><Redirect to="/machine/briefing" /></Route>
        <Route path="/cinematic"><Redirect to="/machine/cinematic" /></Route>
        <Route path="/today"><Redirect to="/machine/today" /></Route>
        <Route path="/followups"><Redirect to="/machine/followups" /></Route>
        <Route path="/lead-engine"><Redirect to="/machine/lead-engine" /></Route>
        <Route path="/contacts"><Redirect to="/machine/contacts" /></Route>
        <Route path="/analytics"><Redirect to="/machine/analytics" /></Route>
        <Route path="/pipeline"><Redirect to="/machine/pipeline" /></Route>
        <Route path="/call-mode"><Redirect to="/machine/call-mode" /></Route>
        <Route path="/machine-settings"><Redirect to="/machine/settings" /></Route>

        <Route path="/"><RoleRedirect /></Route>
        <Route component={NotFound} />
      </Switch>
    </OnboardingGate>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
