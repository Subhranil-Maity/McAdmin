import { ServerStatus, ServerStatusState } from "./types";
import { delay, getBackendStatusUrl, parseLogLine } from "./utils";
import { logsCache } from "./console";

export let lastFetchedStatus: ServerStatus | null = null;

// Get status of server from dummy generator when backend is not configured
async function getDummyServerStatus(): Promise<ServerStatus> {
  await delay(100);

  const timeFactor = Date.now() / 2000;
  const cpu = Math.floor(10 + Math.sin(timeFactor) * 5 + Math.random() * 8);
  const ramUsed = parseFloat((4.2 + Math.cos(timeFactor / 2) * 0.15 + Math.random() * 0.05).toFixed(2));
  const uptimeSeconds = Math.floor(Date.now() / 1000) % 86400; // static uptime

  return {
    status: "ONLINE",
    cpu,
    ramUsed,
    ramMax: 8.0,
    uptime: uptimeSeconds,
    version: "Spigot 1.20.4",
    ipAddress: "127.0.0.1",
    port: 25565,
    activePlayers: 3,
    maxPlayers: 20,
  };
}

export async function getServerStatus(): Promise<ServerStatus> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    const dummy = await getDummyServerStatus();
    lastFetchedStatus = dummy;
    return dummy;
  }

  const endpoint = getBackendStatusUrl();
  try {
    const res = await fetch(endpoint, { cache: "no-store", credentials: "include" });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    
    const statusState: ServerStatusState = 
      data.status === "ONLINE" || data.status === "OFFLINE" || data.status === "STARTING"
        ? data.status
        : "ONLINE";

    const cpu = typeof data.cpu_usage === "number" ? parseFloat(data.cpu_usage.toFixed(2)) : 0;
    const ramMax = typeof data.ram_allocated_mb === "number" 
      ? parseFloat((data.ram_allocated_mb / 1024).toFixed(2)) 
      : 8.0;
    const ramUsed = typeof data.ram_used_mb === "number" 
      ? parseFloat((data.ram_used_mb / 1024).toFixed(2)) 
      : 0;
      
    const uptime = typeof data.uptime_seconds === "number" ? data.uptime_seconds : 0;
    const activePlayers = typeof data.active_players === "number" ? data.active_players : 0;
    const maxPlayers = typeof data.max_players === "number" ? data.max_players : 10;

    if (Array.isArray(data.recent_logs)) {
      logsCache.list = data.recent_logs.map((line: string) => parseLogLine(line));
    }

    const urlWithoutProto = backendUrl.replace(/^https?:\/\//i, "");
    const [ip, portStr] = urlWithoutProto.split(":");
    const ipAddress = ip || "127.0.0.1";
    const port = portStr ? parseInt(portStr, 10) : 25565;

    const serverStatus: ServerStatus = {
      status: statusState,
      cpu,
      ramUsed,
      ramMax,
      uptime,
      version: "Spigot 1.20.4",
      ipAddress,
      port,
      activePlayers,
      maxPlayers,
    };
    
    lastFetchedStatus = serverStatus;
    return serverStatus;
  } catch (error) {
    console.error("Error fetching server status from backend:", error);
    
    const urlWithoutProto = backendUrl.replace(/^https?:\/\//i, "");
    const [ip, portStr] = urlWithoutProto.split(":");
    const ipAddress = ip || "127.0.0.1";
    const port = portStr ? parseInt(portStr, 10) : 25565;
    
    const offlineStatus: ServerStatus = {
      status: "OFFLINE",
      cpu: 0,
      ramUsed: 0,
      ramMax: 8.0,
      uptime: 0,
      version: "Unknown",
      ipAddress,
      port,
      activePlayers: 0,
      maxPlayers: 10,
    };
    lastFetchedStatus = offlineStatus;
    return offlineStatus;
  }
}

export async function toggleServerPower(action: "start" | "stop" | "restart"): Promise<void> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(500);
    return;
  }

  // Backend implementation
  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  if (action === "start") {
    const res = await fetch(`${base}/api/server/start`, { method: "POST", credentials: "include" });
    if (!res.ok) {
      throw new Error(`Failed to start server: status ${res.status}`);
    }
  } else if (action === "stop") {
    const res = await fetch(`${base}/api/server/stop`, { method: "POST", credentials: "include" });
    if (!res.ok) {
      throw new Error(`Failed to stop server: status ${res.status}`);
    }
  } else if (action === "restart") {
    const resStop = await fetch(`${base}/api/server/stop`, { method: "POST", credentials: "include" });
    if (!resStop.ok) {
      throw new Error(`Failed to stop server during restart: status ${resStop.status}`);
    }
    await delay(2000);
    const resStart = await fetch(`${base}/api/server/start`, { method: "POST", credentials: "include" });
    if (!resStart.ok) {
      throw new Error(`Failed to start server during restart: status ${resStart.status}`);
    }
  }
}
