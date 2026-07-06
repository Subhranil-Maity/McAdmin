"use client";

import React, { useState, useEffect, useTransition, useRef } from "react";
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
  getServerProperties,
  updateServerProperty,
  toggleServerPower,
  updatePlayerStatus,
  ServerStatus,
  ConsoleLog,
  Player,
  WhitelistEntry,
  Plugin,
  ServerProperty,
} from "@/lib/mc-server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  RotateCw,
  Terminal,
  Users,
  Settings,
  Shield,
  Activity,
  UserCheck,
  FileText,
  Search,
  Plus,
  Trash2,
  Lock,
  Loader2,
  Wifi,
  Cpu,
  Database,
  ArrowRight,
} from "lucide-react";

interface MCDashboardProps {
  userRole: UserRole;
  isDev: boolean;
}

export default function MCDashboard({ userRole, isDev }: MCDashboardProps) {
  const isAdmin = userRole === UserRole.OWNER || userRole === UserRole.ADMIN || isDev;

  // Server Data States
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [logs, setLogs] = useState<ConsoleLog[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [properties, setProperties] = useState<ServerProperty[]>([]);

  // Interactivity States
  const [commandInput, setCommandInput] = useState("");
  const [newWhitelistName, setNewWhitelistName] = useState("");
  const [propertySearch, setPropertySearch] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

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
        const [stat, initialLogs, initialPlayers, initialWhitelist, initialPlugins, initialProps] = await Promise.all([
          getServerStatus(),
          getConsoleLogs(),
          getServerPlayers(),
          getWhitelist(),
          getPlugins(),
          getServerProperties(),
        ]);

        setStatus(stat);
        setLogs(initialLogs);
        setPlayers(initialPlayers);
        setWhitelist(initialWhitelist);
        setPlugins(initialPlugins);
        setProperties(initialProps);
      } catch (err) {
        console.error("Failed to load server data:", err);
      }
    }
    loadData();
  }, []);

  // Periodic RAM and CPU Polling (2.5 seconds interval)
  // TODO: Replace with WebSocket subscriptions or server-sent events (SSE)
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const latestStatus = await getServerStatus();
        setStatus(latestStatus);
        
        // Polling logs too so command inputs update the screen
        const latestLogs = await getConsoleLogs();
        setLogs(latestLogs);
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2500);

    return () => clearInterval(timer);
  }, []);

  // Auto Scroll Console Terminal to bottom
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Power Actions Handler
  const handlePowerAction = async (action: "start" | "stop" | "restart") => {
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
      await sendConsoleCommand(cmd);
      // Fetch latest logs and players in case metadata changed
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
      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
    } catch (err) {
      console.error("Failed to remove from whitelist:", err);
    }
  };

  // Plugin Handler
  const handleTogglePlugin = async (pluginId: string, enabled: boolean) => {
    // Optimistic toggle
    setPlugins((prev) => prev.map((p) => p.id === pluginId ? { ...p, enabled } : p));
    try {
      await togglePluginState(pluginId, enabled);
      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
    } catch (err) {
      console.error("Failed to toggle plugin:", err);
    }
  };

  // Property Handler
  const handlePropertyChange = async (name: string, value: string) => {
    setProperties((prev) => prev.map((p) => p.name === name ? { ...p, value } : p));
    try {
      await updateServerProperty(name, value);
      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
    } catch (err) {
      console.error("Failed to update property:", err);
    }
  };

  // Player Actions Handler
  const handlePlayerAction = async (playerId: string, action: "kick" | "ban" | "toggle_op") => {
    setActionPlayerId(playerId);
    try {
      await updatePlayerStatus(playerId, action);
      const updatedPlayers = await getServerPlayers();
      setPlayers(updatedPlayers);
      const updatedLogs = await getConsoleLogs();
      setLogs(updatedLogs);
    } catch (err) {
      console.error(`Failed player action ${action}:`, err);
    } finally {
      setActionPlayerId(null);
    }
  };

  // Filter players list
  const filteredPlayers = players.filter(
    (p) =>
      p.username.toLowerCase().includes(playerSearch.toLowerCase()) ||
      (p.isOp && playerSearch.toLowerCase() === "op")
  );

  // Filter properties list
  const filteredProperties = properties.filter(
    (p) =>
      p.name.toLowerCase().includes(propertySearch.toLowerCase()) ||
      p.description.toLowerCase().includes(propertySearch.toLowerCase()) ||
      p.category.toLowerCase().includes(propertySearch.toLowerCase())
  );

  // Server status badge styling
  const statusBadges = {
    ONLINE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]",
    OFFLINE: "bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.15)]",
    STARTING: "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.15)] animate-pulse",
  };

  // General server state loading check
  const isServerStarting = status?.status === "STARTING";
  const isServerOnline = status?.status === "ONLINE";
  const isServerOffline = status?.status === "OFFLINE";

  // Render Restricted Normal User Dashboard
  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto space-y-8 mt-6">
        
        {/* Server Status Header Card */}
        <Card className="border-zinc-800 bg-zinc-900/30 backdrop-blur-md relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-zinc-700 via-zinc-500 to-zinc-700" />
          
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl font-extrabold text-zinc-100 uppercase tracking-wider">
              Server Portal
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              Basic control console for normal user accounts
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col items-center justify-center py-8 space-y-6">
            
            {/* Status Display Circle */}
            <div className="relative">
              <div
                className={`w-28 h-28 rounded-full border flex flex-col items-center justify-center transition-all duration-500 ${
                  isServerOnline
                    ? "bg-emerald-500/5 border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.2)]"
                    : isServerOffline
                    ? "bg-rose-500/5 border-rose-500/20 shadow-[0_0_30px_rgba(244,63,94,0.2)]"
                    : "bg-amber-500/5 border-amber-500/20 shadow-[0_0_30px_rgba(245,158,11,0.2)]"
                }`}
              >
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">Status</span>
                <span
                  className={`text-sm font-black mt-1 ${
                    isServerOnline
                      ? "text-emerald-400"
                      : isServerOffline
                      ? "text-rose-400"
                      : "text-amber-400 animate-pulse"
                  }`}
                >
                  {status?.status || "LOADING"}
                </span>
                {isServerStarting && (
                  <Loader2 className="w-4 h-4 text-amber-400 animate-spin mt-1.5" />
                )}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-8 text-center w-full max-w-xs pt-2">
              <div>
                <span className="text-[10px] text-zinc-500 uppercase font-mono">IP ADDRESS</span>
                <p className="text-xs text-zinc-300 font-semibold mt-0.5">{status?.ipAddress || "—"}</p>
              </div>
              <div>
                <span className="text-[10px] text-zinc-500 uppercase font-mono">PORT</span>
                <p className="text-xs text-zinc-300 font-semibold mt-0.5">{status?.port || "—"}</p>
              </div>
            </div>

            {/* Control Button */}
            <div className="w-full px-6 pt-4">
              {isServerOffline ? (
                <Button
                  onClick={() => handlePowerAction("start")}
                  disabled={powerActionLoading !== null}
                  className="w-full py-6 rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 transition-all font-bold flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_20px_rgba(16,185,129,0.15)] active:scale-[0.98]"
                >
                  {powerActionLoading === "start" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                  Start Server
                </Button>
              ) : (
                <Button
                  disabled
                  className="w-full py-6 rounded-xl bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed font-semibold flex items-center justify-center gap-2"
                >
                  {isServerStarting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Starting Server...
                    </>
                  ) : (
                    <>
                      <Wifi className="w-4 h-4" />
                      Server is Running
                    </>
                  )}
                </Button>
              )}
            </div>

          </CardContent>
        </Card>

        {/* Locked Feature warning */}
        <Card className="border-zinc-800 bg-zinc-900/10">
          <CardHeader className="flex flex-row items-center gap-4 pb-3">
            <div className="p-2 rounded-lg bg-zinc-800 text-zinc-400 border border-zinc-700">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-white">Administrator Restricted</CardTitle>
              <CardDescription className="text-xs text-zinc-500 mt-0.5">
                Role: NORMUSER (Restricted Console Access)
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Your account role allows you to view the server's current power state and boot the server up if it has crashed/gone offline.
              Detailed controls like console command execution, player kicking/banning, whitelist adjustments, and settings adjustments are locked to <strong className="text-purple-400">ADMIN</strong> or <strong className="text-amber-400">OWNER</strong> roles.
            </p>
          </CardContent>
        </Card>

      </div>
    );
  }

  // Render Full Admin Dashboard
  return (
    <div className="space-y-6">
      
      {/* Top Banner with Server Status and power controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 items-center justify-between gap-6 p-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-md">
        
        {/* Title and Uptime */}
        <div className="space-y-1">
          <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            Console Panel
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-full font-bold">
              {status?.version || "Loading"}
            </span>
          </h2>
          <p className="text-xs text-zinc-400">
            {status?.status === "ONLINE"
              ? `Uptime: ${Math.floor(status.uptime / 60)}m ${status.uptime % 60}s`
              : status?.status === "STARTING"
              ? "Loading Minecraft server modules..."
              : "Server is offline"}
          </p>
        </div>

        {/* Status Indicator */}
        <div className="flex justify-center">
          <div className={`px-4 py-2 rounded-full border text-xs font-bold uppercase tracking-wider ${statusBadges[status?.status || "OFFLINE"]}`}>
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isServerOnline ? "bg-emerald-400 shadow-[0_0_8px_#10b981]" : isServerOffline ? "bg-rose-400 shadow-[0_0_8px_#f43f5e]" : "bg-amber-400 animate-ping"}`} />
              {status?.status || "LOADING"}
            </span>
          </div>
        </div>

        {/* Quick Power Actions */}
        <div className="flex items-center justify-end gap-3">
          {/* Start Button */}
          <Button
            onClick={() => handlePowerAction("start")}
            disabled={!isServerOffline || powerActionLoading !== null}
            className="flex-1 sm:flex-initial h-10 px-4 rounded-xl text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            {powerActionLoading === "start" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current mr-1.5" />
            )}
            Start
          </Button>

          {/* Stop Button */}
          <Button
            onClick={() => handlePowerAction("stop")}
            disabled={isServerOffline || powerActionLoading !== null}
            className="flex-1 sm:flex-initial h-10 px-4 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:border-rose-500/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            {powerActionLoading === "stop" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Square className="w-3.5 h-3.5 fill-current mr-1.5" />
            )}
            Stop
          </Button>

          {/* Restart Button */}
          <Button
            onClick={() => handlePowerAction("restart")}
            disabled={isServerOffline || powerActionLoading !== null}
            className="flex-1 sm:flex-initial h-10 px-4 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 hover:border-amber-500/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            {powerActionLoading === "restart" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            Restart
          </Button>
        </div>

      </div>

      {/* Main Tabs Container */}
      <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="flex flex-col md:flex-row gap-6 items-stretch">
        <div className="w-full md:w-52 shrink-0 flex flex-col">
          <TabsList className="bg-zinc-900 border border-zinc-800 p-1.5 flex flex-row md:flex-col items-stretch justify-start w-full h-full min-h-[50px] md:min-h-[550px] gap-1.5 rounded-xl">
            <TabsTrigger value="overview" className="flex items-center gap-2 justify-start px-3 py-2 text-left w-full h-9">
              <Activity className="w-4 h-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="console" className="flex items-center gap-2 justify-start px-3 py-2 text-left w-full h-9">
              <Terminal className="w-4 h-4" /> Console
            </TabsTrigger>
            <TabsTrigger value="players" className="flex items-center gap-2 justify-start px-3 py-2 text-left w-full h-9">
              <Users className="w-4 h-4" /> Players
            </TabsTrigger>
            <TabsTrigger value="whitelist" className="flex items-center gap-2 justify-start px-3 py-2 text-left w-full h-9">
              <UserCheck className="w-4 h-4" /> Whitelist
            </TabsTrigger>
            <TabsTrigger value="plugins" className="flex items-center gap-2 justify-start px-3 py-2 text-left w-full h-9">
              <Settings className="w-4 h-4" /> Plugins
            </TabsTrigger>
            <TabsTrigger value="properties" className="flex items-center gap-2 justify-start px-3 py-2 text-left w-full h-9">
              <FileText className="w-4 h-4" /> Properties
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 w-full">

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* CPU Monitor */}
            <Card className="border-zinc-800 bg-zinc-900/30 backdrop-blur-md">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-white">CPU Utilisation</CardTitle>
                  <CardDescription className="text-xs text-zinc-500">Processing load</CardDescription>
                </div>
                <Cpu className="w-5 h-5 text-emerald-400" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-white">{status?.cpu || 0}%</span>
                  <span className="text-xs text-zinc-500">allocated cores</span>
                </div>
                <Progress value={status?.cpu || 0} max={100} className="h-2 bg-zinc-800 [&>div]:bg-emerald-500 [&>div]:shadow-[0_0_10px_#10b981]" />
              </CardContent>
            </Card>

            {/* RAM Monitor */}
            <Card className="border-zinc-800 bg-zinc-900/30 backdrop-blur-md">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-white">Memory Allocation</CardTitle>
                  <CardDescription className="text-xs text-zinc-500">
                    {/* TODO: Implement real-time gc calls or monitoring */}
                    RAM usage telemetry
                  </CardDescription>
                </div>
                <Activity className="w-5 h-5 text-purple-400" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-white">{status?.ramUsed || 0} GB</span>
                  <span className="text-xs text-zinc-500">/ {status?.ramMax || 8} GB</span>
                </div>
                <Progress value={status?.ramUsed || 0} max={status?.ramMax || 8} className="h-2 bg-zinc-800 [&>div]:bg-purple-500 [&>div]:shadow-[0_0_10px_#a855f7]" />
              </CardContent>
            </Card>

            {/* Storage Monitor */}
            <Card className="border-zinc-800 bg-zinc-900/30 backdrop-blur-md">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-white">Disk Storage</CardTitle>
                  <CardDescription className="text-xs text-zinc-500">Server files size</CardDescription>
                </div>
                <Database className="w-5 h-5 text-sky-400" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-white">2.34 GB</span>
                  <span className="text-xs text-zinc-500">/ 25 GB</span>
                </div>
                <Progress value={2.34} max={25} className="h-2 bg-zinc-800 [&>div]:bg-sky-400 [&>div]:shadow-[0_0_10px_#38bdf8]" />
              </CardContent>
            </Card>

          </div>

          {/* Quick info cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-zinc-800 bg-zinc-900/20 p-6 flex flex-col justify-between">
              <div className="space-y-2">
                <h3 className="font-bold text-white text-lg">Server Details</h3>
                <div className="grid grid-cols-2 gap-4 text-xs font-mono text-zinc-400 pt-2">
                  <div>IP Address: <span className="text-zinc-200">{status?.ipAddress}</span></div>
                  <div>Server Port: <span className="text-zinc-200">{status?.port}</span></div>
                  <div>Engine: <span className="text-zinc-200">{status?.version}</span></div>
                  <div>Uptime: <span className="text-zinc-200">{status ? `${Math.floor(status.uptime / 60)} min` : "—"}</span></div>
                </div>
              </div>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900/20 p-6 flex flex-col justify-between">
              <div className="space-y-2">
                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                  <Shield className="w-5 h-5 text-amber-500" /> Administrative Access
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  You are logged in with the <strong className="text-white uppercase">{userRole}</strong> role.
                  You have full operations and management permissions in this panel.
                </p>
              </div>
              <div className="pt-2 text-[10px] text-zinc-500 uppercase font-mono tracking-wider">
                Access Level &bull; {userRole}
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* CONSOLE TAB */}
        <TabsContent value="console" className="space-y-4 mt-4">
          <Card className="border-zinc-850 bg-zinc-950 p-4 rounded-2xl flex flex-col shadow-2xl">
            {/* Terminal Window Output */}
            <div className="h-96 overflow-y-auto font-mono text-xs text-zinc-300 space-y-1.5 p-4 rounded-xl bg-black border border-zinc-900 scrollbar-thin scrollbar-thumb-zinc-800">
              {logs.map((log, index) => {
                const isError = log.level === "ERROR";
                const isWarn = log.level === "WARN";
                const levelColor = isError ? "text-rose-500" : isWarn ? "text-amber-500" : "text-emerald-500";
                
                return (
                  <div key={index} className="leading-5">
                    <span className="text-zinc-600">[{log.timestamp}]</span>{" "}
                    <span className={`font-semibold ${levelColor}`}>[{log.level}]</span>:{" "}
                    <span>{log.message}</span>
                  </div>
                );
              })}
              <div ref={consoleEndRef} />
            </div>

            {/* Terminal Command Input Form */}
            <form onSubmit={handleSendCommand} className="flex gap-3 mt-4">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 font-mono text-sm">&gt;</span>
                <Input
                  type="text"
                  placeholder="Type a server command (e.g. /say Hello, /whitelist add Notch)..."
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  className="pl-7 bg-black border-zinc-850 rounded-xl text-zinc-200 placeholder-zinc-600 font-mono text-xs h-11 focus-visible:ring-zinc-800 focus-visible:border-zinc-800"
                />
              </div>
              <Button
                type="submit"
                className="px-5 rounded-xl text-xs font-semibold bg-white text-black hover:bg-zinc-200 transition-colors h-11 cursor-pointer"
              >
                Send
              </Button>
            </form>
          </Card>
        </TabsContent>

        {/* PLAYERS TAB */}
        <TabsContent value="players" className="space-y-4 mt-4">
          {/* Filters */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              type="text"
              placeholder="Search players by name, or type 'op' to filter Operators..."
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              className="pl-10 py-5 bg-zinc-900/30 border-zinc-850 rounded-xl text-sm placeholder-zinc-500 text-zinc-200 focus-visible:ring-zinc-700"
            />
          </div>

          {/* Players Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredPlayers.length > 0 ? (
              filteredPlayers.map((player) => (
                <Card
                  key={player.id}
                  className="border-zinc-850 bg-zinc-900/20 hover:border-zinc-800 transition-all p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    {/* Head / Avatar placeholder */}
                    <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center font-bold text-zinc-400">
                      {player.username[0].toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm flex items-center gap-1.5">
                        {player.username}
                        {player.isOp && (
                          <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-semibold border-amber-500/20 bg-amber-500/5 text-amber-400 py-0 px-1">
                            OP
                          </Badge>
                        )}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${player.online ? "bg-emerald-400" : "bg-zinc-600"}`} />
                        <span className="text-[10px] text-zinc-500 font-medium">
                          {player.online ? `Online (${player.ping}ms)` : "Offline"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions buttons */}
                  {player.online ? (
                    <div className="flex gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handlePlayerAction(player.id, "toggle_op")}
                        disabled={actionPlayerId === player.id}
                        className="text-[10px] border border-zinc-800 hover:bg-zinc-800/50 text-zinc-300 rounded px-2 py-1 cursor-pointer"
                      >
                        {player.isOp ? "De-Op" : "Op"}
                      </Button>
                      <Button
                        size="xs"
                        variant="destructive"
                        onClick={() => handlePlayerAction(player.id, "kick")}
                        disabled={actionPlayerId === player.id}
                        className="text-[10px] rounded px-2 py-1 cursor-pointer"
                      >
                        Kick
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handlePlayerAction(player.id, "toggle_op")}
                        disabled={actionPlayerId === player.id}
                        className="text-[10px] border border-zinc-800 hover:bg-zinc-800/50 text-zinc-300 rounded px-2 py-1 cursor-pointer"
                      >
                        {player.isOp ? "De-Op" : "Op"}
                      </Button>
                    </div>
                  )}
                </Card>
              ))
            ) : (
              <div className="col-span-full text-center py-12 border border-dashed border-zinc-850 rounded-2xl bg-zinc-900/5">
                <Users className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                <h4 className="font-semibold text-zinc-400 text-sm">No players found</h4>
              </div>
            )}
          </div>
        </TabsContent>

        {/* WHITELIST TAB */}
        <TabsContent value="whitelist" className="space-y-4 mt-4">
          <Card className="border-zinc-850 bg-zinc-900/10 p-5 rounded-2xl space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-white text-base">Server Whitelist</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  When enabled, only whitelisted accounts can connect to this Minecraft server.
                </p>
              </div>
              
              {/* Add form */}
              <form onSubmit={handleAddWhitelist} className="flex gap-2 max-w-sm w-full">
                <Input
                  type="text"
                  placeholder="Minecraft Username..."
                  value={newWhitelistName}
                  onChange={(e) => setNewWhitelistName(e.target.value)}
                  className="bg-black border-zinc-850 rounded-xl text-xs focus-visible:ring-zinc-800 h-9"
                />
                <Button
                  type="submit"
                  disabled={whitelistLoading}
                  className="px-3 rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors text-xs font-semibold h-9 flex items-center gap-1 cursor-pointer"
                >
                  {whitelistLoading ? <Loader2 className="w-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add
                </Button>
              </form>
            </div>

            {/* List */}
            <div className="divide-y divide-zinc-800/40 border border-zinc-850 rounded-xl overflow-hidden bg-black">
              {whitelist.length > 0 ? (
                whitelist.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded bg-zinc-950 border border-zinc-850 flex items-center justify-center font-bold text-xs text-zinc-500">
                        {entry.username[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{entry.username}</p>
                        <p className="text-[10px] text-zinc-500 font-mono">Added: {entry.addedAt}</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleRemoveWhitelist(entry.id)}
                      className="p-2 h-8 w-8 rounded-lg bg-zinc-900 hover:bg-rose-950/20 hover:text-rose-400 border border-zinc-850 text-zinc-400 hover:border-rose-900/40 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-center py-10">
                  <UserCheck className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500">Whitelist is currently empty</p>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* PLUGINS TAB */}
        <TabsContent value="plugins" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plugins.map((plugin) => (
              <Card
                key={plugin.id}
                className={`border-zinc-850 bg-zinc-900/10 p-5 rounded-2xl flex flex-col justify-between gap-4 hover:border-zinc-800 transition-all ${
                  plugin.enabled ? "shadow-[0_0_10px_rgba(24,24,27,0.5)]" : "opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <h4 className="font-bold text-white text-base flex items-center gap-2">
                      {plugin.name}
                      <span className="text-[10px] text-zinc-500 font-mono">v{plugin.version}</span>
                    </h4>
                    <p className="text-xs text-zinc-400 leading-relaxed">{plugin.description}</p>
                  </div>

                  <Switch
                    checked={plugin.enabled}
                    onCheckedChange={(val) => handleTogglePlugin(plugin.id, val)}
                  />
                </div>

                <div className="flex items-center gap-2 border-t border-zinc-800/40 pt-3">
                  <span className={`w-2 h-2 rounded-full ${plugin.enabled ? "bg-emerald-400" : "bg-rose-500"}`} />
                  <span className="text-[10px] uppercase font-mono font-bold text-zinc-500">
                    {plugin.enabled ? "Active" : "Disabled"}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* PROPERTIES TAB */}
        <TabsContent value="properties" className="space-y-4 mt-4">
          {/* Filter */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              type="text"
              placeholder="Search properties (difficulty, pvp, port, motd)..."
              value={propertySearch}
              onChange={(e) => setPropertySearch(e.target.value)}
              className="pl-10 py-5 bg-zinc-900/30 border-zinc-850 rounded-xl text-sm placeholder-zinc-500 text-zinc-200 focus-visible:ring-zinc-700"
            />
          </div>

          {/* Properties list */}
          <Card className="border-zinc-850 bg-zinc-900/10 p-5 rounded-2xl">
            <div className="space-y-4 divide-y divide-zinc-800/40">
              {filteredProperties.length > 0 ? (
                filteredProperties.map((prop, idx) => {
                  const isBool = prop.value === "true" || prop.value === "false";
                  return (
                    <div key={prop.name} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${idx > 0 ? "pt-4" : ""}`}>
                      <div className="space-y-0.5 max-w-lg">
                        <label className="font-bold text-zinc-200 text-sm font-mono">{prop.name}</label>
                        <p className="text-xs text-zinc-400">{prop.description}</p>
                        <span className="inline-block text-[9px] uppercase font-bold text-zinc-550 border border-zinc-805 px-1.5 py-0.2 rounded mt-1 bg-zinc-950 font-mono">
                          {prop.category}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        {isBool ? (
                          <Switch
                            checked={prop.value === "true"}
                            onCheckedChange={(val) => handlePropertyChange(prop.name, val ? "true" : "false")}
                          />
                        ) : (
                          <Input
                            type="text"
                            value={prop.value}
                            onChange={(e) => handlePropertyChange(prop.name, e.target.value)}
                            className="bg-black border-zinc-850 rounded-lg text-xs w-48 text-right font-mono"
                          />
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-10">
                  <FileText className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500">No properties matches the search</p>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </div>

      </Tabs>
    </div>
  );
}
