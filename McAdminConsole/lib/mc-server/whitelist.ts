import { WhitelistEntry } from "./types";
import { delay } from "./utils";
import { getServerPlayers } from "./players";

const dummyWhitelist: WhitelistEntry[] = [
  { id: "w1", username: "Notch", addedAt: "2026-07-01 12:30" },
  { id: "w2", username: "Jeb_", addedAt: "2026-07-01 12:35" },
  { id: "w3", username: "Alex", addedAt: "2026-07-02 18:10" },
  { id: "w4", username: "Steve", addedAt: "2026-07-02 18:12" },
];

export async function getWhitelist(): Promise<WhitelistEntry[]> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    return [...dummyWhitelist];
  }

  try {
    const players = await getServerPlayers();
    return players
      .filter((p) => p.isWhitelisted)
      .map((p) => ({
        id: p.username,
        username: p.username,
        addedAt: "Added"
      }));
  } catch (e) {
    console.error("Error fetching whitelist:", e);
    return [];
  }
}

export async function addWhitelist(username: string): Promise<WhitelistEntry> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    const cleanUser = username.trim();
    return {
      id: cleanUser,
      username: cleanUser,
      addedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    };
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/server/players/whitelist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player: username }),
  });
  if (!res.ok) {
    throw new Error(`Failed to add player to whitelist: status ${res.status}`);
  }

  return {
    id: username,
    username,
    addedAt: new Date().toISOString().slice(0, 16).replace("T", " ")
  };
}

export async function removeWhitelist(entryId: string): Promise<void> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    return;
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/server/players/dewhitelist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player: entryId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to remove player from whitelist: status ${res.status}`);
  }
}
