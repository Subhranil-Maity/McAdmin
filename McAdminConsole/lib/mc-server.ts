// Minecraft Server Management Service Layer
// TODO: Replace mock promise implementation with actual SSH, RCON, or Docker/Pterodactyl API calls

export type ServerStatusState = "ONLINE" | "OFFLINE" | "STARTING";

export interface ServerStatus {
  status: ServerStatusState;
  cpu: number;
  ramUsed: number;
  ramMax: number;
  uptime: number; // in seconds
  version: string;
  ipAddress: string;
  port: number;
  activePlayers?: number;
  maxPlayers?: number;
}

export interface ConsoleLog {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
}

export interface CommandResponse {
  status: string;
  command: string;
  response: string;
}

export interface Player {
  id: string;
  username: string;
  online: boolean;
  ping: number;
  isOp: boolean;
  isWhitelisted: boolean;
  isBanned: boolean;
}

export interface WhitelistEntry {
  id: string;
  username: string;
  addedAt: string;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
}

export interface ServerProperty {
  name: string;
  value: string;
  defaultValue: string;
  description: string;
  category: "General" | "Gameplay" | "Network" | "World";
}

// Initial mock data state (persists in-memory during dev server session)
let serverState: ServerStatusState = "ONLINE";
let startTime = Date.now();

let mockPlayers: Player[] = [
  { id: "Notch", username: "Notch", online: true, ping: 14, isOp: true, isWhitelisted: true, isBanned: false },
  { id: "Jeb_", username: "Jeb_", online: true, ping: 32, isOp: true, isWhitelisted: true, isBanned: false },
  { id: "Alex", username: "Alex", online: true, ping: 68, isOp: false, isWhitelisted: true, isBanned: false },
  { id: "Steve", username: "Steve", online: false, ping: 0, isOp: false, isWhitelisted: true, isBanned: false },
  { id: "Herobrine", username: "Herobrine", online: false, ping: 0, isOp: false, isWhitelisted: false, isBanned: true },
  { id: "Grumm", username: "Grumm", online: false, ping: 0, isOp: false, isWhitelisted: false, isBanned: false },
];

let mockWhitelist: WhitelistEntry[] = [
  { id: "w1", username: "Notch", addedAt: "2026-07-01 12:30" },
  { id: "w2", username: "Jeb_", addedAt: "2026-07-01 12:35" },
  { id: "w3", username: "Alex", addedAt: "2026-07-02 18:10" },
  { id: "w4", username: "Steve", addedAt: "2026-07-02 18:12" },
];

let mockPlugins: Plugin[] = [
  { id: "p1", name: "EssentialsX", version: "2.20.1", description: "Provides essential commands and features.", enabled: true },
  { id: "p2", name: "WorldEdit", version: "7.2.14", description: "In-game map editor and schematic brush.", enabled: true },
  { id: "p3", name: "LuckPerms", version: "5.4.102", description: "Advanced permissions management plugin.", enabled: true },
  { id: "p4", name: "Vault", version: "1.7.3", description: "Common economy & permission API hook.", enabled: true },
  { id: "p5", name: "Dynmap", version: "3.4-beta", description: "Google-like map viewer for your server.", enabled: false },
];

let mockProperties: ServerProperty[] = [
  { name: "difficulty", value: "hard", defaultValue: "easy", description: "Defines the game difficulty (peaceful, easy, normal, hard).", category: "Gameplay" },
  { name: "pvp", value: "true", defaultValue: "true", description: "Enable player vs player combat on the server.", category: "Gameplay" },
  { name: "max-players", value: "20", defaultValue: "20", description: "Maximum number of concurrent player connections.", category: "Network" },
  { name: "server-port", value: "25565", defaultValue: "25565", description: "The port number the server listens to.", category: "Network" },
  { name: "view-distance", value: "10", defaultValue: "10", description: "Number of chunks sent to the player (4-32).", category: "General" },
  { name: "spawn-monsters", value: "true", defaultValue: "true", description: "Controls whether monsters can spawn in the world.", category: "Gameplay" },
  { name: "level-name", value: "survival_world", defaultValue: "world", description: "The folder name containing the active world files.", category: "World" },
  { name: "motd", value: "§a§lMinecraft Admin Server Console", defaultValue: "A Minecraft Server", description: "Message of the Day displayed in the server browser.", category: "General" },
];

