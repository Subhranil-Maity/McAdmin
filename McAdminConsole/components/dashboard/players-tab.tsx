"use client";

import React from "react";
import { Users, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Player } from "@/lib/mc-server";

interface PlayersTabProps {
  players: Player[];
  playerSearch: string;
  setPlayerSearch: (val: string) => void;
  handlePlayerAction: (
    playerId: string,
    action: "kick" | "ban" | "unban" | "op" | "deop" | "whitelist" | "dewhitelist"
  ) => void;
  actionPlayerId: string | null;
}

export default function PlayersTab({
  players,
  playerSearch,
  setPlayerSearch,
  handlePlayerAction,
  actionPlayerId,
}: PlayersTabProps) {
  // Filter players list
  const filteredPlayers = players.filter((p) => {
    const query = playerSearch.toLowerCase().trim();
    if (!query) return true;

    if (query === "op") return p.isOp;
    if (query === "whitelist" || query === "whitelisted") return p.isWhitelisted;
    if (query === "ban" || query === "banned") return p.isBanned;
    if (query === "online") return p.online;
    if (query === "offline") return !p.online;

    return p.username.toLowerCase().includes(query);
  });

  return (
    <div className="space-y-4">
      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl p-3 flex flex-col justify-center text-center">
          <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Known Players</span>
          <span className="text-sm font-extrabold text-zinc-200 mt-0.5">{players.length}</span>
        </div>
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl p-3 flex flex-col justify-center text-center">
          <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Online</span>
          <span className="text-sm font-extrabold text-emerald-400 mt-0.5">
            {players.filter((p) => p.online).length}
          </span>
        </div>
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl p-3 flex flex-col justify-center text-center">
          <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Operators</span>
          <span className="text-sm font-extrabold text-amber-400 mt-0.5">
            {players.filter((p) => p.isOp).length}
          </span>
        </div>
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl p-3 flex flex-col justify-center text-center">
          <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Whitelisted</span>
          <span className="text-sm font-extrabold text-emerald-500 mt-0.5">
            {players.filter((p) => p.isWhitelisted).length}
          </span>
        </div>
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl p-3 flex flex-col justify-center text-center col-span-2 sm:col-span-1">
          <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider font-mono">Banned</span>
          <span className="text-sm font-extrabold text-rose-500 mt-0.5">
            {players.filter((p) => p.isBanned).length}
          </span>
        </div>
      </div>

      {/* Search Filter */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <Input
          type="text"
          placeholder="Search players by name, or filter by typing 'online', 'offline', 'op', 'whitelist', 'banned'..."
          value={playerSearch}
          onChange={(e) => setPlayerSearch(e.target.value)}
          className="pl-10 py-5 bg-zinc-900/30 border-zinc-850 rounded-xl text-sm placeholder-zinc-500 text-zinc-200 focus-visible:ring-zinc-700"
        />
      </div>

      {/* Players Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredPlayers.length > 0 ? (
          filteredPlayers.map((player) => (
            <Card
              key={player.id}
              className="border-zinc-850 bg-zinc-900/20 hover:border-zinc-800 transition-all p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                {/* Head / Avatar placeholder */}
                <div className={`w-10 h-10 rounded-lg border flex items-center justify-center font-bold text-sm ${
                  player.isBanned 
                    ? "bg-rose-950/10 border-rose-900/30 text-rose-400" 
                    : player.isOp 
                    ? "bg-amber-950/10 border-amber-900/30 text-amber-400" 
                    : "bg-zinc-850 border-zinc-700 text-zinc-300"
                }`}>
                  {player.username[0].toUpperCase()}
                </div>
                <div>
                  <h4 className="font-bold text-white text-sm flex flex-wrap items-center gap-1.5">
                    {player.username}
                    {player.isOp && (
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-semibold border-amber-500/20 bg-amber-500/5 text-amber-400 py-0 px-1">
                        OP
                      </Badge>
                    )}
                    {player.isWhitelisted && (
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-semibold border-emerald-500/20 bg-emerald-500/5 text-emerald-400 py-0 px-1">
                        Whitelist
                      </Badge>
                    )}
                    {player.isBanned && (
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-semibold border-rose-500/20 bg-rose-500/5 text-rose-400 py-0 px-1">
                        Banned
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
              <div className="flex flex-wrap gap-1.5 justify-start sm:justify-end">
                {/* Op Action */}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => handlePlayerAction(player.id, player.isOp ? "deop" : "op")}
                  disabled={actionPlayerId === player.id}
                  className={`text-[10px] border rounded px-2 py-1 cursor-pointer transition-colors ${
                    player.isOp 
                      ? "border-amber-500/30 hover:bg-amber-500/10 text-amber-400" 
                      : "border-zinc-800 hover:bg-zinc-800/50 text-zinc-300"
                  }`}
                >
                  {player.isOp ? "De-Op" : "Op"}
                </Button>

                {/* Whitelist Action */}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => handlePlayerAction(player.id, player.isWhitelisted ? "dewhitelist" : "whitelist")}
                  disabled={actionPlayerId === player.id}
                  className={`text-[10px] border rounded px-2 py-1 cursor-pointer transition-colors ${
                    player.isWhitelisted 
                      ? "border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-400" 
                      : "border-zinc-800 hover:bg-zinc-800/50 text-zinc-300"
                  }`}
                >
                  {player.isWhitelisted ? "- Whitelist" : "+ Whitelist"}
                </Button>

                {/* Ban Action */}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => handlePlayerAction(player.id, player.isBanned ? "unban" : "ban")}
                  disabled={actionPlayerId === player.id}
                  className={`text-[10px] border rounded px-2 py-1 cursor-pointer transition-colors ${
                    player.isBanned 
                      ? "border-rose-500/30 hover:bg-rose-500/10 text-rose-400" 
                      : "border-zinc-800 hover:bg-rose-950/20 text-rose-300 hover:text-rose-400 hover:border-rose-900/40"
                  }`}
                >
                  {player.isBanned ? "Unban" : "Ban"}
                </Button>

                {/* Kick Action */}
                {player.online && (
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={() => handlePlayerAction(player.id, "kick")}
                    disabled={actionPlayerId === player.id}
                    className="text-[10px] rounded px-2 py-1 cursor-pointer"
                  >
                    Kick
                  </Button>
                )}
              </div>
            </Card>
          ))
        ) : (
          <div className="col-span-full text-center py-12 border border-dashed border-zinc-850 rounded-2xl bg-zinc-900/5">
            <Users className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <h4 className="font-semibold text-zinc-400 text-sm">No players found</h4>
          </div>
        )}
      </div>
    </div>
  );
}
