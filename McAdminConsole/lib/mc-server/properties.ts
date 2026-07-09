import { ServerProperty } from "./types";
import { delay } from "./utils";

const dummyProperties: ServerProperty[] = [
  { name: "difficulty", value: "hard", defaultValue: "easy", description: "Defines the game difficulty (peaceful, easy, normal, hard).", category: "Gameplay" },
  { name: "pvp", value: "true", defaultValue: "true", description: "Enable player vs player combat on the server.", category: "Gameplay" },
  { name: "max-players", value: "20", defaultValue: "20", description: "Maximum number of concurrent player connections.", category: "Network" },
  { name: "server-port", value: "25565", defaultValue: "25565", description: "The port number the server listens to.", category: "Network" },
  { name: "view-distance", value: "10", defaultValue: "10", description: "Number of chunks sent to the player (4-32).", category: "General" },
  { name: "spawn-monsters", value: "true", defaultValue: "true", description: "Controls whether monsters can spawn in the world.", category: "Gameplay" },
  { name: "level-name", value: "survival_world", defaultValue: "world", description: "The folder name containing the active world files.", category: "World" },
  { name: "motd", value: "§a§lMinecraft Admin Server Console", defaultValue: "A Minecraft Server", description: "Message of the Day displayed in the server browser.", category: "General" },
];

export async function getServerProperties(): Promise<ServerProperty[]> {
  await delay(100);
  return [...dummyProperties];
}

export async function updateServerProperty(name: string, value: string): Promise<void> {
  await delay(100);
  // No-op dummy implementation since mock database is removed
}
