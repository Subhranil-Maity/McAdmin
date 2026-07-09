import { ConsoleLog } from "./types";

// Helper to simulate network latency
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to construct backend URL for API status
export function getBackendStatusUrl(): string {
  let url = process.env.NEXT_PUBLIC_BACKEND_URL || "";
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  url = url.replace(/\/+$/, "");
  return `${url}/api/status`;
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
