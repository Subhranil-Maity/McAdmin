"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useDashboard } from "./dashboard-context";
import {
  Terminal,
  Activity,
  Users,
  UserCheck,
  Settings,
  FileText,
  Folder,
  Server,
  ChevronDown,
  Play,
  Square,
  RotateCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUptime } from "@/lib/mc-server";
import Link from "next/link";

interface DashboardClientLayoutProps {
  children: React.ReactNode;
}

export default function DashboardClientLayout({ children }: DashboardClientLayoutProps) {
  const {
    status,
    isPhysicalServerOnline,
    players,
    whitelist,
    plugins,
    powerActionLoading,
    handlePowerAction,
    userRole,
  } = useDashboard();

  const pathname = usePathname();

  // Loading state when initial fetch hasn't completed yet
  if (!status) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  // Sidebar Menu Items Config
  const menuItems = [
    { id: "console", label: "Console", icon: Terminal, badge: null, path: "/dashboard/console" },
    { id: "overview", label: "Overview", icon: Activity, badge: null, path: "/dashboard/overview" },
    {
      id: "players",
      label: "Players",
      icon: Users,
      path: "/dashboard/players",
      badge: status?.activePlayers !== undefined
        ? (status.activePlayers > 0 ? `${status.activePlayers}` : null)
        : (players.filter(p => p.online).length ? `${players.filter(p => p.online).length}` : null)
    },
    { id: "whitelist", label: "Whitelist", icon: UserCheck, path: "/dashboard/whitelist", badge: whitelist.length ? `${whitelist.length}` : null },
    {
      id: "plugins",
      label: "Plugins",
      icon: Settings,
      path: "/dashboard/plugins",
      badge: plugins.length ? `${plugins.filter(p => p.enabled).length}/${plugins.length}` : null
    },
    { id: "properties", label: "Properties", icon: FileText, badge: null, path: "/dashboard/properties" },
    { id: "files", label: "Files", icon: Folder, badge: null, path: "/dashboard/files" },
  ];

  const getTabIdFromPath = (path: string) => {
    if (path === "/dashboard" || path === "/dashboard/overview") return "overview";
    const parts = path.split("/");
    return parts[parts.length - 1] || "overview";
  };

  const activeTabId = getTabIdFromPath(pathname);

  const isServerStarting = status?.status === "STARTING";
  const isServerOnline = status?.status === "ONLINE";
  const isServerOffline = status?.status === "OFFLINE";

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
            const isActive = pathname === item.path || (item.id === "overview" && pathname === "/dashboard");
            const isPlugins = item.id === "plugins";

            if (isPlugins) {
              return (
                <div
                  key={item.id}
                  title="Not Implemented Yet, manage directly"
                  className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold rounded-xl text-zinc-600 dark:text-zinc-600 opacity-40 cursor-not-allowed select-none transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 text-zinc-700 dark:text-zinc-700" />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== null && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-zinc-900 border-zinc-950 text-zinc-700">
                      {item.badge}
                    </span>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.id}
                href={item.path}
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
              </Link>
            );
          })}
        </nav>

        {/* Bottom profile / connection status */}
        <div className="p-4 border-t border-zinc-900 bg-zinc-950/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white uppercase shadow-[0_0_15px_rgba(168,85,247,0.15)]">
              {userRole[0] || "A"}
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
              {activeTabId}
            </h2>
            <p className="text-xs text-zinc-500">
              {status?.status === "ONLINE"
                ? `Uptime: ${formatUptime(status.uptime)}${status.activePlayers !== undefined ? ` • Players: ${status.activePlayers}/${status.maxPlayers || 10}` : ""}`
                : status?.status === "STARTING"
                ? "Loading server modules..."
                : "Server is offline"}
            </p>
          </div>

          {/* Telemetry Status, IP and Power Actions */}
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
            {/* Server Status pill */}
            <div className="flex items-center gap-2 h-9 px-4 bg-zinc-900/50 border border-zinc-900 rounded-xl text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${isServerOnline ? "bg-emerald-400 shadow-[0_0_6px_#10b981]" : isServerOffline ? "bg-rose-400 shadow-[0_0_6px_#f43f5e]" : "bg-amber-400 animate-pulse"}`} />
              <span className="text-zinc-500 font-semibold font-mono uppercase tracking-wider text-[10px]">Status:</span>
              <span className={`font-black uppercase text-[11px] ${isServerOnline ? "text-emerald-400" : isServerOffline ? "text-rose-400" : "text-amber-400"}`}>
                {status?.status || "LOADING"}
              </span>
            </div>

            {/* Server IP pill */}
            <div className="flex items-center gap-2 h-9 px-4 bg-zinc-900/50 border border-zinc-900 rounded-xl text-xs text-zinc-300">
              <span className="text-zinc-500 font-semibold font-mono uppercase tracking-wider text-[10px]">IP:</span>
              <span className="font-extrabold font-mono text-[11px] text-indigo-400">
                {status?.ipAddress ? `${status.ipAddress}:${status.port}` : "—"}
              </span>
            </div>

            {/* Divider line */}
            <div className="h-6 w-[1px] bg-zinc-900 hidden md:block" />

            {/* Quick Power Actions */}
            <div className="flex items-center gap-2">
              {/* Start Button */}
              <Button
                onClick={() => handlePowerAction("start")}
                disabled={!isServerOffline || powerActionLoading !== null}
                className="h-9 px-4 rounded-xl text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
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
                className="h-9 px-4 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:border-rose-500/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
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
                className="h-9 px-4 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 hover:border-amber-500/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
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
        </header>

        {/* Scrollable Active Tab Workspace */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-zinc-900">
          {children}
        </div>
      </main>

      {/* Reconnection Loading Overlay */}
      {!isPhysicalServerOnline && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in select-none">
          <div className="max-w-sm w-full mx-4 rounded-2xl border border-zinc-850 bg-zinc-900/90 shadow-2xl p-6 text-center space-y-6 relative overflow-hidden">
            {/* Top red/amber bar */}
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-rose-500 to-amber-500" />
            
            <div className="flex flex-col items-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              </div>
              <h3 className="font-extrabold text-white text-lg">Physical Server Offline</h3>
              <p className="text-xs text-zinc-400 leading-relaxed max-w-[280px]">
                The hardware node is currently unreachable. We are attempting to establish a connection.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-900 space-y-1">
              <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-mono font-bold">Connection Attempts</div>
              <div className="text-[10px] font-mono text-zinc-400">
                Status: <span className="text-amber-400 font-bold animate-pulse">Retrying...</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
