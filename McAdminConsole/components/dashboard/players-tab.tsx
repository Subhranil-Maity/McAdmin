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
  handlePlayerAction: (playerId: string, action: "kick" | "ban" | "toggle_op") => void;
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
  const filteredPlayers = players.filter(
    (p) =>
      p.username.toLowerCase().includes(playerSearch.toLowerCase()) ||
      (p.isOp && playerSearch.toLowerCase() === "op")
  );

  return (
    <div className="space-y-4">
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
