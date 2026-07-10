"use client";

import React, { createContext, useContext, useState, useEffect, useTransition, useRef } from "react";
import { UserRole } from "@/types/roles";
import {
  getServerStatus,
  getConsoleLogs,
  sendConsoleCommand,
  getServerPlayers,
  getWhitelist,
  addWhitelist,
  removeWhitelist,
  getPlugins,
  togglePluginState,
  toggleServerPower,
  updatePlayerStatus,
  ServerStatus,
  ConsoleLog,
  Player,
  WhitelistEntry,
  Plugin,
  CommandResponse,
} from "@/lib/mc-server";

interface DashboardContextType {
  userRole: UserRole;
  isDev: boolean;
  isPhysicalServerOnline: boolean;

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
  isPending: boolean;
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
  userRole,
  isDev,
}: {
  children: React.ReactNode;
  userRole: UserRole;
  isDev: boolean;
}) {
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
  const [isPending, startTransition] = useTransition();
  const [powerActionLoading, setPowerActionLoading] = useState<string | null>(null);
  const [whitelistLoading, setWhitelistLoading] = useState(false);
  const [actionPlayerId, setActionPlayerId] = useState<string | null>(null);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Initial Load
  useEffect(() => {
    async function loadData() {
      try {
        const [stat, initialLogs, initialPlayers, initialWhitelist, initialPlugins] = await Promise.all([
          getServerStatus(),
          getConsoleLogs(),
          getServerPlayers(),
          getWhitelist(),
          getPlugins(),
        ]);

        setStatus(stat);
        setLogs(initialLogs);
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
  }, []);

  // Periodic RAM and CPU Polling (2.5 seconds interval)
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const latestStatus = await getServerStatus();
        setStatus(latestStatus);

        if (latestStatus.isReachable === false) {
          consecutiveFailuresRef.current += 1;
          if (consecutiveFailuresRef.current >= 3) {
            setIsPhysicalServerOnline(false);
          }
        } else {
          consecutiveFailuresRef.current = 0;
          setIsPhysicalServerOnline(true);
        }
        
        const latestLogs = await getConsoleLogs();
        setLogs(latestLogs);
      } catch (err) {
        console.error("Polling error:", err);
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= 3) {
          setIsPhysicalServerOnline(false);
        }
      }
    }, 2500);

    return () => clearInterval(timer);
  }, []);

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
      // Optimistic state updates
      if (action === "start") {
        setStatus((prev) => prev ? { ...prev, status: "STARTING" } : null);
      } else if (action === "stop") {
        setStatus((prev) => prev ? { ...prev, status: "OFFLINE", cpu: 0, ramUsed: 0 } : null);
      } else if (action === "restart") {
        setStatus((prev) => prev ? { ...prev, status: "STARTING" } : null);
      }

      await toggleServerPower(action);
      
      // Post-transition reload
      const updatedStatus = await getServerStatus();
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

      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
      const updatedPlayers = await getServerPlayers();
      setPlayers(updatedPlayers);
    } catch (err) {
      console.error(`Failed to ${action} server:`, err);
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
      const res = await sendConsoleCommand(cmd);
      setLastCommandResponse(res);
      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
      const updatedPlayers = await getServerPlayers();
      setPlayers(updatedPlayers);
    } catch (err) {
      console.error("Failed to run console command:", err);
    }
  };

  // Whitelist Handlers
  const handleAddWhitelist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWhitelistName.trim()) return;

    setWhitelistLoading(true);
    try {
      await addWhitelist(newWhitelistName);
      setNewWhitelistName("");
      const updatedList = await getWhitelist();
      setWhitelist(updatedList);
      const updatedPlayers = await getServerPlayers();
      setPlayers(updatedPlayers);
      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
    } catch (err) {
      console.error("Failed to add to whitelist:", err);
    } finally {
      setWhitelistLoading(false);
    }
  };

  const handleRemoveWhitelist = async (id: string) => {
    try {
      await removeWhitelist(id);
      const updatedList = await getWhitelist();
      setWhitelist(updatedList);
      const updatedPlayers = await getServerPlayers();
      setPlayers(updatedPlayers);
      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
    } catch (err) {
      console.error("Failed to remove from whitelist:", err);
    }
  };

  // Plugin Handler
  const handleTogglePlugin = async (pluginId: string, enabled: boolean) => {
    setPlugins((prev) => prev.map((p) => p.id === pluginId ? { ...p, enabled } : p));
    try {
      await togglePluginState(pluginId, enabled);
      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
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
      await updatePlayerStatus(playerId, action);
      const updatedPlayers = await getServerPlayers();
      setPlayers(updatedPlayers);
      const updatedWhitelist = await getWhitelist();
      setWhitelist(updatedWhitelist);
      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
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
        userRole,
        isDev,
        status,
        isPhysicalServerOnline,
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
        isPending,
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
