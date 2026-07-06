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
}

export interface ConsoleLog {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
}

export interface Player {
  id: string;
  username: string;
  online: boolean;
  ping: number;
  isOp: boolean;
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
  { id: "1", username: "Notch", online: true, ping: 14, isOp: true },
  { id: "2", username: "Jeb_", online: true, ping: 32, isOp: true },
  { id: "3", username: "Alex", online: true, ping: 68, isOp: false },
  { id: "4", username: "Steve", online: false, ping: 0, isOp: false },
  { id: "5", username: "Herobrine", online: false, ping: 0, isOp: false },
  { id: "6", username: "Grumm", online: false, ping: 0, isOp: false },
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

/**
 * Retrieves the current status, including CPU and RAM usage.
 * RAM usage varies slightly to simulate realistic telemetry.
 */
export async function getServerStatus(): Promise<ServerStatus> {
  // TODO: Query active system process or docker container resources
  await delay(100);

  let cpu = 0;
  let ramUsed = 0;

  if (serverState === "ONLINE") {
    // Generate minor variations
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
  };
}

/**
 * Returns console logs.
 */
export async function getConsoleLogs(): Promise<ConsoleLog[]> {
  // TODO: Read tail of server.log file
  await delay(100);
  return [...mockLogs];
}

/**
 * Executes a console command.
 */
export async function sendConsoleCommand(command: string): Promise<string> {
  // TODO: Connect via RCON and issue commands
  await delay(150);
  const cleanCmd = command.trim().replace(/^\//, "");
  const [baseCmd, ...args] = cleanCmd.split(" ");
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });

  if (serverState !== "ONLINE") {
    return "Error: Cannot execute command while server is offline.";
  }

  mockLogs.push({ timestamp, level: "INFO", message: `Console issued command: /${cleanCmd}` });

  let responseMessage = "";
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

  mockLogs.push({ timestamp, level: "INFO", message: responseMessage });
  return responseMessage;
}

/**
 * Returns player directory lists sorted by online state.
 */
export async function getServerPlayers(): Promise<Player[]> {
  // TODO: Fetch online players via Query API, offline players from User Cache
  await delay(100);
  // Sort: online first, then username alphabetically
  return [...mockPlayers].sort((a, b) => {
    if (a.online === b.online) return a.username.localeCompare(b.username);
    return a.online ? -1 : 1;
  });
}

/**
 * Performs administrative actions on players.
 */
export async function updatePlayerStatus(
  playerId: string,
  action: "kick" | "ban" | "unban" | "toggle_op"
): Promise<void> {
  // TODO: Translate actions to rcon commands (/kick, /ban, /op)
  await delay(150);
  const player = mockPlayers.find((p) => p.id === playerId);
  if (!player) return;

  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });

  if (action === "kick") {
    mockPlayers = mockPlayers.map((p) => p.id === playerId ? { ...p, online: false, ping: 0 } : p);
    mockLogs.push({ timestamp, level: "INFO", message: `Kicked ${player.username} from the server` });
  } else if (action === "ban") {
    mockPlayers = mockPlayers.map((p) => p.id === playerId ? { ...p, online: false, ping: 0 } : p);
    mockLogs.push({ timestamp, level: "INFO", message: `Banned player ${player.username}` });
  } else if (action === "toggle_op") {
    const nextOpState = !player.isOp;
    mockPlayers = mockPlayers.map((p) => p.id === playerId ? { ...p, isOp: nextOpState } : p);
    mockLogs.push({
      timestamp,
      level: "INFO",
      message: `${nextOpState ? "Promoted" : "Demoted"} ${player.username} ${nextOpState ? "to operator" : "from operator"}`
    });
  }
}

/**
 * Returns active whitelist.
 */
export async function getWhitelist(): Promise<WhitelistEntry[]> {
  // TODO: Read whitelist.json from Minecraft root directory
  await delay(100);
  return [...mockWhitelist];
}

/**
 * Adds player to whitelist.
 */
export async function addWhitelist(username: string): Promise<WhitelistEntry> {
  // TODO: Issue '/whitelist add' command or edit whitelist.json
  await delay(100);
  const cleanUser = username.trim();
  const exists = mockWhitelist.find((w) => w.username.toLowerCase() === cleanUser.toLowerCase());
  
  if (exists) {
    return exists;
  }

  const newEntry: WhitelistEntry = {
    id: `w${Date.now()}`,
    username: cleanUser,
    addedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
  mockWhitelist.push(newEntry);
  
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  mockLogs.push({ timestamp, level: "INFO", message: `Added ${cleanUser} to whitelist` });
  
  return newEntry;
}

/**
 * Removes player from whitelist.
 */
export async function removeWhitelist(entryId: string): Promise<void> {
  // TODO: Issue '/whitelist remove' or edit whitelist.json
  await delay(100);
  const entry = mockWhitelist.find((w) => w.id === entryId);
  if (!entry) return;

  mockWhitelist = mockWhitelist.filter((w) => w.id !== entryId);
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  mockLogs.push({ timestamp, level: "INFO", message: `Removed ${entry.username} from whitelist` });
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
  // TODO: Start screen session, docker run, or systemctl start service
  await delay(500);
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });

  if (action === "start") {
    serverState = "STARTING";
    startTime = Date.now();
    mockLogs.push({ timestamp, level: "INFO", message: "Server start triggered. Launching JVM..." });
    
    // Simulate server boot process finishing after 4 seconds
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
}
