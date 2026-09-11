"use client";

import React from "react";
import { UserCheck, Plus, Trash2, Loader2, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { WhitelistEntry } from "@/lib/mc-server";
import { useDashboard } from "./dashboard-context";

interface WhitelistTabProps {
  whitelist: WhitelistEntry[];
  newWhitelistName: string;
  setNewWhitelistName: (val: string) => void;
  handleAddWhitelist: (e: React.FormEvent) => void;
  handleRemoveWhitelist: (id: string) => void;
  whitelistLoading: boolean;
}

export default function WhitelistTab({
  whitelist,
  newWhitelistName,
  setNewWhitelistName,
  handleAddWhitelist,
  handleRemoveWhitelist,
  whitelistLoading,
}: WhitelistTabProps) {
  const { canViewWhitelist, canManageWhitelist } = useDashboard();

  if (!canViewWhitelist) {
    return (
      <Card className="border-zinc-850 bg-zinc-950 p-12 rounded-2xl flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
          <Lock className="w-6 h-6" />
        </div>
        <h4 className="text-white font-bold text-base">Whitelist View Restricted</h4>
        <p className="text-zinc-400 text-xs max-w-sm">
          You lack the <code className="text-zinc-200 font-mono bg-zinc-900 px-1 py-0.5 rounded">whitelist:view</code> permission required to view server whitelist entries.
        </p>
      </Card>
    );
  }

  return (
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
            disabled={!canManageWhitelist}
            placeholder={
              canManageWhitelist
                ? "Minecraft Username..."
                : "Manage restricted (requires whitelist:manage)..."
            }
            value={newWhitelistName}
            onChange={(e) => setNewWhitelistName(e.target.value)}
            className="bg-black border-zinc-850 rounded-xl text-xs focus-visible:ring-zinc-800 h-9 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <Button
            type="submit"
            disabled={whitelistLoading || !canManageWhitelist || !newWhitelistName.trim()}
            title={!canManageWhitelist ? "Permission required: whitelist:manage" : undefined}
            className="px-3 rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors text-xs font-semibold h-9 flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
                disabled={!canManageWhitelist}
                title={!canManageWhitelist ? "Permission required: whitelist:manage" : undefined}
                className="p-2 h-8 w-8 rounded-lg bg-zinc-900 hover:bg-rose-950/20 hover:text-rose-400 border border-zinc-850 text-zinc-400 hover:border-rose-900/40 transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
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
  );
}
