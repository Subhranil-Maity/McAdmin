"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { UserRole } from "@/types/roles";
import { useAuth } from "@/lib/auth/auth-context";
import { ServerPermissions, ADMIN_PERMISSIONS, VIEWER_PERMISSIONS } from "@/types/roles";
import {
  getServerStatus,
  sendConsoleCommand,
  getServerPlayers,
  getWhitelist,
  addWhitelist,
  removeWhitelist,
  getPlugins,
  togglePluginState,
  toggleServerPower,
  updatePlayerStatus,
  listInstances,
  getInstance,
  getMyInstancePermissions,
  getBackendWsUrl,
  parseLogLine,
  ServerStatus,
  ConsoleLog,
  Player,
  WhitelistEntry,
  Plugin,
  CommandResponse,
  InstanceSummary,
  InstanceDetail,
  ServerWsMessage,
} from "@/lib/mc-server";

interface DashboardContextType {
  instanceId?: string;
  instanceDetail: InstanceDetail | null;
  refreshInstanceDetail: () => Promise<void>;
  allInstances: InstanceSummary[];
  refreshAllInstances: () => Promise<void>;
  userRole: UserRole;
  isDev: boolean;
  isPhysicalServerOnline: boolean;
  isWsConnected: boolean;

  // Permissions
  permissions: ServerPermissions | null;
  refreshPermissions: () => Promise<void>;
  canStartServer: boolean;
  canStopServer: boolean;
  canRestartServer: boolean;
  canPowerServer: boolean;
  canViewLogs: boolean;
  canSendCommand: boolean;
  canViewPlayers: boolean;
  canKickPlayers: boolean;
  canBanPlayers: boolean;
  canOpPlayers: boolean;
  canViewWhitelist: boolean;
  canManageWhitelist: boolean;
  canReadFiles: boolean;
  canEditFiles: boolean;
  canUploadFiles: boolean;
  canDeleteFiles: boolean;
  canViewProperties: boolean;
  canEditProperties: boolean;
  canManageMembers: boolean;

  // Console Streaming States
  isConsoleActive: boolean;
  setConsoleActive: React.Dispatch<React.SetStateAction<boolean>>;
  isConsoleLogsLoading: boolean;

  // Server Data States
  status: ServerStatus | null;
  logs: ConsoleLog[];
  players: Player[];
  whitelist: WhitelistEntry[];
  plugins: Plugin[];

  // Interactivity States
  commandInput: string;
  setCommandInput: React.Dispatch<React.SetStateAction<string>>;
  newWhitelistName: string;
  setNewWhitelistName: React.Dispatch<React.SetStateAction<string>>;
  playerSearch: string;
  setPlayerSearch: React.Dispatch<React.SetStateAction<string>>;
  lastCommandResponse: CommandResponse | null;
  setLastCommandResponse: React.Dispatch<React.SetStateAction<CommandResponse | null>>;

  // Loaders
  powerActionLoading: string | null;
  whitelistLoading: boolean;
  actionPlayerId: string | null;

  // Console Ref
  consoleEndRef: React.RefObject<HTMLDivElement | null>;