const mockLogs: ConsoleLog[] = [
  { timestamp: "19:10:02", level: "INFO", message: "Starting minecraft server version 1.20.4" },
  { timestamp: "19:10:05", level: "INFO", message: "Loading properties from server.properties" },
  { timestamp: "19:10:05", level: "INFO", message: "Default game type: SURVIVAL" },
  { timestamp: "19:10:06", level: "INFO", message: "Preparing level \"survival_world\"" },
  { timestamp: "19:10:10", level: "INFO", message: "Preparing start region for dimension minecraft:overworld" },
  { timestamp: "19:10:12", level: "INFO", message: "Done (6.5s)! For help, type \"help\"" },
  { timestamp: "19:11:45", level: "INFO", message: "Notch[/127.0.0.1:54321] logged in with entity id 128" },
  { timestamp: "19:11:46", level: "INFO", message: "Notch joined the game" },
  { timestamp: "19:13:20", level: "INFO", message: "Jeb_[/127.0.0.1:54322] logged in with entity id 256" },
  { timestamp: "19:13:21", level: "INFO", message: "Jeb_ joined the game" },
];

// Helper to simulate network latency
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastFetchedStatus: ServerStatus | null = null;
let lastFetchedLogs: ConsoleLog[] = [];

// Helper to construct backend URL for API status
function getBackendStatusUrl(): string {
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

// Get status of server from dummy generator
async function getDummyServerStatus(): Promise<ServerStatus> {
  await delay(100);

  let cpu = 0;
  let ramUsed = 0;

  if (serverState === "ONLINE") {
    const timeFactor = Date.now() / 2000;
    cpu = Math.floor(10 + Math.sin(timeFactor) * 5 + Math.random() * 8);
    ramUsed = parseFloat((4.2 + Math.cos(timeFactor / 2) * 0.15 + Math.random() * 0.05).toFixed(2));
  } else if (serverState === "STARTING") {
    cpu = Math.floor(65 + Math.random() * 15);
    ramUsed = parseFloat((2.5 + (Date.now() - startTime) / 3000).toFixed(2));
  }

  const uptimeSeconds = serverState === "ONLINE" ? Math.floor((Date.now() - startTime) / 1000) : 0;

  return {
    status: serverState,
    cpu,
    ramUsed,
    ramMax: 8.0,
    uptime: uptimeSeconds,
    version: "Spigot 1.20.4",
    ipAddress: "127.0.0.1",
    port: 25565,
    activePlayers: mockPlayers.filter(p => p.online).length,
    maxPlayers: 20,
  };
}

/**
 * Retrieves the current status, including CPU and RAM usage.
 * Queries NEXT_PUBLIC_BACKEND_URL/api/status if configured, or falls back to mock data.
 */
export async function getServerStatus(): Promise<ServerStatus> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    return getDummyServerStatus();
  }

  const endpoint = getBackendStatusUrl();
  try {
    const res = await fetch(endpoint, { cache: "no-store" });
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
      lastFetchedLogs = data.recent_logs.map((line: string) => parseLogLine(line));
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

/**
 * Returns console logs.
 */
export async function getConsoleLogs(): Promise<ConsoleLog[]> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    return [...mockLogs];
  }

  if (lastFetchedLogs.length === 0) {
    try {
      const endpoint = getBackendStatusUrl();
      const res = await fetch(endpoint, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.recent_logs)) {
          lastFetchedLogs = data.recent_logs.map((line: string) => parseLogLine(line));
        }
      }
    } catch (e) {
      console.error("Error loading console logs:", e);
    }
  }

  return lastFetchedLogs;
}

/**
 * Executes a console command.
 */
