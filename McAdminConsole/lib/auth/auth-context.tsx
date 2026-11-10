import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getBackendBaseUrl,
  apiFetch,
  BACKEND_UNREACHABLE_EVENT,
} from "@/lib/mc-server/utils";

/** How often the worker is checked while the app is up. */
const HEALTH_INTERVAL_MS = 10_000;
/** A health request slower than this counts as a failure. */
const HEALTH_TIMEOUT_MS = 4_000;
/** Delay before confirming a first failed check. */
const RECHECK_DELAY_MS = 1_000;
/** Consecutive failed checks before the "backend unavailable" screen is shown. */
const FAILURES_BEFORE_DOWN = 2;

export interface UserPermissions {
  can_create_server: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  is_superuser: boolean;
  permissions: UserPermissions;
  created_at: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isBackendAvailable: boolean | null;
  isFirstRun: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkBackendHealth: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackendAvailable, setIsBackendAvailable] = useState<boolean | null>(null);
  const [isFirstRun, setIsFirstRun] = useState(false);

  // Last known availability and consecutive failed probes, kept in refs so the
  // background checks below don't need to re-subscribe on every state change.
  const availableRef = useRef<boolean | null>(null);
  const failuresRef = useRef(0);

  /** One request to the worker's health endpoint; no state changes. */
  const probeBackend = useCallback(async (): Promise<{ ok: boolean; firstRun?: boolean }> => {
    const baseUrl = getBackendBaseUrl();
    if (!baseUrl) return { ok: false };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/api/auth/health`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return { ok: false };
      const data = await res.json().catch(() => ({}));
      return { ok: true, firstRun: Boolean(data.is_first_run) };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  /**
   * Checks the worker and updates `isBackendAvailable`.
   * While the app is up, it only switches to "unavailable" after
   * FAILURES_BEFORE_DOWN consecutive failed probes, so one dropped request
   * doesn't flash the error screen. On startup and on the unavailable screen a
   * single result counts.
   */
  const checkBackendHealth = useCallback(async (): Promise<boolean> => {
    const { ok, firstRun } = await probeBackend();

    if (ok) {
      failuresRef.current = 0;
      const wasDown = availableRef.current === false;
      availableRef.current = true;
      setIsBackendAvailable(true);
      setIsFirstRun(Boolean(firstRun));
      if (wasDown) {
        // The worker came back: reload the session (the user may have been
        // left logged out if the page loaded while the worker was down).
        window.dispatchEvent(new Event("mcadmin:auth_change"));
      }
      return true;
    }

    failuresRef.current += 1;
    if (availableRef.current !== true || failuresRef.current >= FAILURES_BEFORE_DOWN) {
      availableRef.current = false;
      setIsBackendAvailable(false);
    }
    return false;
  }, [probeBackend]);

  // Keep watching the worker while the app is up (the unavailable screen does
  // its own faster polling): on an interval, when the tab regains focus or the
  // network comes back, and immediately when a request or the live WebSocket
  // fails at the network level (see BACKEND_UNREACHABLE_EVENT).
  useEffect(() => {
    let checking = false;
    const check = async () => {
      if (checking || availableRef.current !== true) return;
      checking = true;
      try {
        // Re-probe quickly after a first failure so an outage is confirmed in
        // about a second instead of waiting for the next interval.
        if (!(await checkBackendHealth()) && availableRef.current === true) {
          await new Promise((r) => setTimeout(r, RECHECK_DELAY_MS));
          await checkBackendHealth();
        }
      } finally {
        checking = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, HEALTH_INTERVAL_MS);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    window.addEventListener(BACKEND_UNREACHABLE_EVENT, check);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      window.removeEventListener(BACKEND_UNREACHABLE_EVENT, check);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkBackendHealth]);

  const loadCurrentUser = useCallback(async () => {
    const currentToken = getAuthToken();
    setToken(currentToken);

    if (!currentToken) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    const baseUrl = getBackendBaseUrl();
    try {
      const res = await apiFetch(`${baseUrl}/api/auth/me`);
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        clearAuthToken();
        setUser(null);
        setToken(null);
      }
    } catch (err) {
      console.error("Failed to fetch current user:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const isUp = await checkBackendHealth();
      if (isUp && mounted) {
        await loadCurrentUser();
      } else if (mounted) {
        setIsLoading(false);
      }
    }

    init();

    const onAuthChange = () => {
      if (mounted) {
        loadCurrentUser();
      }
    };

    window.addEventListener("mcadmin:auth_change", onAuthChange);
    return () => {
      mounted = false;
      window.removeEventListener("mcadmin:auth_change", onAuthChange);
    };
  }, [checkBackendHealth, loadCurrentUser]);

  const login = async (username: string, password: string) => {
    const baseUrl = getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Login failed");
    }

    setAuthToken(data.token);
    setUser(data.user);
    setToken(data.token);
    setIsFirstRun(false);
  };

  const register = async (username: string, password: string) => {
    const baseUrl = getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Registration failed");
    }

    setAuthToken(data.token);
    setUser(data.user);
    setToken(data.token);
    setIsFirstRun(false);
  };

  const logout = () => {
    clearAuthToken();
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isBackendAvailable,
        isFirstRun,
        login,
        register,
        logout,
        checkBackendHealth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