  // Handlers
  handlePowerAction: (action: "start" | "stop" | "restart") => Promise<void>;
  handleSendCommand: (e: React.FormEvent) => Promise<void>;
  handleAddWhitelist: (e: React.FormEvent) => Promise<void>;
  handleRemoveWhitelist: (id: string) => Promise<void>;
  handleTogglePlugin: (pluginId: string, enabled: boolean) => Promise<void>;
  handlePlayerAction: (
    playerId: string,
    action: "kick" | "ban" | "unban" | "op" | "deop" | "whitelist" | "dewhitelist"
  ) => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({
  children,
  userRole: propUserRole,
  isDev = false,
  instanceId,
}: {
  children: React.ReactNode;
  userRole?: UserRole;
  isDev?: boolean;
  instanceId?: string;
}) {
  const { user } = useAuth();
  const [instanceDetail, setInstanceDetail] = useState<InstanceDetail | null>(null);
  const [allInstances, setAllInstances] = useState<InstanceSummary[]>([]);

  const effectiveRole: UserRole = user?.is_superuser
    ? UserRole.SUPERUSER
    : instanceDetail?.role?.toUpperCase() === "OWNER" ||
      (instanceDetail?.owner_id && user && instanceDetail.owner_id === user.id)
    ? UserRole.OWNER
    : instanceDetail?.role?.toUpperCase() === "ADMIN" ||
      (instanceDetail?.admins && user && instanceDetail.admins.includes(user.id))
    ? UserRole.ADMIN
    : propUserRole || UserRole.USER;

  // Permissions state
  const [permissions, setPermissions] = useState<ServerPermissions | null>(null);

  const refreshPermissions = async () => {
    if (!instanceId) return;
    try {
      const res = await getMyInstancePermissions(instanceId);
      if (res?.permissions) {
        setPermissions(res.permissions);
      }
    } catch (e) {
      console.warn("Failed to fetch instance permissions:", e);
    }
  };

  const isPrivileged = Boolean(
    user?.is_superuser ||
    effectiveRole === UserRole.OWNER ||
    effectiveRole === UserRole.SUPERUSER ||
    isDev
  );

  const fallbackPermissions: ServerPermissions = isPrivileged || effectiveRole === UserRole.ADMIN
    ? ADMIN_PERMISSIONS
    : VIEWER_PERMISSIONS;

  const currentPermissions: ServerPermissions = permissions || fallbackPermissions;

  const canStartServer = isPrivileged || Boolean(currentPermissions.server_start || currentPermissions.server_power);
  const canStopServer = isPrivileged || Boolean(currentPermissions.server_stop || currentPermissions.server_power);
  const canRestartServer = isPrivileged || Boolean(currentPermissions.server_restart || currentPermissions.server_power);
  const canPowerServer = canStartServer || canStopServer || canRestartServer;
  const canViewLogs = isPrivileged || Boolean(currentPermissions.logs_view);
  const canSendCommand = isPrivileged || Boolean(currentPermissions.console_send);
  const canViewPlayers = isPrivileged || Boolean(currentPermissions.players_view);
  const canKickPlayers = isPrivileged || Boolean(currentPermissions.players_kick);
  const canBanPlayers = isPrivileged || Boolean(currentPermissions.players_ban);
  const canOpPlayers = isPrivileged || Boolean(currentPermissions.players_op);
  const canViewWhitelist = isPrivileged || Boolean(currentPermissions.whitelist_view);
  const canManageWhitelist = isPrivileged || Boolean(currentPermissions.whitelist_manage);
  const canReadFiles = isPrivileged || Boolean(currentPermissions.files_read);
  const canEditFiles = isPrivileged || Boolean(currentPermissions.files_edit);
  const canUploadFiles = isPrivileged || Boolean(currentPermissions.files_upload);
  const canDeleteFiles = isPrivileged || Boolean(currentPermissions.files_delete);
  const canViewProperties = isPrivileged || Boolean(currentPermissions.properties_view);
  const canEditProperties = isPrivileged || Boolean(currentPermissions.properties_edit);
  const canManageMembers = isPrivileged || Boolean(currentPermissions.members_manage);

  // Server Data States
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [isPhysicalServerOnline, setIsPhysicalServerOnline] = useState(true);
  const consecutiveFailuresRef = useRef(0);
  const [logs, setLogs] = useState<ConsoleLog[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [plugins, setPlugins] = useState<Plugin[]>([]);

  // Interactivity States
  const [commandInput, setCommandInput] = useState("");
  const [newWhitelistName, setNewWhitelistName] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [lastCommandResponse, setLastCommandResponse] = useState<CommandResponse | null>(null);

  // Loaders
  const [powerActionLoading, setPowerActionLoading] = useState<string | null>(null);
  const [whitelistLoading, setWhitelistLoading] = useState(false);
  const [actionPlayerId, setActionPlayerId] = useState<string | null>(null);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  const refreshAllInstances = async () => {
    try {
      const list = await listInstances();
      setAllInstances(list);
    } catch (err) {
      console.error("Failed to refresh instances:", err);
    }
  };

  const refreshInstanceDetail = async () => {
    if (!instanceId) return;
    try {
      const detail = await getInstance(instanceId);
      setInstanceDetail(detail);
    } catch (e) {
      console.error("Failed to refresh instance detail:", e);
    }
  };

  const [isConsoleActive, setConsoleActive] = useState(false);
  const [isConsoleLogsLoading, setIsConsoleLogsLoading] = useState(false);
  const [isWsConnected, setIsWsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const lastSeenLogIndexRef = useRef<number>(-1);
  const isConsoleActiveRef = useRef<boolean>(false);
  isConsoleActiveRef.current = isConsoleActive;

  // Real-time WebSocket connection replacing HTTP polling
  useEffect(() => {
    if (!instanceId) return;

    let isMounted = true;

    function connectWs() {
      if (!isMounted) return;

      const wsUrl = getBackendWsUrl(`/api/instances/${encodeURIComponent(instanceId!)}/ws`);
      if (!wsUrl) return;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) {
            ws.close();
            return;
          }
          setIsWsConnected(true);
          reconnectAttemptRef.current = 0;
          setIsPhysicalServerOnline(true);
          consecutiveFailuresRef.current = 0;

          // If console is active when WS connects, subscribe immediately
          if (isConsoleActiveRef.current) {
            setIsConsoleLogsLoading(true);
            ws.send(JSON.stringify({ type: "subscribe_logs" }));
          }
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const msg: ServerWsMessage = JSON.parse(event.data);
            switch (msg.type) {
              case "status": {
                const data = msg.data;
                setStatus((prev) => ({
                  status: data.status,
                  cpu: typeof data.cpu_usage === "number" ? parseFloat(data.cpu_usage.toFixed(2)) : 0,
                  ramMax: typeof data.ram_allocated_mb === "number" ? parseFloat((data.ram_allocated_mb / 1024).toFixed(2)) : 8.0,
                  ramUsed: typeof data.ram_used_mb === "number" ? parseFloat((data.ram_used_mb / 1024).toFixed(2)) : 0,
                  uptime: data.uptime_seconds || 0,
                  version: data.minecraft_version || "Minecraft",
                  ipAddress: prev?.ipAddress || "127.0.0.1",
                  port: data.server_port || 25565,
                  activePlayers: data.active_players || 0,
                  maxPlayers: data.max_players || 20,
                  isReachable: true,
                }));
                setIsPhysicalServerOnline(true);
                consecutiveFailuresRef.current = 0;
                break;
              }
              case "log_backlog": {
                const parsed = msg.data.logs.map((item) => parseLogLine(item.line, item.index));
                if (msg.data.logs.length > 0) {
                  const maxIdx = msg.data.logs[msg.data.logs.length - 1].index;
                  lastSeenLogIndexRef.current = maxIdx;
                }
                setLogs(parsed);
                setIsConsoleLogsLoading(false);
                break;
              }
              case "log": {
                const item = msg.data;
                if (item.index > lastSeenLogIndexRef.current) {
                  lastSeenLogIndexRef.current = item.index;
                  const parsed = parseLogLine(item.line, item.index);
                  setLogs((prev) => {
                    const next = [...prev, parsed];
                    return next.length > 15000 ? next.slice(-15000) : next;
                  });
                }
                break;
              }
              case "log_clear": {
                lastSeenLogIndexRef.current = -1;
                setLogs([]);
                break;
              }
            }
          } catch (e) {
            console.error("Error parsing WS message:", e);
          }
        };

        ws.onclose = () => {
          if (!isMounted) return;
          setIsWsConnected(false);
          wsRef.current = null;

          // Reconnect with exponential backoff: 1s, 2s, 4s, up to 10s
          const delayMs = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
          reconnectAttemptRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMounted) connectWs();
          }, delayMs);
        };

