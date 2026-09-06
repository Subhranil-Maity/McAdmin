import { ConsoleLog } from "./types";

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
 * Safely retrieve current Clerk session JWT token in the browser.
 */
export async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }

  // 1. Try window.Clerk.session.getToken()
  try {
    const clerk = (window as unknown as { Clerk?: { session?: { getToken: (opts?: { skipCache?: boolean }) => Promise<string | null> } } }).Clerk;
    if (clerk?.session) {
      const token = await clerk.session.getToken();
      if (token) return token;
    }
  } catch (err) {
    console.debug("Could not get token from window.Clerk:", err);
  }

  // 2. Try parsing __session cookie from document.cookie
  try {
    const match = document.cookie.match(/(?:^|;\s*)__session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  } catch (err) {
    console.debug("Could not get token from document.cookie:", err);
  }

  // 3. If Clerk is still initializing, retry up to 5 times (500ms max)
  for (let i = 0; i < 5; i++) {
    await delay(100);
    try {
      const clerk = (window as unknown as { Clerk?: { session?: { getToken: (opts?: { skipCache?: boolean }) => Promise<string | null> } } }).Clerk;
      if (clerk?.session) {
        const token = await clerk.session.getToken();
        if (token) return token;
      }
      const match = document.cookie.match(/(?:^|;\s*)__session=([^;]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    } catch {}
  }

  return null;
}

/**
 * Standard fetch wrapper that automatically injects Clerk Bearer token.
 */
export async function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  let token = await getAuthToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let res = await fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });

  // If 401 occurs, attempt a single token refresh retry
  if (res.status === 401 && typeof window !== "undefined") {
    try {
      const clerk = (window as unknown as { Clerk?: { session?: { getToken: (opts?: { skipCache?: boolean }) => Promise<string | null> } } }).Clerk;
      if (clerk?.session) {
        token = await clerk.session.getToken({ skipCache: true });
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
          res = await fetch(input, {
            ...init,
            headers,
            credentials: "include",
          });
        }
      }
    } catch {}
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

  // Extract timestamp like [22:59:57] or 22:59:57
  const timeRegex = /\[?(\d{2}:\d{2}:\d{2})\]?/;
  const timeMatch = line.match(timeRegex);
  if (timeMatch) {
    timestamp = timeMatch[1];
  } else {
    // Fallback: format current time as HH:MM:SS
    timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  }

  // Extract level
  const upperLine = line.toUpperCase();
  if (upperLine.includes("ERROR") || upperLine.includes("SEVERE") || upperLine.includes("FATAL") || upperLine.includes("CRITICAL")) {
    level = "ERROR";
  } else if (upperLine.includes("WARN") || upperLine.includes("WARNING")) {
    level = "WARN";
  } else {
    level = "INFO";
  }

  // Clean message: remove prefix like "[22:59:57] [Server thread/INFO]: " or "[22:59:57 INFO]: "
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