export async function sendConsoleCommand(command: string): Promise<CommandResponse> {
  // TODO: Connect via RCON and issue commands
  await delay(150);
  const cleanCmd = command.trim().replace(/^\//, "");
  const [baseCmd, ...args] = cleanCmd.split(" ");
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  const isOnline = backendUrl ? (lastFetchedStatus?.status === "ONLINE") : (serverState === "ONLINE");

  if (!isOnline) {
    return {
      status: "error",
      command: cleanCmd,
      response: "Error: Cannot execute command while server is offline."
    };
  }

  const logEntry1 = { timestamp, level: "INFO" as const, message: `Console issued command: /${cleanCmd}` };
  mockLogs.push(logEntry1);
  if (backendUrl) {
    lastFetchedLogs.push(logEntry1);
  }

  let responseMessage = "";
  let status = "ok";
  let cmdValue = cleanCmd;

  if (backendUrl) {
    let base = backendUrl;
    if (!/^https?:\/\//i.test(base)) {
      base = `http://${base}`;
    }
    base = base.replace(/\/+$/, "");

    try {
      const res = await fetch(`${base}/api/server/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command: cleanCmd }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();
      status = data.status || "ok";
      cmdValue = data.command || cleanCmd;
      responseMessage = data.response || `Command executed successfully.`;
    } catch (e) {
      console.error("Error executing console command:", e);
      status = "error";
      responseMessage = `Error executing command: ${(e as Error).message}`;
    }
  } else {
    // Fallback dummy implementation
    switch (baseCmd.toLowerCase()) {
      case "op":
        const opTarget = args[0] || "player";
        mockPlayers = mockPlayers.map((p) => p.username.toLowerCase() === opTarget.toLowerCase() ? { ...p, isOp: true } : p);
        responseMessage = `Promoted ${opTarget} to server operator`;
        break;
      case "deop":
        const deopTarget = args[0] || "player";
        mockPlayers = mockPlayers.map((p) => p.username.toLowerCase() === deopTarget.toLowerCase() ? { ...p, isOp: false } : p);
        responseMessage = `Demoted ${deopTarget} from server operator`;
        break;
      case "say":
        responseMessage = `[Server] ${args.join(" ")}`;
        break;
      case "whitelist":
        if (args[0] === "add" && args[1]) {
          const username = args[1];
          if (!mockWhitelist.some((w) => w.username.toLowerCase() === username.toLowerCase())) {
            mockWhitelist.push({ id: `w${Date.now()}`, username, addedAt: new Date().toISOString().slice(0, 16).replace("T", " ") });
          }
          responseMessage = `Added ${username} to the whitelist`;
        } else if (args[0] === "remove" && args[1]) {
          const username = args[1];
          mockWhitelist = mockWhitelist.filter((w) => w.username.toLowerCase() !== username.toLowerCase());
          responseMessage = `Removed ${username} from the whitelist`;
        } else {
          responseMessage = `Whitelist options: add <player>, remove <player>`;
        }
        break;
      default:
        responseMessage = `Command "/${baseCmd}" executed.`;
    }
  }

  const logEntry2 = { timestamp, level: "INFO" as const, message: responseMessage };
  mockLogs.push(logEntry2);
  if (backendUrl) {
    lastFetchedLogs.push(logEntry2);
  }
  return {
    status,
    command: cmdValue,
    response: responseMessage,
  };
}

/**
 * Returns player directory lists sorted by online state.
 */
export async function getServerPlayers(): Promise<Player[]> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    return [...mockPlayers].sort((a, b) => {
      if (a.online === b.online) return a.username.localeCompare(b.username);
      return a.online ? -1 : 1;
    });
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  try {
    const playersRes = await fetch(`${base}/api/server/players`, { cache: "no-store" });
    if (!playersRes.ok) {
      throw new Error(`Failed to fetch players: status ${playersRes.status}`);
    }
    const playersData = await playersRes.json();
    const allPlayersList: any[] = playersData.players || [];

    let onlineUsernames: string[] = [];
    try {
      const onlineRes = await fetch(`${base}/api/server/players/online`, { cache: "no-store" });
      if (onlineRes.ok) {
        const onlineData = await onlineRes.json();
        if (Array.isArray(onlineData)) {
          onlineUsernames = onlineData;
        } else if (onlineData && Array.isArray(onlineData.players)) {
          onlineUsernames = onlineData.players;
        }
      }
    } catch (e) {
      // Server offline/starting, online list empty
    }

    const allPlayersMap = new Map(allPlayersList.map((p) => [p.name.toLowerCase(), p]));

    const mappedPlayers: Player[] = allPlayersList.map((p) => {
      const isOnline = onlineUsernames.some((name) => name.toLowerCase() === p.name.toLowerCase());
      return {
        id: p.name,
        username: p.name,
        online: isOnline,
        ping: isOnline ? 20 : 0,
        isOp: p.op || false,
        isWhitelisted: p.whitelisted || false,
        isBanned: p.banned || false,
      };
    });

    // Dynamically append online players who are not in the known offline cache database
    onlineUsernames.forEach((name) => {
      if (name && !allPlayersMap.has(name.toLowerCase())) {
        mappedPlayers.push({
          id: name,
          username: name,
          online: true,
          ping: 20,
          isOp: false,
          isWhitelisted: false,
          isBanned: false,
        });
      }
    });

    return mappedPlayers.sort((a, b) => {
      if (a.online === b.online) return a.username.localeCompare(b.username);
      return a.online ? -1 : 1;
    });
  } catch (err) {
    console.error("Error fetching players from backend:", err);
    return [];
  }
}

/**
 * Performs administrative actions on players.
 */
export async function updatePlayerStatus(
  playerId: string,
  action: "kick" | "ban" | "unban" | "op" | "deop" | "whitelist" | "dewhitelist"
): Promise<void> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(150);
    const player = mockPlayers.find((p) => p.id === playerId || p.username.toLowerCase() === playerId.toLowerCase());
    if (!player) return;
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });

    if (action === "kick") {
      player.online = false;
      player.ping = 0;
      mockLogs.push({ timestamp, level: "INFO", message: `Kicked ${player.username} from the server` });
    } else if (action === "ban") {
      player.online = false;
      player.ping = 0;
      player.isBanned = true;
      mockLogs.push({ timestamp, level: "INFO", message: `Banned player ${player.username}` });
    } else if (action === "unban") {
      player.isBanned = false;
      mockLogs.push({ timestamp, level: "INFO", message: `Unbanned player ${player.username}` });
    } else if (action === "op") {
      player.isOp = true;
      mockLogs.push({ timestamp, level: "INFO", message: `Promoted ${player.username} to operator` });
    } else if (action === "deop") {
      player.isOp = false;
      mockLogs.push({ timestamp, level: "INFO", message: `Demoted ${player.username} from operator` });
    } else if (action === "whitelist") {
      player.isWhitelisted = true;
      if (!mockWhitelist.some((w) => w.username.toLowerCase() === player.username.toLowerCase())) {
        mockWhitelist.push({ id: `w${Date.now()}`, username: player.username, addedAt: new Date().toISOString().slice(0, 16).replace("T", " ") });
      }
      mockLogs.push({ timestamp, level: "INFO", message: `Added ${player.username} to whitelist` });
    } else if (action === "dewhitelist") {
      player.isWhitelisted = false;
      mockWhitelist = mockWhitelist.filter((w) => w.username.toLowerCase() !== player.username.toLowerCase());
      mockLogs.push({ timestamp, level: "INFO", message: `Removed ${player.username} from whitelist` });
    }
    return;
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  let endpoint = "";
  let body: any = { player: playerId };

  switch (action) {
    case "kick":
      endpoint = `${base}/api/server/command`;
      body = { command: `kick ${playerId}` };
      break;
    case "ban":
      endpoint = `${base}/api/server/players/ban`;
      body = { player: playerId, reason: "Banned by administrator" };
      break;
    case "unban":
      endpoint = `${base}/api/server/players/unban`;
      break;
    case "op":
      endpoint = `${base}/api/server/players/op`;
      break;
    case "deop":
      endpoint = `${base}/api/server/players/deop`;
      break;
    case "whitelist":
      endpoint = `${base}/api/server/players/whitelist`;
      break;
    case "dewhitelist":
      endpoint = `${base}/api/server/players/dewhitelist`;
      break;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Failed to perform player action ${action}: status ${res.status}`);
  }
}

/**
 * Returns active whitelist.
 */
export async function getWhitelist(): Promise<WhitelistEntry[]> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    return [...mockWhitelist];
  }

  try {
    const players = await getServerPlayers();
    return players
      .filter((p) => p.isWhitelisted)
      .map((p) => ({
        id: p.username,
        username: p.username,
        addedAt: "Added"
      }));
  } catch (e) {
    console.error("Error fetching whitelist:", e);
    return [];
  }
}

