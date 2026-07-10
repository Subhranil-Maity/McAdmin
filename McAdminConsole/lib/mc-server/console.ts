import { ConsoleLog, CommandResponse } from "./types";
import { delay, getBackendStatusUrl, parseLogLine } from "./utils";
import { lastFetchedStatus } from "./status";

export const logsCache = {
  list: [] as ConsoleLog[],
};

const dummyLogs: ConsoleLog[] = [
  { timestamp: "19:10:02", level: "INFO", message: "Starting minecraft server version 1.20.4" },
  { timestamp: "19:10:05", level: "INFO", message: "Loading properties from server.properties" },
  { timestamp: "19:10:05", level: "INFO", message: "Default game type: SURVIVAL" },
  { timestamp: "19:10:06", level: "INFO", message: "Preparing level \"survival_world\"" },
  { timestamp: "19:10:10", level: "INFO", message: "Preparing start region for dimension minecraft:overworld" },
  { timestamp: "19:10:12", level: "INFO", message: "Done (6.5s)! For help, type \"help\"" },
  { timestamp: "19:11:45", level: "INFO", message: "Notch[/127.0.0.1:54321] logged in with entity id 128" },
  { timestamp: "19:11:46", level: "INFO", message: "Notch joined the game" },
  { timestamp: "19:13:20", level: "INFO", message: "Jeb_[/127.0.0.1:54322] logged in with entity id 256" },
  { timestamp: "19:13:21", level: "INFO", message: "Jeb_ joined the game" },
];

export async function getConsoleLogs(): Promise<ConsoleLog[]> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(100);
    return dummyLogs;
  }

  if (logsCache.list.length === 0) {
    try {
      const endpoint = getBackendStatusUrl();
      const res = await fetch(endpoint, { cache: "no-store", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.recent_logs)) {
          logsCache.list = data.recent_logs.map((line: string) => parseLogLine(line));
        }
      }
    } catch (e) {
      console.error("Error loading console logs:", e);
      // Propagate or return empty list (no dummy data if configured but down)
    }
  }

  return logsCache.list;
}

export async function sendConsoleCommand(command: string): Promise<CommandResponse> {
  await delay(150);
  const cleanCmd = command.trim().replace(/^\//, "");
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    return {
      status: "ok",
      command: cleanCmd,
      response: `[Dummy] Command "${cleanCmd}" executed.`,
    };
  }

  const isOnline = lastFetchedStatus?.status === "ONLINE";
  if (!isOnline) {
    return {
      status: "error",
      command: cleanCmd,
      response: "Error: Cannot execute command while server is offline."
    };
  }

  let responseMessage = "";
  let status = "ok";
  let cmdValue = cleanCmd;

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  try {
    const res = await fetch(`${base}/api/server/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: cleanCmd }),
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();
    status = data.status || "ok";
    cmdValue = data.command || cleanCmd;
    responseMessage = data.response || `Command executed successfully.`;
  } catch (e) {
    console.error("Error executing console command:", e);
    status = "error";
    responseMessage = `Error executing command: ${(e as Error).message}`;
  }

  const logEntry1 = { timestamp, level: "INFO" as const, message: `Console issued command: /${cleanCmd}` };
  const logEntry2 = { timestamp, level: "INFO" as const, message: responseMessage };
  logsCache.list.push(logEntry1, logEntry2);

  return {
    status,
    command: cmdValue,
    response: responseMessage,
  };
}
