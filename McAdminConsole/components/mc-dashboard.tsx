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
  formatUptime,
  CommandResponse,
} from "@/lib/mc-server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Loader2,
  Server,
  ChevronDown,
  Lock,
  Wifi,
} from "lucide-react";

// Tab Sub-components
import OverviewTab from "./dashboard/overview-tab";
import ConsoleTab from "./dashboard/console-tab";
import PlayersTab from "./dashboard/players-tab";
import WhitelistTab from "./dashboard/whitelist-tab";
import PluginsTab from "./dashboard/plugins-tab";
import PropertiesTab from "./dashboard/properties-tab";

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
  const [activeTab, setActiveTab] = useState("console"); // Start on Console like the reference image
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
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const latestStatus = await getServerStatus();
        setStatus(latestStatus);
        
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
  }, [logs, activeTab]);

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

  const isServerStarting = status?.status === "STARTING";
  const isServerOnline = status?.status === "ONLINE";
  const isServerOffline = status?.status === "OFFLINE";

  // Render Restricted Normal User Dashboard
  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-zinc-950 overflow-y-auto">
        <div className="max-w-xl w-full space-y-8">
          
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
                      <Play className="w-4 h-4 fill-current animate-pulse" />
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
      </div>
    );
  }

  // Sidebar Menu Items Config
  const menuItems = [
    { id: "console", label: "Console", icon: Terminal, badge: null },
    { id: "overview", label: "Overview", icon: Activity, badge: null },
    { 
      id: "players", 
      label: "Players", 
      icon: Users, 
      badge: status?.activePlayers !== undefined 
        ? (status.activePlayers > 0 ? `${status.activePlayers}` : null) 
        : (players.filter(p => p.online).length ? `${players.filter(p => p.online).length}` : null)
    },
    { id: "whitelist", label: "Whitelist", icon: UserCheck, badge: whitelist.length ? `${whitelist.length}` : null },
    { id: "plugins", label: "Plugins", icon: Settings, badge: plugins.length ? `${plugins.filter(p => p.enabled).length}/${plugins.length}` : null },
    { id: "properties", label: "Properties", icon: FileText, badge: null },
  ];

  // Render Full Admin Dashboard with Side-by-Side drawer layout
  return (
    <div className="w-full h-full flex flex-row overflow-hidden bg-zinc-950">
      
      {/* Left Sidebar Drawer */}
      <aside className="w-64 border-r border-zinc-900 bg-zinc-950 flex flex-col justify-between h-full shrink-0 select-none overflow-hidden">
        
        {/* Sidebar Header / Server Selector */}
        <div className="p-4 border-b border-zinc-900 flex items-center justify-between hover:bg-zinc-900/30 cursor-pointer transition-colors duration-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
              <Server className="w-4 h-4" />
            </div>
            <div className="text-left">
              <h3 className="text-xs font-bold text-white leading-tight">Minecraft Test Server</h3>
              <p className="text-[10px] text-zinc-500 font-medium">survival_world</p>
            </div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
        </div>

        {/* Navigation list - Scrollable content area inside left panel */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-900">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center justify-between w-full px-3 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                  isActive
                    ? "bg-zinc-900 text-zinc-100 border border-zinc-850 shadow-[0_0_10px_rgba(24,24,27,0.5)]"
                    : "text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? "text-indigo-400" : "text-zinc-500"}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                    isActive 
                      ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                      : "bg-zinc-900 border-zinc-850 text-zinc-500"
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom profile / connection status */}
        <div className="p-4 border-t border-zinc-900 bg-zinc-950/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white uppercase shadow-[0_0_15px_rgba(168,85,247,0.15)]">
              {userRole[0]}
            </div>
            <div className="text-left">
              <h4 className="text-xs font-bold text-white leading-tight">Admin</h4>
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-semibold">{userRole}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
        </div>

      </aside>

      {/* Right Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-950/20">
        
        {/* Main Content Header */}
        <header className="px-6 py-4 border-b border-zinc-900 bg-zinc-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0 shadow-sm z-10">
          <div>
            <h2 className="text-lg font-black text-white flex items-center gap-2 capitalize">
              {activeTab}
              <span className="text-[10px] font-mono px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-full font-bold">
                {status?.version || "Spigot 1.20.4"}
              </span>
            </h2>
            <p className="text-xs text-zinc-500">
              {status?.status === "ONLINE"
                ? `Uptime: ${formatUptime(status.uptime)}${status.activePlayers !== undefined ? ` • Players: ${status.activePlayers}/${status.maxPlayers || 10}` : ""}`
                : status?.status === "STARTING"
                ? "Loading server modules..."
                : "Server is offline"}
            </p>
          </div>

          {/* Quick Power Actions */}
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {/* Start Button */}
            <Button
              onClick={() => handlePowerAction("start")}
              disabled={!isServerOffline || powerActionLoading !== null}
              className="flex-1 sm:flex-initial h-9 px-4 rounded-xl text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
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
              className="flex-1 sm:flex-initial h-9 px-4 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:border-rose-500/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
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
              className="flex-1 sm:flex-initial h-9 px-4 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 hover:border-amber-500/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              {powerActionLoading === "restart" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCw className="w-3.5 h-3.5 mr-1.5" />
              )}
              Restart
            </Button>
          </div>
        </header>

        {/* Global Server Metrics Row (Matches the reference image card design) */}
        <section className="px-6 py-4 bg-zinc-950/40 border-b border-zinc-900 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 shrink-0">
          
          <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-3 flex flex-col justify-center">
            <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Name</span>
            <span className="text-xs font-extrabold text-zinc-200 mt-0.5 truncate">Minecraft Test Server</span>
          </div>

          <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-3 flex flex-col justify-center">
            <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Status</span>
            <span className={`text-xs font-extrabold mt-0.5 flex items-center gap-1.5 ${
              isServerOnline ? "text-emerald-400" : isServerOffline ? "text-rose-400" : "text-amber-400 animate-pulse"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isServerOnline ? "bg-emerald-400 shadow-[0_0_6px_#10b981]" : isServerOffline ? "bg-rose-400 shadow-[0_0_6px_#f43f5e]" : "bg-amber-400"}`} />
              {status?.status || "LOADING"}
            </span>
          </div>

          <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-3 flex flex-col justify-center">
            <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Address</span>
            <span className="text-xs font-extrabold text-zinc-200 mt-0.5 truncate">
              {status?.ipAddress ? `${status.ipAddress}:${status.port}` : "—"}
            </span>
          </div>

          <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-3 flex flex-col justify-center">
            <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">CPU</span>
            <span className="text-xs font-extrabold text-zinc-200 mt-0.5">
              {isServerOffline ? "Offline" : `${status?.cpu || 0}%`}
            </span>
          </div>

          <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-3 flex flex-col justify-center">
            <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Memory</span>
            <span className="text-xs font-extrabold text-zinc-200 mt-0.5">
              {isServerOffline ? "Offline" : `${status?.ramUsed || 0} GB / ${status?.ramMax || 8} GB`}
            </span>
          </div>

          <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-3 flex flex-col justify-center">
            <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Disk</span>
            <span className="text-xs font-extrabold text-zinc-200 mt-0.5">
              {isServerOffline ? "Unavailable" : "2.34 GB / 25 GB"}
            </span>
          </div>

        </section>

        {/* Scrollable Active Tab Workspace */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-zinc-900">
          {activeTab === "overview" && <OverviewTab status={status} userRole={userRole} />}
          
          {activeTab === "console" && (
            <ConsoleTab
              logs={logs}
              commandInput={commandInput}
              setCommandInput={setCommandInput}
              handleSendCommand={handleSendCommand}
              consoleEndRef={consoleEndRef}
              lastCommandResponse={lastCommandResponse}
            />
          )}

          {activeTab === "players" && (
            <PlayersTab
              players={players}
              playerSearch={playerSearch}
              setPlayerSearch={setPlayerSearch}
              handlePlayerAction={handlePlayerAction}
              actionPlayerId={actionPlayerId}
            />
          )}

          {activeTab === "whitelist" && (
            <WhitelistTab
              whitelist={whitelist}
              newWhitelistName={newWhitelistName}
              setNewWhitelistName={setNewWhitelistName}
              handleAddWhitelist={handleAddWhitelist}
              handleRemoveWhitelist={handleRemoveWhitelist}
              whitelistLoading={whitelistLoading}
            />
          )}

          {activeTab === "plugins" && (
            <PluginsTab
              plugins={plugins}
              handleTogglePlugin={handleTogglePlugin}
            />
          )}

          {activeTab === "properties" && (
            <PropertiesTab
              properties={properties}
              propertySearch={propertySearch}
              setPropertySearch={setPropertySearch}
              handlePropertyChange={handlePropertyChange}
            />
          )}
        </div>

      </main>

    </div>
  );
}
