export enum InstanceRole {
  SUPERUSER = "SUPERUSER",
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  USER = "USER",
}

// Alias for backwards compatibility
export const UserRole = InstanceRole;
export type UserRole = InstanceRole;

export function parseInstanceRole(roleStr?: string | null): InstanceRole {
  if (!roleStr) return InstanceRole.USER;
  const upper = roleStr.toUpperCase();
  if (upper === "SUPERUSER" || upper === "SUPERADMIN") return InstanceRole.SUPERUSER;
  if (upper === "OWNER") return InstanceRole.OWNER;
  if (upper === "ADMIN") return InstanceRole.ADMIN;
  return InstanceRole.USER;
}

export interface ServerPermissions {
  server_start: boolean;
  server_stop: boolean;
  server_restart: boolean;
  server_power?: boolean;
  logs_view: boolean;
  console_send: boolean;
  players_view: boolean;
  players_kick: boolean;
  players_ban: boolean;
  players_op: boolean;
  whitelist_view: boolean;
  whitelist_manage: boolean;
  files_read: boolean;
  files_edit: boolean;
  files_upload: boolean;
  files_delete: boolean;
  properties_view: boolean;
  properties_edit: boolean;
  members_manage: boolean;
}

export const ADMIN_PERMISSIONS: ServerPermissions = {
  server_start: true,
  server_stop: true,
  server_restart: true,
  logs_view: true,
  console_send: true,
  players_view: true,
  players_kick: true,
  players_ban: true,
  players_op: true,
  whitelist_view: true,
  whitelist_manage: true,
  files_read: true,
  files_edit: true,
  files_upload: true,
  files_delete: true,
  properties_view: true,
  properties_edit: true,
  members_manage: true,
};

export const MODERATOR_PERMISSIONS: ServerPermissions = {
  server_start: true,
  server_stop: true,
  server_restart: true,
  logs_view: true,
  console_send: true,
  players_view: true,
  players_kick: true,
  players_ban: true,
  players_op: false,
  whitelist_view: true,
  whitelist_manage: true,
  files_read: true,
  files_edit: false,
  files_upload: false,
  files_delete: false,
  properties_view: true,
  properties_edit: false,
  members_manage: false,
};

export const VIEWER_PERMISSIONS: ServerPermissions = {
  server_start: false,
  server_stop: false,
  server_restart: false,
  logs_view: true,
  console_send: false,
  players_view: true,
  players_kick: false,
  players_ban: false,
  players_op: false,
  whitelist_view: true,
  whitelist_manage: false,
  files_read: true,
  files_edit: false,
  files_upload: false,
  files_delete: false,
  properties_view: true,
  properties_edit: false,
  members_manage: false,
};

export const DEFAULT_PERMISSIONS: ServerPermissions = VIEWER_PERMISSIONS;

export interface PermissionDefinition {
  key: keyof ServerPermissions;
  label: string;
  description: string;
}

export interface PermissionCategory {
  id: string;
  name: string;
  description: string;
  permissions: PermissionDefinition[];
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: "server",
    name: "Server Operations",
    description: "Start, stop, and restart server instances",
    permissions: [
      { key: "server_start", label: "Start Server", description: "Launch and boot the Minecraft server" },
      { key: "server_stop", label: "Stop Server", description: "Safely shutdown or kill the Minecraft server" },
      { key: "server_restart", label: "Restart Server", description: "Reboot and restart the server instance" },
    ],
  },
  {
    id: "console",
    name: "Logs & Console",
    description: "Read terminal output and execute server commands",
    permissions: [
      { key: "logs_view", label: "View Logs", description: "Read live console logs and historical output" },
      { key: "console_send", label: "Send Commands", description: "Execute console and RCON commands" },
    ],
  },
  {
    id: "players",
    name: "Player Management",
    description: "Manage online and offline player accounts",
    permissions: [
      { key: "players_view", label: "View Players", description: "View online and known player roster" },
      { key: "players_kick", label: "Kick Players", description: "Disconnect connected players from the server" },
      { key: "players_ban", label: "Ban Players", description: "Ban and unban player accounts or IPs" },
      { key: "players_op", label: "Op Players", description: "Grant or revoke Minecraft operator status" },
    ],
  },
  {
    id: "whitelist",
    name: "Whitelist Controls",
    description: "Access and alter the server whitelist",
    permissions: [
      { key: "whitelist_view", label: "View Whitelist", description: "Inspect whitelisted user accounts" },
      { key: "whitelist_manage", label: "Manage Whitelist", description: "Add and remove accounts from whitelist" },
    ],
  },
  {
    id: "files",
    name: "File Manager",
    description: "Browse, modify, upload, and delete instance files",
    permissions: [
      { key: "files_read", label: "Read Files", description: "Browse directory tree and view file contents" },
      { key: "files_edit", label: "Edit Files", description: "Modify and save existing configuration and text files" },
      { key: "files_upload", label: "Upload Files", description: "Upload plugins, worlds, and configs" },
      { key: "files_delete", label: "Delete Files", description: "Delete files and directories permanently" },
    ],
  },
  {
    id: "properties",
    name: "Server Properties",
    description: "Inspect and modify server.properties configuration",
    permissions: [
      { key: "properties_view", label: "View Properties", description: "View server configuration values" },
      { key: "properties_edit", label: "Edit Properties", description: "Modify and save server.properties settings" },
    ],
  },
  {
    id: "members",
    name: "Team & Member Access",
    description: "Manage instance roster and permission assignments",
    permissions: [
      { key: "members_manage", label: "Manage Members", description: "Add members, adjust permissions, and remove members" },
    ],
  },
];

export const TOTAL_PERMISSIONS_COUNT = PERMISSION_CATEGORIES.reduce(
  (acc, cat) => acc + cat.permissions.length,
  0
);

export const PERMISSION_KEYS: (keyof ServerPermissions)[] = [
  "server_start",
  "server_stop",
  "server_restart",
  "logs_view",
  "console_send",
  "players_view",
  "players_kick",
  "players_ban",
  "players_op",
  "whitelist_view",
  "whitelist_manage",
  "files_read",
  "files_edit",
  "files_upload",
  "files_delete",
  "properties_view",
  "properties_edit",
  "members_manage",
];

export function arePermissionsEqual(a: ServerPermissions, b: ServerPermissions): boolean {
  return PERMISSION_KEYS.every((k) => Boolean(a[k]) === Boolean(b[k]));
}

export function detectPermissionPreset(perms: ServerPermissions): "admin" | "moderator" | "viewer" | "custom" {
  if (arePermissionsEqual(perms, ADMIN_PERMISSIONS)) return "admin";
  if (arePermissionsEqual(perms, MODERATOR_PERMISSIONS)) return "moderator";
  if (arePermissionsEqual(perms, VIEWER_PERMISSIONS)) return "viewer";
  return "custom";
}