/**
 * Adds player to whitelist.
 */
export async function addWhitelist(username: string): Promise<WhitelistEntry> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    const cleanUser = username.trim();
    const exists = mockWhitelist.find((w) => w.username.toLowerCase() === cleanUser.toLowerCase());
    
    if (exists) {
      return exists;
    }

    const newEntry: WhitelistEntry = {
      id: cleanUser,
      username: cleanUser,
      addedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    };
    mockWhitelist.push(newEntry);
    
    const player = mockPlayers.find((p) => p.username.toLowerCase() === cleanUser.toLowerCase());
    if (player) {
      player.isWhitelisted = true;
    }

    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    mockLogs.push({ timestamp, level: "INFO", message: `Added ${cleanUser} to whitelist` });
    
    return newEntry;
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/server/players/whitelist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player: username }),
  });
  if (!res.ok) {
    throw new Error(`Failed to add player to whitelist: status ${res.status}`);
  }

  return {
    id: username,
    username,
    addedAt: new Date().toISOString().slice(0, 16).replace("T", " ")
  };
}

/**
 * Removes player from whitelist.
 */
export async function removeWhitelist(entryId: string): Promise<void> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    const entry = mockWhitelist.find((w) => w.id === entryId || w.username.toLowerCase() === entryId.toLowerCase());
    if (!entry) return;

    mockWhitelist = mockWhitelist.filter((w) => w.id !== entryId && w.username.toLowerCase() !== entryId.toLowerCase());
    
    const player = mockPlayers.find((p) => p.username.toLowerCase() === entry.username.toLowerCase());
    if (player) {
      player.isWhitelisted = false;
    }

    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    mockLogs.push({ timestamp, level: "INFO", message: `Removed ${entry.username} from whitelist` });
    return;
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/server/players/dewhitelist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player: entryId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to remove player from whitelist: status ${res.status}`);
  }
}

/**
 * Returns plugin lists.
 */
export async function getPlugins(): Promise<Plugin[]> {
  // TODO: Scan plugins/ directory for jar files
  await delay(100);
  return [...mockPlugins];
}

/**
 * Toggles a plugin's state.
 */
export async function togglePluginState(pluginId: string, enabled: boolean): Promise<void> {
  // TODO: Move file from /plugins to /plugins_disabled or issue load commands
  await delay(100);
  mockPlugins = mockPlugins.map((p) => p.id === pluginId ? { ...p, enabled } : p);
  
  const plugin = mockPlugins.find((p) => p.id === pluginId);
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  mockLogs.push({
    timestamp,
    level: "INFO",
    message: `${enabled ? "Enabled" : "Disabled"} plugin: ${plugin?.name || pluginId}`
  });
}

/**
 * Returns properties lists.
 */
export async function getServerProperties(): Promise<ServerProperty[]> {
  // TODO: Read server.properties file
  await delay(100);
  return [...mockProperties];
}

/**
 * Updates a server property value.
 */
export async function updateServerProperty(name: string, value: string): Promise<void> {
  // TODO: Write back to server.properties file
  await delay(100);
  mockProperties = mockProperties.map((p) => p.name === name ? { ...p, value } : p);
  
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  mockLogs.push({
    timestamp,
    level: "INFO",
    message: `Property '${name}' updated to: ${value} (Requires restart to take effect)`
  });
}

/**
 * Control server power transitions.
 */
export async function toggleServerPower(action: "start" | "stop" | "restart"): Promise<void> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    // Fallback dummy implementation
    await delay(500);
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });

    if (action === "start") {
      serverState = "STARTING";
      startTime = Date.now();
      mockLogs.push({ timestamp, level: "INFO", message: "Server start triggered. Launching JVM..." });
      
      setTimeout(() => {
        serverState = "ONLINE";
        startTime = Date.now();
        const onlineTime = new Date().toLocaleTimeString("en-US", { hour12: false });
        mockLogs.push({ timestamp: onlineTime, level: "INFO", message: "Minecraft server started successfully on port 25565" });
        mockPlayers = mockPlayers.map((p) => p.id === "1" || p.id === "2" ? { ...p, online: true } : p);
      }, 4000);

    } else if (action === "stop") {
      serverState = "OFFLINE";
      mockLogs.push({ timestamp, level: "INFO", message: "Stopping server..." });
      mockLogs.push({ timestamp, level: "INFO", message: "Saving chunks..." });
      mockLogs.push({ timestamp, level: "INFO", message: "Server stopped." });
      mockPlayers = mockPlayers.map((p) => ({ ...p, online: false, ping: 0 }));

    } else if (action === "restart") {
      serverState = "OFFLINE";
      mockPlayers = mockPlayers.map((p) => ({ ...p, online: false, ping: 0 }));
      mockLogs.push({ timestamp, level: "INFO", message: "Restart triggered. Stopping server..." });
      
      setTimeout(() => {
        serverState = "STARTING";
        startTime = Date.now();
        const startLogTime = new Date().toLocaleTimeString("en-US", { hour12: false });
        mockLogs.push({ timestamp: startLogTime, level: "INFO", message: "Launching JVM after restart..." });

        setTimeout(() => {
          serverState = "ONLINE";
          startTime = Date.now();
          const onlineTime = new Date().toLocaleTimeString("en-US", { hour12: false });
          mockLogs.push({ timestamp: onlineTime, level: "INFO", message: "Minecraft server started successfully on port 25565" });
          mockPlayers = mockPlayers.map((p) => p.id === "1" || p.id === "2" ? { ...p, online: true } : p);
        }, 4000);
      }, 1500);
    }
    return;
  }

  // Backend implementation
  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  if (action === "start") {
    const res = await fetch(`${base}/api/server/start`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Failed to start server: status ${res.status}`);
    }
  } else if (action === "stop") {
    const res = await fetch(`${base}/api/server/stop`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Failed to stop server: status ${res.status}`);
    }
  } else if (action === "restart") {
    const resStop = await fetch(`${base}/api/server/stop`, { method: "POST" });
    if (!resStop.ok) {
      throw new Error(`Failed to stop server during restart: status ${resStop.status}`);
    }
    await delay(2000);
    const resStart = await fetch(`${base}/api/server/start`, { method: "POST" });
    if (!resStart.ok) {
      throw new Error(`Failed to start server during restart: status ${resStart.status}`);
    }
  }
}

// ==========================================
// File Management API Types & Implementations
// ==========================================

export interface FileEntry {
  name: string;
  size: number;
  modified: string;
  type: "file" | "dir" | "symlink";
}

export interface FileListResponse {
  path: string;
  entries: FileEntry[];
}

export interface FileContentResponse {
  path: string;
  size: number;
  content: string;
}

export interface FileWriteResponse {
  status: string;
  path: string;
}

interface MockFile {
  name: string;
  size: number;
  modified: string;
  type: "file" | "dir" | "symlink";
  content?: string;
}

// Helper to normalize path format
function normalizePath(p: string): string {
  let cleaned = p.trim().replace(/\\/g, "/");
  if (!cleaned.startsWith("/")) {
    cleaned = "/" + cleaned;
  }
  if (cleaned.length > 1 && cleaned.endsWith("/")) {
    cleaned = cleaned.substring(0, cleaned.length - 1);
  }
  return cleaned;
}

// In-memory mock filesystem state for local development
const mockFilesystem: Record<string, MockFile[]> = {
  "/": [
    { name: "plugins", size: 0, modified: "2026-07-09T12:00:00Z", type: "dir" },
    { name: "logs", size: 0, modified: "2026-07-09T10:30:00Z", type: "dir" },
    { name: "world", size: 0, modified: "2026-07-09T13:45:00Z", type: "dir" },
    { name: "server.properties", size: 1024, modified: "2026-07-09T11:15:00Z", type: "file", content: "motd=\\u00A7a\\u00A5lMinecraft Admin Server Console\\npvp=true\\ndifficulty=hard\\nmax-players=20\\nserver-port=25565\\nview-distance=10\\nspawn-monsters=true\\nlevel-name=survival_world\\n" },
    { name: "bukkit.yml", size: 512, modified: "2026-07-01T08:00:00Z", type: "file", content: "settings:\n  allow-end: true\n  warn-on-overload: true\n  query-plugins: true\n" },
    { name: "spigot.yml", size: 2048, modified: "2026-07-01T08:05:00Z", type: "file", content: "settings:\n  debug: false\n  save-user-cache-on-stop-only: false\n  bungeecord: false\nworld-settings:\n  default:\n    verbose: false\n    view-distance: default\n" },
    { name: "world_link", size: 0, modified: "2026-07-09T12:00:00Z", type: "symlink", content: "/world" },
  ],
  "/plugins": [
    { name: "Essentials", size: 0, modified: "2026-07-09T12:00:00Z", type: "dir" },
    { name: "LuckPerms", size: 0, modified: "2026-07-09T12:00:00Z", type: "dir" },
    { name: "EssentialsX.jar", size: 1258291, modified: "2026-07-05T15:20:00Z", type: "file" },
    { name: "LuckPerms.jar", size: 2451000, modified: "2026-07-05T15:21:00Z", type: "file" },
  ],
  "/plugins/Essentials": [
    { name: "config.yml", size: 4096, modified: "2026-07-09T12:00:00Z", type: "file", content: "# EssentialsX Configuration\n# If enabled, player commands are monitored.\nenabled: true\nlocale: en\nops-name-color: 'c'\nnickname-prefix: '~'\nmax-nick-length: 15\n" },
    { name: "userdata", size: 0, modified: "2026-07-09T12:00:00Z", type: "dir" },
  ],
  "/plugins/Essentials/userdata": [
    { name: "notch.yml", size: 256, modified: "2026-07-09T12:10:00Z", type: "file", content: "lastAccountName: Notch\nlogoutLocation:\n  world: survival_world\n  x: 104.5\n  y: 64.0\n  z: -250.3\n" },
  ],
  "/plugins/LuckPerms": [
    { name: "config.yml", size: 1024, modified: "2026-07-09T12:00:00Z", type: "file", content: "server: global\nstorage-method: h2\nsplit-storage:\n  enabled: false\n" },
  ],
  "/logs": [
    { name: "latest.log", size: 3072, modified: "2026-07-09T13:00:00Z", type: "file", content: "[13:00:01] [Server thread/INFO]: Starting minecraft server version 1.20.4\n[13:00:02] [Server thread/INFO]: Loading properties from server.properties\n[13:00:05] [Server thread/INFO]: Done (4.2s)! For help, type \"help\"\n" },
  ],
  "/world": [
    { name: "level.dat", size: 40960, modified: "2026-07-09T13:45:00Z", type: "file" },
    { name: "region", size: 0, modified: "2026-07-09T13:45:00Z", type: "dir" },
  ],
  "/world/region": [
    { name: "r.0.0.mca", size: 1048576, modified: "2026-07-09T13:45:00Z", type: "file" },
  ],
};

/**
 * List files and folders in a directory
 */
export async function listServerFiles(path: string = "/"): Promise<FileListResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(150);
    const norm = normalizePath(path);
    const entries = mockFilesystem[norm];
    if (!entries) {
      throw new Error(`Directory not found: ${path}`);
    }
    return {
      path: norm,
      entries: entries.map(e => ({
        name: e.name,
        size: e.size,
        modified: e.modified,
        type: e.type
      }))
    };
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to list files: status ${res.status}`);
  }
  return res.json();
}

