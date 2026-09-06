import { ConsoleLog, CommandResponse } from "./types";
import { delay, getBackendBaseUrl, parseLogLine } from "./utils";
import { lastFetchedStatus } from "./status";

export const logsCache: { list: ConsoleLog[]; byInstance: Record<string, ConsoleLog[]> } = {
  list: [],
  byInstance: {},
};

const dummyLogs: ConsoleLog[] = [
  { timestamp: "19:10:02", level: "INFO", message: "Starting minecraft server" },
  { timestamp: "19:10:05", level: "INFO", message: "Loading properties from server.properties" },
  { timestamp: "19:10:12", level: "INFO", message: "Done (6.5s)! For help, type \"help\"" },
];

export async function getConsoleLogs(instanceId?: string): Promise<ConsoleLog[]> {
  const base = getBackendBaseUrl();
  if (!base) {
    await delay(100);
    return dummyLogs;
  }

  const endpoint = instanceId
    ? `${base}/api/instances/${encodeURIComponent(instanceId)}/status`
    : `${base}/api/status`;

  try {
    const res = await fetch(endpoint, { cache: "no-store", credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.recent_logs)) {
        const parsed = data.recent_logs.map((line: string) => parseLogLine(line));
        logsCache.list = parsed;
        if (instanceId) {
          logsCache.byInstance[instanceId] = parsed;
        }
        return parsed;
      }
    }
  } catch (e) {
    console.error("Error loading console logs:", e);
  }

  if (instanceId && logsCache.byInstance[instanceId]) {
    return logsCache.byInstance[instanceId];
  }
  return logsCache.list;
}

export async function sendConsoleCommand(
  command: string,
  instanceId?: string
): Promise<CommandResponse> {
  await delay(150);
  const cleanCmd = command.trim().replace(/^\//, "");
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });

  const base = getBackendBaseUrl();
  if (!base) {
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
      response: "Error: Cannot execute command while server is offline.",
    };
  }

  let responseMessage = "";
  let status = "ok";
  let cmdValue = cleanCmd;

  const endpoint = instanceId
    ? `${base}/api/instances/${encodeURIComponent(instanceId)}/command`
    : `${base}/api/server/command`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cleanCmd }),
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();
    status = data.status || "ok";
    cmdValue = data.command || cleanCmd;
    responseMessage = data.response || "Command executed successfully.";
  } catch (e) {
    console.error("Error executing console command:", e);
    status = "error";
    responseMessage = `Error executing command: ${(e as Error).message}`;
  }

  const logEntry1 = {
    timestamp,
    level: "INFO" as const,
    message: `Console issued command: /${cleanCmd}`,
  };
  const logEntry2 = {
    timestamp,
    level: "INFO" as const,
    message: responseMessage,
  };

  logsCache.list.push(logEntry1, logEntry2);
  if (instanceId) {
    if (!logsCache.byInstance[instanceId]) {
      logsCache.byInstance[instanceId] = [];
    }
    logsCache.byInstance[instanceId].push(logEntry1, logEntry2);
  }

  return {
    status,
    command: cmdValue,
    response: responseMessage,
  };
}