        ws.onerror = (e) => {
          console.error("WebSocket error:", e);
          ws.close();
        };
      } catch (err) {
        console.error("Failed to establish WebSocket:", err);
      }
    }

    connectWs();

    return () => {
      isMounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [instanceId]);

  // Handle active console subscription changes (only stream logs when console is active)
  useEffect(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (isConsoleActive) {
      setIsConsoleLogsLoading(true);
      wsRef.current.send(JSON.stringify({ type: "subscribe_logs" }));
    } else {
      wsRef.current.send(JSON.stringify({ type: "unsubscribe_logs" }));
    }
  }, [isConsoleActive]);

  // Initial Load (static and slow-changing data)
  useEffect(() => {
    async function loadData() {
      try {
        refreshAllInstances();

        if (instanceId) {
          getInstance(instanceId).then(setInstanceDetail).catch(console.error);
          refreshPermissions();
        }

        const [stat, initialPlayers, initialWhitelist, initialPlugins] =
          await Promise.all([
            getServerStatus(instanceId),
            getServerPlayers(instanceId),
            getWhitelist(instanceId),
            getPlugins(),
          ]);

        setStatus(stat);
        setPlayers(initialPlayers);
        setWhitelist(initialWhitelist);
        setPlugins(initialPlugins);

        if (stat.isReachable === false) {
          consecutiveFailuresRef.current = 3;
          setIsPhysicalServerOnline(false);
        } else {
          consecutiveFailuresRef.current = 0;
          setIsPhysicalServerOnline(true);
        }
      } catch (err) {
        console.error("Failed to load server data:", err);
        consecutiveFailuresRef.current = 3;
        setIsPhysicalServerOnline(false);
      }
    }
    loadData();
  }, [instanceId]);

  // Power Actions Handler
  const handlePowerAction = async (action: "start" | "stop" | "restart") => {
    if (action === "stop" || action === "restart") {
      const confirmAction = window.confirm(
        `Are you sure you want to ${action === "stop" ? "stop" : "restart"} the server? This will disconnect all online players.`
      );
      if (!confirmAction) return;
    }

    setPowerActionLoading(action);
    try {
      if (action === "start") {
        setStatus((prev) => (prev ? { ...prev, status: "STARTING" } : null));
      } else if (action === "stop") {
        setStatus((prev) => (prev ? { ...prev, status: "OFFLINE", cpu: 0, ramUsed: 0 } : null));
      } else if (action === "restart") {
        setStatus((prev) => (prev ? { ...prev, status: "STARTING" } : null));
      }

      await toggleServerPower(action, instanceId);

      const updatedStatus = await getServerStatus(instanceId);
      setStatus(updatedStatus);

      if (updatedStatus.isReachable === false) {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= 3) {
          setIsPhysicalServerOnline(false);
        }
      } else {
        consecutiveFailuresRef.current = 0;
        setIsPhysicalServerOnline(true);
      }

      const updatedPlayers = await getServerPlayers(instanceId);
      setPlayers(updatedPlayers);
      refreshAllInstances();
    } catch (err) {
      console.error(`Failed to ${action} server:`, err);
      alert(`Server power action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPowerActionLoading(null);
    }
  };

  // Run Command Handler
  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;

    const cmd = commandInput;
    setCommandInput("");
    try {
      const res = await sendConsoleCommand(cmd, instanceId);
      setLastCommandResponse(res);
      const updatedPlayers = await getServerPlayers(instanceId);
      setPlayers(updatedPlayers);
    } catch (err) {
      console.error("Failed to run console command:", err);
      setLastCommandResponse({
        command: cmd,
        response: `Error: ${err instanceof Error ? err.message : String(err)}`,
        status: "error",
      });
    }
  };

  // Whitelist Handlers
  const handleAddWhitelist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWhitelistName.trim()) return;

    setWhitelistLoading(true);
    try {
      await addWhitelist(newWhitelistName, instanceId);
      setNewWhitelistName("");
      const updatedList = await getWhitelist(instanceId);
      setWhitelist(updatedList);
      const updatedPlayers = await getServerPlayers(instanceId);
      setPlayers(updatedPlayers);
    } catch (err) {
      console.error("Failed to add to whitelist:", err);
      alert(`Failed to add to whitelist: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWhitelistLoading(false);
    }
  };

  const handleRemoveWhitelist = async (id: string) => {
    try {
      await removeWhitelist(id, instanceId);
      const updatedList = await getWhitelist(instanceId);
      setWhitelist(updatedList);
      const updatedPlayers = await getServerPlayers(instanceId);
      setPlayers(updatedPlayers);
    } catch (err) {
      console.error("Failed to remove from whitelist:", err);
      alert(`Failed to remove from whitelist: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Plugin Handler
  const handleTogglePlugin = async (pluginId: string, enabled: boolean) => {
    setPlugins((prev) => prev.map((p) => (p.id === pluginId ? { ...p, enabled } : p)));
    try {
      await togglePluginState(pluginId, enabled);
    } catch (err) {
      console.error("Failed to toggle plugin:", err);
    }
  };

  // Player Actions Handler
  const handlePlayerAction = async (
    playerId: string,
    action: "kick" | "ban" | "unban" | "op" | "deop" | "whitelist" | "dewhitelist"
  ) => {
    setActionPlayerId(playerId);
    try {
      await updatePlayerStatus(playerId, action, instanceId);
      const updatedPlayers = await getServerPlayers(instanceId);
      setPlayers(updatedPlayers);
      const updatedWhitelist = await getWhitelist(instanceId);
      setWhitelist(updatedWhitelist);
    } catch (err) {
      console.error(`Failed player action ${action}:`, err);
      alert(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionPlayerId(null);
    }
  };

  return (
    <DashboardContext.Provider
      value={{
        instanceId,
        instanceDetail,
        refreshInstanceDetail,
        allInstances,
        refreshAllInstances,
        userRole: effectiveRole,
        isDev,
        permissions: currentPermissions,
        refreshPermissions,
        canStartServer,
        canStopServer,
        canRestartServer,
        canPowerServer,
        canViewLogs,
        canSendCommand,
        canViewPlayers,
        canKickPlayers,
        canBanPlayers,
        canOpPlayers,
        canViewWhitelist,
        canManageWhitelist,
        canReadFiles,
        canEditFiles,
        canUploadFiles,
        canDeleteFiles,
        canViewProperties,
        canEditProperties,
        canManageMembers,
        status,
        isPhysicalServerOnline,
        isWsConnected,
        isConsoleActive,
        setConsoleActive,
        isConsoleLogsLoading,
        logs,
        players,
        whitelist,
        plugins,
        commandInput,
        setCommandInput,
        newWhitelistName,
        setNewWhitelistName,
        playerSearch,
        setPlayerSearch,
        lastCommandResponse,
        setLastCommandResponse,
        powerActionLoading,
        whitelistLoading,
        actionPlayerId,
        consoleEndRef,
        handlePowerAction,
        handleSendCommand,
        handleAddWhitelist,
        handleRemoveWhitelist,
        handleTogglePlugin,
        handlePlayerAction,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }
  return context;
}
