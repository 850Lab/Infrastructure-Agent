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
import type { ReactNode } from "react";
import { useEffect } from "react";

interface MeResponse {
  email: string;
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

function OnboardingGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, getToken } = useAuth();
  const [location, navigate] = useLocation();

  const { data: me, isLoading } = useQuery<MeResponse>({
    queryKey: ["/api/me"],
    enabled: isAuthenticated,
    staleTime: 30000,
  });

  useEffect(() => {
    if (!isAuthenticated || isLoading || !me) return;

    const onProtectedPage = location !== "/login" && location !== "/onboarding" && location !== "/briefing";

    if (me.needsOnboarding && onProtectedPage) {
      navigate("/onboarding");
    }
  }, [me, isAuthenticated, isLoading, location, navigate]);

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

function Router() {
  return (
    <OnboardingGate>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/onboarding">
          <ProtectedRoute><OnboardingPage /></ProtectedRoute>
        </Route>
        <Route path="/briefing">
          <ProtectedRoute><BriefingPage /></ProtectedRoute>
        </Route>
        <Route path="/dashboard">
          <ProtectedRoute><Dashboard /></ProtectedRoute>
        </Route>
        <Route path="/today">
          <ProtectedRoute><TodayPage /></ProtectedRoute>
        </Route>
        <Route path="/followups">
          <ProtectedRoute><FollowupsPage /></ProtectedRoute>
        </Route>
        <Route path="/lead-engine">
          <ProtectedRoute><LeadEnginePage /></ProtectedRoute>
        </Route>
        <Route path="/contacts">
          <ProtectedRoute><ContactsPage /></ProtectedRoute>
        </Route>
        <Route path="/analytics">
          <ProtectedRoute><AnalyticsPage /></ProtectedRoute>
        </Route>
        <Route path="/pipeline">
          <ProtectedRoute><PipelinePage /></ProtectedRoute>
        </Route>
        <Route path="/call-mode">
          <ProtectedRoute><CallModePage /></ProtectedRoute>
        </Route>
        <Route path="/">
          <Redirect to="/dashboard" />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </OnboardingGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
