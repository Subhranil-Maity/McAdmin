import { ServerStatus, ServerStatusState } from "./types";
import { delay, getBackendBaseUrl, parseLogLine, apiFetch } from "./utils";
import { logsCache } from "./console";

export let lastFetchedStatus: ServerStatus | null = null;

async function getDummyServerStatus(): Promise<ServerStatus> {
  await delay(100);

  const timeFactor = Date.now() / 2000;
  const cpu = Math.floor(10 + Math.sin(timeFactor) * 5 + Math.random() * 8);
  const ramUsed = parseFloat((4.2 + Math.cos(timeFactor / 2) * 0.15 + Math.random() * 0.05).toFixed(2));
  const uptimeSeconds = Math.floor(Date.now() / 1000) % 86400;

  return {
    status: "ONLINE",
    cpu,
    ramUsed,
    ramMax: 8.0,
    uptime: uptimeSeconds,
    version: "Minecraft 1.20.4",
    ipAddress: "127.0.0.1",
    port: 25565,
    activePlayers: 3,
    maxPlayers: 20,
    isReachable: true,
  };
}

export async function getServerStatus(instanceId?: string): Promise<ServerStatus> {
  const base = getBackendBaseUrl();
  if (!base) {
    const dummy = await getDummyServerStatus();
    lastFetchedStatus = dummy;
    return dummy;
  }

  const endpoint = instanceId
    ? `${base}/api/instances/${encodeURIComponent(instanceId)}/status`
    : `${base}/api/status`;

  try {
    const res = await apiFetch(endpoint, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();

    const statusState: ServerStatusState =
      data.status === "ONLINE" || data.status === "OFFLINE" || data.status === "STARTING"
        ? data.status
        : "OFFLINE";

    const cpu = typeof data.cpu_usage === "number" ? parseFloat(data.cpu_usage.toFixed(2)) : 0;
    const ramMax =
      typeof data.ram_allocated_mb === "number"
        ? parseFloat((data.ram_allocated_mb / 1024).toFixed(2))
        : 8.0;
    const ramUsed =
      typeof data.ram_used_mb === "number"
        ? parseFloat((data.ram_used_mb / 1024).toFixed(2))
        : 0;

    const uptime = typeof data.uptime_seconds === "number" ? data.uptime_seconds : 0;
    const activePlayers = typeof data.active_players === "number" ? data.active_players : 0;
    const maxPlayers = typeof data.max_players === "number" ? data.max_players : 20;

    if (Array.isArray(data.recent_logs)) {
      logsCache.list = data.recent_logs.map((line: string) => parseLogLine(line));
    }

    const urlWithoutProto = base.replace(/^https?:\/\//i, "");
    const [ip] = urlWithoutProto.split(":");
    const ipAddress = ip || "127.0.0.1";
    const port = data.server_port || 25565;

    const serverStatus: ServerStatus = {
      status: statusState,
      cpu,
      ramUsed,
      ramMax,
      uptime,
      version: data.minecraft_version || "Minecraft",
      ipAddress,
      port,
      activePlayers,
      maxPlayers,
      isReachable: true,
    };

    lastFetchedStatus = serverStatus;
    return serverStatus;
  } catch (error) {
    console.error("Error fetching server status from backend:", error);

    const urlWithoutProto = base.replace(/^https?:\/\//i, "");
    const [ip] = urlWithoutProto.split(":");
    const ipAddress = ip || "127.0.0.1";

    const offlineStatus: ServerStatus = {
      status: "OFFLINE",
      cpu: 0,
      ramUsed: 0,
      ramMax: 8.0,
      uptime: 0,
      version: "Unknown",
      ipAddress,
      port: 25565,
      activePlayers: 0,
      maxPlayers: 20,
      isReachable: false,
    };
    lastFetchedStatus = offlineStatus;
    return offlineStatus;
  }
}

export async function toggleServerPower(
  action: "start" | "stop" | "restart",
  instanceId?: string
): Promise<void> {
  const base = getBackendBaseUrl();
  if (!base) {
    await delay(500);
    return;
  }

  const startUrl = instanceId
    ? `${base}/api/instances/${encodeURIComponent(instanceId)}/start`
    : `${base}/api/server/start`;
  const stopUrl = instanceId
    ? `${base}/api/instances/${encodeURIComponent(instanceId)}/stop`
    : `${base}/api/server/stop`;

  if (action === "start") {
    const res = await apiFetch(startUrl, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Failed to start server: status ${res.status}`);
    }
  } else if (action === "stop") {
    const res = await apiFetch(stopUrl, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Failed to stop server: status ${res.status}`);
    }
  } else if (action === "restart") {
    const resStop = await apiFetch(stopUrl, { method: "POST" });
    if (!resStop.ok) {
      throw new Error(`Failed to stop server during restart: status ${resStop.status}`);
    }
    await delay(2000);
    const resStart = await apiFetch(startUrl, { method: "POST" });
    if (!resStart.ok) {
      throw new Error(`Failed to start server during restart: status ${resStart.status}`);
    }
  }
}
