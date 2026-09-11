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
  isReachable?: boolean;
}

export interface ConsoleLog {
  index?: number;
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
}

export interface WsIndexedLog {
  index: number;
  line: string;
}

export interface WsStatusMetrics {
  id: string;
  name: string;
  status: ServerStatusState;
  server_port: number;
  rcon_port: number;
  cpu_usage: number;
  ram_allocated_mb: number;
  ram_used_mb: number;
  uptime_seconds: number;
  active_players: number;
  max_players: number;
  minecraft_version?: string | null;
  java_runtime?: string | null;
}

export type ServerWsMessage =
  | { type: "status"; data: WsStatusMetrics }
  | { type: "log_backlog"; data: { logs: WsIndexedLog[] } }
  | { type: "log"; data: WsIndexedLog }
  | { type: "log_clear" }
  | { type: "command_result"; data: { status: string; command: string; response: string } }
  | { type: "pong" };

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
