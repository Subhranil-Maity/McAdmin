"use client";

import React, { useState } from "react";
import Link from "next/link";
import { UserRole } from "@/types/roles";
import { InstanceSummary, deleteInstance, toggleServerPower, updateInstance } from "@/lib/mc-server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Server,
  Play,
  Square,
  Users,
  HardDrive,
  Copy,
  Check,
  Trash2,
  Settings,
  Loader2,
  Sliders,
  X,
  Layers,
  AlertCircle,
} from "lucide-react";

interface ServerGridProps {
  instances: InstanceSummary[];
  currentUserId?: string;
  currentUserRole: UserRole;
  isDev: boolean;
  onRefresh: () => Promise<void>;
  onCreateClick: () => void;
}

export default function ServerGrid({
  instances,
  currentUserId,
  currentUserRole,
  isDev,
  onRefresh,
  onCreateClick,
}: ServerGridProps) {
  const [copiedPort, setCopiedPort] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [editingInstance, setEditingInstance] = useState<InstanceSummary | null>(null);
  const [editRamGb, setEditRamGb] = useState<number>(2);
  const [editVersion, setEditVersion] = useState<string>("");
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const openEditModal = (inst: InstanceSummary) => {
    setEditingInstance(inst);
    setEditRamGb(inst.ram_gb || 2);
    setEditVersion(inst.minecraft_version || "");
    setEditError(null);
  };

  const closeEditModal = () => {
    setEditingInstance(null);
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInstance) return;
    setIsEditSaving(true);
    setEditError(null);
    try {
      await updateInstance(editingInstance.id, {
        ram_gb: editRamGb,
        minecraft_version: editVersion.trim(),
      });
      await onRefresh();
      closeEditModal();
    } catch (err) {
      console.error("Failed to update instance:", err);
      setEditError(err instanceof Error ? err.message : "Failed to update configuration");
    } finally {
      setIsEditSaving(false);
    }
  };

  const handleCopyIp = (ipAddress: string, port: number) => {
    const full = `${ipAddress}:${port}`;
    navigator.clipboard.writeText(full);
    setCopiedPort(full);
    setTimeout(() => setCopiedPort(null), 2000);
  };

  const handlePower = async (id: string, action: "start" | "stop") => {
    setActionLoadingId(`${id}-${action}`);
    try {
      await toggleServerPower(action, id);
      await onRefresh();
    } catch (err) {
      console.error(`Failed to ${action} server:`, err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = window.confirm(
      `Are you sure you want to permanently delete '${name}'? All files and worlds will be deleted.`
    );
    if (!ok) return;

    setActionLoadingId(`${id}-delete`);
    try {
      await deleteInstance(id);
      await onRefresh();
    } catch (err) {
      console.error("Failed to delete instance:", err);
      alert(`Error deleting server: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const canManageInstance = (instance: InstanceSummary) => {
    if (isDev || currentUserRole === UserRole.SUPERADMIN) return true;
    if (instance.owner_id && currentUserId && instance.owner_id === currentUserId) return true;
    if (currentUserId && instance.admins.includes(currentUserId)) return true;
    return false;
  };

  const canDeleteInstance = (instance: InstanceSummary) => {
    if (isDev || currentUserRole === UserRole.SUPERADMIN) return true;
    if (instance.owner_id && currentUserId && instance.owner_id === currentUserId) return true;
    return false;
  };

  if (instances.length === 0) {
    return (
      <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 max-w-xl mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mx-auto">
          <Server className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-white">No Minecraft Servers Found</h3>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto">
            Get started by creating your first Minecraft server instance with a custom server JAR.
          </p>
        </div>
        <div>
          <Button
            onClick={onCreateClick}
            className="rounded-xl px-5 py-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)] cursor-pointer"
          >
            Create Server Instance
          </Button>
        </div>
      </div>
    );
  }

  const hostIp =
    typeof window !== "undefined"
      ? window.location.hostname || "127.0.0.1"
      : "127.0.0.1";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {instances.map((instance) => {
        const isOnline = instance.status === "ONLINE";
        const isStarting = instance.status === "STARTING";
        const isOffline = instance.status === "OFFLINE";

        const canManage = canManageInstance(instance);
        const canDelete = canDeleteInstance(instance);
        const fullAddr = `${hostIp}:${instance.server_port}`;
        const isCopied = copiedPort === fullAddr;

        const isOwner = instance.owner_id && currentUserId && instance.owner_id === currentUserId;
        const isAdmin = currentUserId && instance.admins.includes(currentUserId);

        return (
          <Card
            key={instance.id}
            className="border-zinc-850 bg-zinc-900/40 backdrop-blur-md rounded-2xl overflow-hidden hover:border-zinc-750 transition-all duration-300 flex flex-col justify-between group shadow-lg"
          >
            <div>
              {/* Card Top / Header */}
              <div className="p-5 border-b border-zinc-850/80 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                      isOnline
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                        : isStarting
                        ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                        : "bg-zinc-800/40 border-zinc-750 text-zinc-500"
                    }`}
                  >
                    <Server className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-white text-base truncate group-hover:text-indigo-400 transition-colors">
                      {instance.name}
                    </h3>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono mt-0.5">
                      <span>Port {instance.server_port}</span>
                      {instance.minecraft_version && (
                        <span className="text-zinc-300 px-1.5 py-0.2 rounded bg-zinc-800/80 border border-zinc-700 font-mono text-[10px]">
                          v{instance.minecraft_version}
                        </span>
                      )}
                      {isOwner && (
                        <span className="text-amber-400 px-1 rounded bg-amber-400/10 border border-amber-400/20 font-sans text-[9px] font-bold uppercase">
                          Owner
                        </span>
                      )}
                      {!isOwner && isAdmin && (
                        <span className="text-purple-400 px-1 rounded bg-purple-400/10 border border-purple-400/20 font-sans text-[9px] font-bold uppercase">
                          Admin
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status indicator */}
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-extrabold uppercase tracking-wider shrink-0 ${
                    isOnline
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.15)]"
                      : isStarting
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse"
                      : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isOnline ? "bg-emerald-400" : isStarting ? "bg-amber-400" : "bg-rose-400"
                    }`}
                  />
                  {instance.status}
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 space-y-3.5">
                {/* Connection Address Card */}
                <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-850 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-mono">
                      Server Address
                    </div>
                    <div className="text-xs font-mono font-bold text-indigo-400 truncate">
                      {fullAddr}
                    </div>
                  </div>
                  <button
                    onClick={() => handleCopyIp(hostIp, instance.server_port)}
                    className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
                    title="Copy IP:Port to clipboard"
                  >
                    {isCopied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Telemetry info */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-zinc-950/40 border border-zinc-900 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-purple-400 shrink-0" />
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase font-mono">RAM</div>
                      <div className="font-bold text-zinc-200">{instance.ram_gb} GB</div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-950/40 border border-zinc-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase font-mono">Players</div>
                      <div className="font-bold text-zinc-200">
                        {isOnline ? `${instance.active_players} / ${instance.max_players}` : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Card Footer Actions */}
            <div className="p-5 pt-0 border-t border-zinc-850/60 flex items-center justify-between gap-2 mt-2 pt-4">
              {canManage ? (
                <>
                  <Link href={`/dashboard/${instance.id}`} className="flex-1">
                    <Button
                      variant="outline"
                      className="w-full text-xs font-bold rounded-xl border-zinc-800 hover:border-zinc-700 bg-zinc-900 hover:bg-zinc-850 text-white cursor-pointer flex items-center justify-center gap-1.5 h-9"
                    >
                      <Settings className="w-3.5 h-3.5 text-indigo-400" />
                      Manage Server
                    </Button>
                  </Link>

                  {/* Power Button */}
                  {isOffline ? (
                    <Button
                      onClick={() => handlePower(instance.id, "start")}
                      disabled={actionLoadingId !== null}
                      className="h-9 px-3 rounded-xl text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 cursor-pointer"
                      title="Start Server"
                    >
                      {actionLoadingId === `${instance.id}-start` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handlePower(instance.id, "stop")}
                      disabled={actionLoadingId !== null}
                      className="h-9 px-3 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 cursor-pointer"
                      title="Stop Server"
                    >
                      {actionLoadingId === `${instance.id}-stop` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Square className="w-3.5 h-3.5 fill-current" />
                      )}
                    </Button>
                  )}

                  {/* Quick Edit Config Button */}
                  <Button
                    onClick={() => openEditModal(instance)}
                    className="h-9 px-3 rounded-xl text-xs font-bold bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 cursor-pointer"
                    title="Edit RAM & Version"
                  >
                    <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  </Button>

                  {/* Delete Button */}
                  {canDelete && (
                    <Button
                      onClick={() => handleDelete(instance.id, instance.name)}
                      disabled={actionLoadingId !== null}
                      className="h-9 px-3 rounded-xl text-xs font-bold bg-zinc-900 hover:bg-rose-500/10 text-zinc-500 hover:text-rose-400 border border-zinc-800 hover:border-rose-500/20 cursor-pointer transition-colors"
                      title="Delete Instance"
                    >
                      {actionLoadingId === `${instance.id}-delete` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}
                </>
              ) : (
                <div className="w-full text-center">
                  <div className="inline-flex items-center gap-1.5 text-xs text-zinc-500 font-mono">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Connect using Minecraft Client
                  </div>
                </div>
              )}
            </div>
          </Card>
        );
      })}

      {/* Quick Edit RAM / Version Modal */}
      {editingInstance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="w-full max-w-md border-zinc-800 bg-zinc-900/95 backdrop-blur-xl shadow-2xl rounded-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-zinc-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Edit Server Configuration</h3>
                  <p className="text-[11px] text-zinc-400 truncate max-w-[240px]">{editingInstance.name}</p>
                </div>
              </div>
              <button
                onClick={closeEditModal}
                disabled={isEditSaving}
                className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-4">
              {editError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              {/* Minecraft Version */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" /> Minecraft Version
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">e.g. 1.20.4, 1.21</span>
                </label>
                <Input
                  type="text"
                  placeholder="1.20.4"
                  value={editVersion}
                  onChange={(e) => setEditVersion(e.target.value)}
                  disabled={isEditSaving}
                  className="bg-zinc-950 border-zinc-800 text-xs font-mono rounded-xl placeholder:text-zinc-600 focus-visible:ring-indigo-500"
                />
              </div>

              {/* RAM Allocation */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-purple-400" /> RAM Allocation
                  </label>
                  <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-lg">
                    {editRamGb} GB
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="32"
                  step="1"
                  value={editRamGb}
                  onChange={(e) => setEditRamGb(parseInt(e.target.value, 10))}
                  disabled={isEditSaving}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>1 GB</span>
                  <span>4 GB</span>
                  <span>8 GB</span>
                  <span>16 GB</span>
                  <span>32 GB</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[2, 4, 6, 8, 12, 16].map((gb) => (
                    <button
                      key={gb}
                      type="button"
                      onClick={() => setEditRamGb(gb)}
                      disabled={isEditSaving}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border transition-all cursor-pointer ${
                        editRamGb === gb
                          ? "bg-indigo-600 text-white border-indigo-500 font-bold"
                          : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {gb} GB
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-zinc-500 flex items-center gap-1.5 pt-1">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Restart server for RAM changes to take effect.</span>
              </p>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800/80">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEditModal}
                  disabled={isEditSaving}
                  className="h-9 px-4 rounded-xl text-xs font-bold border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isEditSaving}
                  className="h-9 px-4 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
                >
                  {isEditSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Changes"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
