import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import TodayPage from "@/pages/today";
import FollowupsPage from "@/pages/followups";
import LeadEnginePage from "@/pages/lead-engine";
import ContactsPage from "@/pages/contacts";
import AnalyticsPage from "@/pages/analytics";
import type { ReactNode } from "react";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
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
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route component={NotFound} />
    </Switch>
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
