"use client";

import React from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import PlayersTab from "@/components/dashboard/players-tab";

export default function InstancePlayersPage() {
  const {
    players,
    playerSearch,
    setPlayerSearch,
    handlePlayerAction,
    actionPlayerId,
  } = useDashboard();

  return (
    <PlayersTab
      players={players}
      playerSearch={playerSearch}
      setPlayerSearch={setPlayerSearch}
      handlePlayerAction={handlePlayerAction}
      actionPlayerId={actionPlayerId}
    />
  );
}
