import { ServerProperty } from "./types";
import { delay, getBackendBaseUrl, apiFetch } from "./utils";

const defaultPropertyDefinitions: Record<string, { defaultValue: string; description: string; category: "General" | "Gameplay" | "Network" | "World" }> = {
  motd: { defaultValue: "A Minecraft Server", description: "Message of the Day displayed in server browser.", category: "General" },
  "server-port": { defaultValue: "25565", description: "The port number the server listens to.", category: "Network" },
  "max-players": { defaultValue: "20", description: "Maximum number of concurrent player connections.", category: "Network" },
  difficulty: { defaultValue: "easy", description: "Game difficulty (peaceful, easy, normal, hard).", category: "Gameplay" },
  pvp: { defaultValue: "true", description: "Enable player vs player combat.", category: "Gameplay" },
  "spawn-monsters": { defaultValue: "true", description: "Controls whether monsters can spawn.", category: "Gameplay" },
  "level-name": { defaultValue: "world", description: "The folder name containing the active world files.", category: "World" },
  "view-distance": { defaultValue: "10", description: "Number of chunks sent to the player (4-32).", category: "General" },
  "online-mode": { defaultValue: "true", description: "Verify players against Minecraft authentication servers.", category: "Network" },
};

export async function getServerPropertiesMap(instanceId?: string): Promise<Record<string, string>> {
  const base = getBackendBaseUrl();
  if (!base || !instanceId) {
    await delay(100);
    const mock: Record<string, string> = {};
    for (const [k, v] of Object.entries(defaultPropertyDefinitions)) {
      mock[k] = v.defaultValue;
    }
    return mock;
  }

  const res = await apiFetch(`${base}/api/instances/${encodeURIComponent(instanceId)}/properties`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to load properties: ${res.status}`);
  }
  return await res.json();
}

export async function getServerProperties(instanceId?: string): Promise<ServerProperty[]> {
  const base = getBackendBaseUrl();
  if (!base || !instanceId) {
    await delay(100);
    return Object.entries(defaultPropertyDefinitions).map(([name, def]) => ({
      name,
      value: def.defaultValue,
      defaultValue: def.defaultValue,
      description: def.description,
      category: def.category,
    }));
  }

  try {
    const data = await getServerPropertiesMap(instanceId);

    const list: ServerProperty[] = [];
    for (const [name, value] of Object.entries(data)) {
      const def = defaultPropertyDefinitions[name] || {
        defaultValue: value,
        description: `Configuration key for ${name}`,
        category: "General" as const,
      };
      list.push({
        name,
        value,
        defaultValue: def.defaultValue,
        description: def.description,
        category: def.category,
      });
    }

    return list;
  } catch (err) {
    console.error("Error fetching properties:", err);
    return Object.entries(defaultPropertyDefinitions).map(([name, def]) => ({
      name,
      value: def.defaultValue,
      defaultValue: def.defaultValue,
      description: def.description,
      category: def.category,
    }));
  }
}

export async function saveServerProperties(
  propertiesMap: Record<string, string>,
  instanceId?: string
): Promise<void> {
  const base = getBackendBaseUrl();
  if (!base || !instanceId) {
    await delay(100);
    return;
  }

  const res = await apiFetch(`${base}/api/instances/${encodeURIComponent(instanceId)}/properties`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(propertiesMap),
  });

  if (!res.ok) {
    throw new Error(`Failed to save properties: status ${res.status}`);
  }
}