/**
 * Read a file's content
 */
export async function getServerFileContent(path: string): Promise<FileContentResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(200);
    const norm = normalizePath(path);
    const idx = norm.lastIndexOf("/");
    const parent = normalizePath(idx === 0 ? "/" : norm.substring(0, idx));
    const filename = norm.substring(idx + 1);

    const folder = mockFilesystem[parent];
    const file = folder?.find(f => f.name.toLowerCase() === filename.toLowerCase());

    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    if (file.type === "dir") {
      throw new Error("Specified path is a directory.");
    }

    // Simulate binary file rejection
    const isBinary = filename.endsWith(".jar") || filename.endsWith(".dat") || filename.endsWith(".mca") || !file.content;
    if (isBinary) {
      throw new Error("Binary files are rejected.");
    }

    // Simulate 5MB limit rejection
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("File size exceeds 5MB limit.");
    }

    return {
      path: norm,
      size: file.size,
      content: file.content || ""
    };
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/files/content?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error("File exceeds 5MB limit.");
    }
    if (res.status === 400) {
      throw new Error("Cannot open this file (is a directory or binary file).");
    }
    throw new Error(`Failed to read file: status ${res.status}`);
  }
  return res.json();
}

/**
 * Create or overwrite a text file
 */
export async function writeServerFileContent(
  path: string,
  content: string,
  force: boolean = false
): Promise<FileWriteResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(200);
    const norm = normalizePath(path);
    const idx = norm.lastIndexOf("/");
    const parent = normalizePath(idx === 0 ? "/" : norm.substring(0, idx));
    const filename = norm.substring(idx + 1);

    if (!mockFilesystem[parent]) {
      mockFilesystem[parent] = [];
    }

    const folder = mockFilesystem[parent];
    const existingIdx = folder.findIndex(f => f.name.toLowerCase() === filename.toLowerCase());

    if (existingIdx !== -1 && !force) {
      throw new Error("File exists and overwrite was not forced.");
    }

    const newFile: MockFile = {
      name: filename,
      size: content.length,
      modified: new Date().toISOString(),
      type: "file",
      content
    };

    if (existingIdx !== -1) {
      folder[existingIdx] = newFile;
    } else {
      folder.push(newFile);
    }

    return { status: "ok", path: norm };
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/files/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, force })
  });

  if (!res.ok) {
    if (res.status === 409) {
      throw new Error("File exists. Set force=true to overwrite.");
    }
    throw new Error(`Failed to write file: status ${res.status}`);
  }

  return res.json();
}

