import { createContext, useContext, useState, useCallback, useEffect, createElement } from "react";
import type { ReactNode } from "react";

interface AuthState {
  token: string | null;
  expiresAt: number | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  getToken: () => string | null;
}

const AuthContext = createContext<AuthState | null>(null);

function getStoredAuth(): { token: string | null; expiresAt: number | null } {
  try {
    const token = localStorage.getItem("auth_token");
    const expiresAt = localStorage.getItem("auth_expires_at");
    if (token && expiresAt) {
      const exp = parseInt(expiresAt, 10);
      if (Date.now() < exp) {
        return { token, expiresAt: exp };
      }
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_expires_at");
    }
  } catch {}
  return { token: null, expiresAt: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = getStoredAuth();
  const [token, setToken] = useState<string | null>(stored.token);
  const [expiresAt, setExpiresAt] = useState<number | null>(stored.expiresAt);

  const isAuthenticated = !!token && !!expiresAt && Date.now() < expiresAt;

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Login failed");
    }

    const data = await res.json();
    const exp = Date.now() + data.expires_in * 1000;
    localStorage.setItem("auth_token", data.token);
    localStorage.setItem("auth_expires_at", String(exp));
    setToken(data.token);
    setExpiresAt(exp);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_expires_at");
    setToken(null);
    setExpiresAt(null);
  }, []);

  const getToken = useCallback(() => {
    if (token && expiresAt && Date.now() < expiresAt) return token;
    return null;
  }, [token, expiresAt]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (expiresAt && Date.now() >= expiresAt) {
        logout();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [expiresAt, logout]);

  const value: AuthState = { token, expiresAt, isAuthenticated, login, logout, getToken };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
