"use client";

import React from "react";
import { UserCheck, Plus, Trash2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { WhitelistEntry } from "@/lib/mc-server";

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
  );
}
