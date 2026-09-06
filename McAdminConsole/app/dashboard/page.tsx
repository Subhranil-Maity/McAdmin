"use client";

import React, { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { getUserRole, UserRole } from "@/types/roles";
import { listInstances, InstanceSummary } from "@/lib/mc-server";
import ServerGrid from "@/components/dashboard/server-grid";
import CreateInstanceDialog from "@/components/dashboard/create-instance-dialog";
import { Button } from "@/components/ui/button";
import { Plus, Server, Activity, HardDrive, RefreshCw, Loader2 } from "lucide-react";

export default function DashboardPage() {
  const { user } = useUser();
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const role = user ? getUserRole(user.publicMetadata) : UserRole.NORMUSER;
  const isDev = process.env.NODE_ENV === "development";

  const fetchInstances = async () => {
    try {
      const list = await listInstances();
      setInstances(list);
    } catch (err) {
      console.error("Failed to load instances:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInstances();
    const interval = setInterval(fetchInstances, 3000);
    return () => clearInterval(interval);
  }, []);

  const totalRam = instances.reduce((acc, i) => acc + i.ram_gb, 0);
  const runningCount = instances.filter((i) => i.status === "ONLINE").length;
  const totalPlayers = instances.reduce((acc, i) => acc + (i.active_players || 0), 0);

  const canCreate = isDev || role === UserRole.SUPERADMIN || role === UserRole.OWNER || role === UserRole.ADMIN;

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6 space-y-8 animate-fade-in">
      {/* Top Banner / Summary */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-850 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-black text-white tracking-tight">Minecraft Servers</h1>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
              {instances.length}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Browse live Minecraft server instances, monitor telemetry, and join or manage servers.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            onClick={fetchInstances}
            className="h-10 px-3.5 rounded-xl border-zinc-800 hover:bg-zinc-900 text-zinc-300 text-xs"
            title="Refresh list"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>

          {canCreate && (
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="h-10 px-4 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.35)] active:scale-[0.98] transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Create New Server
            </Button>
          )}
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl border border-zinc-850 bg-zinc-900/30 backdrop-blur-md flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-semibold">
              Active Servers
            </div>
            <div className="text-xl font-black text-white">
              {runningCount} <span className="text-xs font-normal text-zinc-500">/ {instances.length} online</span>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-zinc-850 bg-zinc-900/30 backdrop-blur-md flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-semibold">
              Allocated RAM
            </div>
            <div className="text-xl font-black text-white">{totalRam} GB</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-zinc-850 bg-zinc-900/30 backdrop-blur-md flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono font-semibold">
              Total Online Players
            </div>
            <div className="text-xl font-black text-white">{totalPlayers}</div>
          </div>
        </div>
      </div>

      {/* Main Server Grid */}
      {loading && instances.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <span className="text-xs text-zinc-500 font-mono">Loading Minecraft servers...</span>
        </div>
      ) : (
        <ServerGrid
          instances={instances}
          currentUserId={user?.id}
          currentUserRole={role}
          isDev={isDev}
          onRefresh={fetchInstances}
          onCreateClick={() => setIsCreateOpen(true)}
        />
      )}

      {/* Create Instance Modal */}
      <CreateInstanceDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        existingInstances={instances}
        onCreated={fetchInstances}
      />
    </div>
  );
}
