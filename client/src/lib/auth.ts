import { createContext, useContext, useState, useCallback, useEffect, useRef, createElement } from "react";
import type { ReactNode } from "react";
import { useToast } from "@/hooks/use-toast";

interface AuthState {
  token: string | null;
  expiresAt: number | null;
  isAuthenticated: boolean;
  role: string | null;
  clientId: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  getToken: () => string | null;
}

const AuthContext = createContext<AuthState | null>(null);

const AUTH_TOKEN_KEY = "auth_token";
const AUTH_EXPIRES_KEY = "auth_expires_at";
const AUTH_ROLE_KEY = "auth_role";
const AUTH_CLIENT_ID_KEY = "auth_client_id";
const EXPIRY_WARNING_MS = 5 * 60 * 1000;

function getStoredAuth(): { token: string | null; expiresAt: number | null; role: string | null; clientId: string | null } {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const expiresAt = localStorage.getItem(AUTH_EXPIRES_KEY);
    const role = localStorage.getItem(AUTH_ROLE_KEY);
    const clientId = localStorage.getItem(AUTH_CLIENT_ID_KEY);
    if (token && expiresAt) {
      const exp = parseInt(expiresAt, 10);
      if (Date.now() < exp) {
        return { token, expiresAt: exp, role, clientId };
      }
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_EXPIRES_KEY);
      localStorage.removeItem(AUTH_ROLE_KEY);
      localStorage.removeItem(AUTH_CLIENT_ID_KEY);
    }
  } catch {}
  return { token: null, expiresAt: null, role: null, clientId: null };
}

export function getStoredToken(): string | null {
  const { token, expiresAt } = getStoredAuth();
  if (token && expiresAt && Date.now() < expiresAt) return token;
  return null;
}

let globalLogout: (() => void) | null = null;
let globalToast: ((opts: { title: string; description?: string; variant?: string }) => void) | null = null;

export function handleGlobal401() {
  if (globalToast) {
    globalToast({
      title: "Session expired",
      description: "You've been logged out. Please sign in again.",
      variant: "destructive",
    });
  }
  if (globalLogout) {
    globalLogout();
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = getStoredAuth();
  const [token, setToken] = useState<string | null>(stored.token);
  const [expiresAt, setExpiresAt] = useState<number | null>(stored.expiresAt);
  const [role, setRole] = useState<string | null>(stored.role);
  const [clientId, setClientId] = useState<string | null>(stored.clientId);
  const warnedRef = useRef(false);
  const { toast } = useToast();

  const isAuthenticated = !!token && !!expiresAt && Date.now() < expiresAt;

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_EXPIRES_KEY);
    localStorage.removeItem(AUTH_ROLE_KEY);
    localStorage.removeItem(AUTH_CLIENT_ID_KEY);
    setToken(null);
    setExpiresAt(null);
    setRole(null);
    setClientId(null);
    warnedRef.current = false;
  }, []);

  useEffect(() => {
    globalLogout = logout;
    globalToast = toast as any;
    return () => {
      globalLogout = null;
      globalToast = null;
    };
  }, [logout, toast]);

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
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    localStorage.setItem(AUTH_EXPIRES_KEY, String(exp));
    if (data.role) localStorage.setItem(AUTH_ROLE_KEY, data.role);
    if (data.client_id) localStorage.setItem(AUTH_CLIENT_ID_KEY, data.client_id);
    setToken(data.token);
    setExpiresAt(exp);
    setRole(data.role || null);
    setClientId(data.client_id || null);
    warnedRef.current = false;
  }, []);

  const getToken = useCallback(() => {
    if (token && expiresAt && Date.now() < expiresAt) return token;
    return null;
  }, [token, expiresAt]);

  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = expiresAt - now;

      if (remaining <= 0) {
        toast({
          title: "Session expired",
          description: "Your session has expired. Please log in again.",
          variant: "destructive",
        });
        logout();
        return;
      }

      if (remaining <= EXPIRY_WARNING_MS && !warnedRef.current) {
        warnedRef.current = true;
        toast({
          title: "Session expiring soon",
          description: "Your session will expire in about 5 minutes. Save your work.",
        });
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [expiresAt, logout, toast]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === AUTH_TOKEN_KEY) {
        if (!e.newValue) {
          setToken(null);
          setExpiresAt(null);
        } else {
          setToken(e.newValue);
          const exp = localStorage.getItem(AUTH_EXPIRES_KEY);
          if (exp) setExpiresAt(parseInt(exp, 10));
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value: AuthState = { token, expiresAt, isAuthenticated, role, clientId, login, logout, getToken };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
