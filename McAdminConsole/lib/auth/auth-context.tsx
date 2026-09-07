"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getBackendBaseUrl,
  apiFetch,
} from "@/lib/mc-server/utils";

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

  const checkBackendHealth = useCallback(async (): Promise<boolean> => {
    const baseUrl = getBackendBaseUrl();
    if (!baseUrl) {
      setIsBackendAvailable(false);
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${baseUrl}/api/auth/health`, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setIsBackendAvailable(true);
        setIsFirstRun(Boolean(data.is_first_run));
        return true;
      } else {
        setIsBackendAvailable(false);
        return false;
      }
    } catch {
      setIsBackendAvailable(false);
      return false;
    }
  }, []);

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