/**
 * Upload a file using multipart form data with progress tracking
 */
export async function uploadServerFile(
  path: string,
  file: File,
  force: boolean = false,
  onProgress?: (pct: number) => void
): Promise<FileWriteResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    // Simulate uploading progress
    for (let pct = 0; pct <= 100; pct += 20) {
      onProgress?.(pct);
      await delay(100);
    }

    const norm = normalizePath(path);
    const idx = norm.lastIndexOf("/");
    const parent = normalizePath(idx === 0 ? "/" : norm.substring(0, idx));
    const filename = norm.substring(idx + 1);

    if (!mockFilesystem[parent]) {
      mockFilesystem[parent] = [];
    }

    const folder = mockFilesystem[parent];
    const existingIdx = folder.findIndex(f => f.name.toLowerCase() === filename.toLowerCase());

    if (existingIdx !== -1 && !force) {
      throw new Error("File exists and overwrite was not forced.");
    }

    const isText = file.type.startsWith("text/") || filename.endsWith(".properties") || filename.endsWith(".yml") || filename.endsWith(".json") || filename.endsWith(".txt");
    const newFile: MockFile = {
      name: filename,
      size: file.size,
      modified: new Date().toISOString(),
      type: "file",
      content: isText ? "Uploaded mock text file content" : undefined
    };

    if (existingIdx !== -1) {
      folder[existingIdx] = newFile;
    } else {
      folder.push(newFile);
    }

    return { status: "ok", path: norm };
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/api/files/upload`);

    if (onProgress && xhr.upload) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentage = Math.round((event.loaded * 100) / event.total);
          onProgress(percentage);
        }
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          resolve({ status: "ok", path });
        }
      } else {
        if (xhr.status === 409) {
          reject(new Error("File already exists. Force overwrite to replace it."));
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Network error during file upload."));

    const formData = new FormData();
    formData.append("path", path);
    formData.append("file", file);
    if (force) {
      formData.append("force", "true");
    }

    xhr.send(formData);
  });
}

