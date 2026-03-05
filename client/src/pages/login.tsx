import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md" style={{ border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }} data-testid="login-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(16,185,129,0.08)" }}>
            <svg width="32" height="32" viewBox="0 0 32 32" style={{ color: "#10B981" }}>
              <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="16" cy="16" r="6" fill="currentColor" opacity="0.6" />
              <line x1="16" y1="2" x2="16" y2="8" stroke="currentColor" strokeWidth="2" />
              <line x1="16" y1="24" x2="16" y2="30" stroke="currentColor" strokeWidth="2" />
              <line x1="2" y1="16" x2="8" y2="16" stroke="currentColor" strokeWidth="2" />
              <line x1="24" y1="16" x2="30" y2="16" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <CardTitle className="text-2xl font-bold" style={{ color: "#0F172A" }}>Texas Automation Systems</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>
            {error && (
              <div className="text-destructive text-sm text-center" data-testid="text-error">
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="w-full font-bold"
              style={{ background: "#0F172A", color: "#FFFFFF" }}
              disabled={loading}
              data-testid="button-login"
            >
              {loading ? "Authenticating..." : "Access Dashboard"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
