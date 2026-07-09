import { Player } from "./types";
import { delay } from "./utils";

const dummyPlayers: Player[] = [
  { id: "Notch", username: "Notch", online: true, ping: 14, isOp: true, isWhitelisted: true, isBanned: false },
  { id: "Jeb_", username: "Jeb_", online: true, ping: 32, isOp: true, isWhitelisted: true, isBanned: false },
  { id: "Alex", username: "Alex", online: true, ping: 68, isOp: false, isWhitelisted: true, isBanned: false },
  { id: "Steve", username: "Steve", online: false, ping: 0, isOp: false, isWhitelisted: true, isBanned: false },
  { id: "Herobrine", username: "Herobrine", online: false, ping: 0, isOp: false, isWhitelisted: false, isBanned: true },
  { id: "Grumm", username: "Grumm", online: false, ping: 0, isOp: false, isWhitelisted: false, isBanned: false },
];

export async function getServerPlayers(): Promise<Player[]> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    return [...dummyPlayers].sort((a, b) => {
      if (a.online === b.online) return a.username.localeCompare(b.username);
      return a.online ? -1 : 1;
    });
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  try {
    const playersRes = await fetch(`${base}/api/server/players`, { cache: "no-store" });
    if (!playersRes.ok) {
      throw new Error(`Failed to fetch players: status ${playersRes.status}`);
    }
    const playersData = await playersRes.json();
    const allPlayersList: any[] = playersData.players || [];

    let onlineUsernames: string[] = [];
    try {
      const onlineRes = await fetch(`${base}/api/server/players/online`, { cache: "no-store" });
      if (onlineRes.ok) {
        const onlineData = await onlineRes.json();
        if (Array.isArray(onlineData)) {
          onlineUsernames = onlineData;
        } else if (onlineData && Array.isArray(onlineData.players)) {
          onlineUsernames = onlineData.players;
        }
      }
    } catch (e) {
      // Server offline/starting, online list empty
    }

    const allPlayersMap = new Map(allPlayersList.map((p) => [p.name.toLowerCase(), p]));

    const mappedPlayers: Player[] = allPlayersList.map((p) => {
      const isOnline = onlineUsernames.some((name) => name.toLowerCase() === p.name.toLowerCase());
      return {
        id: p.name,
        username: p.name,
        online: isOnline,
        ping: isOnline ? 20 : 0,
        isOp: p.op || false,
        isWhitelisted: p.whitelisted || false,
        isBanned: p.banned || false,
      };
    });

    // Dynamically append online players who are not in the known offline cache database
    onlineUsernames.forEach((name) => {
      if (name && !allPlayersMap.has(name.toLowerCase())) {
        mappedPlayers.push({
          id: name,
          username: name,
          online: true,
          ping: 20,
          isOp: false,
          isWhitelisted: false,
          isBanned: false,
        });
      }
    });

    return mappedPlayers.sort((a, b) => {
      if (a.online === b.online) return a.username.localeCompare(b.username);
      return a.online ? -1 : 1;
    });
  } catch (err) {
    console.error("Error fetching players from backend:", err);
    return [];
  }
}

export async function updatePlayerStatus(
  playerId: string,
  action: "kick" | "ban" | "unban" | "op" | "deop" | "whitelist" | "dewhitelist"
): Promise<void> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(150);
    return;
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  let endpoint = "";
  let body: any = { player: playerId };

  switch (action) {
    case "kick":
      endpoint = `${base}/api/server/command`;
      body = { command: `kick ${playerId}` };
      break;
    case "ban":
      endpoint = `${base}/api/server/players/ban`;
      body = { player: playerId, reason: "Banned by administrator" };
      break;
    case "unban":
      endpoint = `${base}/api/server/players/unban`;
      break;
    case "op":
      endpoint = `${base}/api/server/players/op`;
      break;
    case "deop":
      endpoint = `${base}/api/server/players/deop`;
      break;
    case "whitelist":
      endpoint = `${base}/api/server/players/whitelist`;
      break;
    case "dewhitelist":
      endpoint = `${base}/api/server/players/dewhitelist`;
      break;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Failed to perform player action ${action}: status ${res.status}`);
  }
}
