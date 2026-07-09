import { Plugin } from "./types";
import { delay } from "./utils";

const dummyPlugins: Plugin[] = [
  { id: "p1", name: "EssentialsX", version: "2.20.1", description: "Provides essential commands and features.", enabled: true },
  { id: "p2", name: "WorldEdit", version: "7.2.14", description: "In-game map editor and schematic brush.", enabled: true },
  { id: "p3", name: "LuckPerms", version: "5.4.102", description: "Advanced permissions management plugin.", enabled: true },
  { id: "p4", name: "Vault", version: "1.7.3", description: "Common economy & permission API hook.", enabled: true },
  { id: "p5", name: "Dynmap", version: "3.4-beta", description: "Google-like map viewer for your server.", enabled: false },
];

export async function getPlugins(): Promise<Plugin[]> {
  await delay(100);
  return [...dummyPlugins];
}

export async function togglePluginState(pluginId: string, enabled: boolean): Promise<void> {
  await delay(100);
  // No-op dummy implementation since mock database is removed
}
