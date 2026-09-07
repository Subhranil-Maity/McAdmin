import { ConsoleLog } from "./types";

export const AUTH_TOKEN_KEY = "mcadmin_token";

// Helper to simulate network latency
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to construct backend base URL
export function getBackendBaseUrl(): string {
  let url = process.env.NEXT_PUBLIC_BACKEND_URL || "";
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace(/\/+$/, "");
}

// Helper to construct backend URL for API status
export function getBackendStatusUrl(): string {
  const base = getBackendBaseUrl();
  return base ? `${base}/api/status` : "";
}

/**
 * Retrieve current JWT auth token in the browser.
 */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const local = localStorage.getItem(AUTH_TOKEN_KEY);
    if (local) return local;
  } catch {}

  try {
    const match = document.cookie.match(/(?:^|;\s*)mcadmin_token=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  } catch {}

  return null;
}

/**
 * Save JWT auth token to localStorage and cookie.
 */
export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {}

  try {
    // 7 days expiration
    document.cookie = `mcadmin_token=${encodeURIComponent(token)}; path=/; max-age=604800; SameSite=Lax`;
  } catch {}

  window.dispatchEvent(new Event("mcadmin:auth_change"));
}

/**
 * Clear JWT auth token.
 */
export function clearAuthToken(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}

  try {
    document.cookie = "mcadmin_token=; path=/; max-age=0; SameSite=Lax";
  } catch {}

  window.dispatchEvent(new Event("mcadmin:auth_change"));
}

/**
 * Standard fetch wrapper that automatically injects Bearer token.
 */
export async function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && token) {
    clearAuthToken();
  }

  return res;
}

// Utility to format uptime seconds into readable string (e.g., 5h 56m 31s or 32m 12s)
export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  return `${m}m ${s}s`;
}

// Helper to parse logs returned from backend to ConsoleLog format
export function parseLogLine(line: string): ConsoleLog {
  let timestamp = "";
  let level: "INFO" | "WARN" | "ERROR" = "INFO";
  let message = line;

  const timeRegex = /\[?(\d{2}:\d{2}:\d{2})\]?/;
  const timeMatch = line.match(timeRegex);
  if (timeMatch) {
    timestamp = timeMatch[1];
  } else {
    timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  }

  const upperLine = line.toUpperCase();
  if (upperLine.includes("ERROR") || upperLine.includes("SEVERE") || upperLine.includes("FATAL") || upperLine.includes("CRITICAL")) {
    level = "ERROR";
  } else if (upperLine.includes("WARN") || upperLine.includes("WARNING")) {
    level = "WARN";
  } else {
    level = "INFO";
  }

  const bracketColonIdx = line.indexOf("]: ");
  if (bracketColonIdx !== -1) {
    message = line.substring(bracketColonIdx + 3);
  } else {
    const colonIdx = line.indexOf(": ");
    if (colonIdx !== -1 && colonIdx > 8) {
      message = line.substring(colonIdx + 2);
    }
  }

  return { timestamp, level, message };
}

// Helper to normalize path format
export function normalizePath(p: string): string {
  let cleaned = p.trim().replace(/\\/g, "/");
  if (!cleaned.startsWith("/")) {
    cleaned = "/" + cleaned;
  }
  if (cleaned.length > 1 && cleaned.endsWith("/")) {
    cleaned = cleaned.substring(0, cleaned.length - 1);
  }
  return cleaned;
}
