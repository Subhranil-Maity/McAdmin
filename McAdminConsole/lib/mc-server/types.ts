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
