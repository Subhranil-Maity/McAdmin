import { FileListResponse, FileContentResponse, FileWriteResponse } from "./types";
import { delay, normalizePath } from "./utils";

interface StaticFile {
  name: string;
  size: number;
  modified: string;
  type: "file" | "dir" | "symlink";
  content?: string;
}

const staticFilesystem: Record<string, StaticFile[]> = {
  "/": [
    { name: "plugins", size: 0, modified: "2026-07-09T12:00:00Z", type: "dir" },
    { name: "logs", size: 0, modified: "2026-07-09T10:30:00Z", type: "dir" },
    { name: "world", size: 0, modified: "2026-07-09T13:45:00Z", type: "dir" },
    { name: "server.properties", size: 1024, modified: "2026-07-09T11:15:00Z", type: "file", content: "motd=\\u00A7a\\u00A5lMinecraft Admin Server Console\\npvp=true\\ndifficulty=hard\\nmax-players=20\\nserver-port=25565\\nview-distance=10\\nspawn-monsters=true\\nlevel-name=survival_world\\n" },
    { name: "bukkit.yml", size: 512, modified: "2026-07-01T08:00:00Z", type: "file", content: "settings:\n  allow-end: true\n  warn-on-overload: true\n  query-plugins: true\n" },
    { name: "spigot.yml", size: 2048, modified: "2026-07-01T08:05:00Z", type: "file", content: "settings:\n  debug: false\n  save-user-cache-on-stop-only: false\n  bungeecord: false\nworld-settings:\n  default:\n    verbose: false\n    view-distance: default\n" },
    { name: "world_link", size: 0, modified: "2026-07-09T12:00:00Z", type: "symlink", content: "/world" },
  ],
  "/plugins": [
    { name: "Essentials", size: 0, modified: "2026-07-09T12:00:00Z", type: "dir" },
    { name: "LuckPerms", size: 0, modified: "2026-07-09T12:00:00Z", type: "dir" },
    { name: "EssentialsX.jar", size: 1258291, modified: "2026-07-05T15:20:00Z", type: "file" },
    { name: "LuckPerms.jar", size: 2451000, modified: "2026-07-05T15:21:00Z", type: "file" },
  ],
  "/plugins/Essentials": [
    { name: "config.yml", size: 4096, modified: "2026-07-09T12:00:00Z", type: "file", content: "# EssentialsX Configuration\n# If enabled, player commands are monitored.\nenabled: true\nlocale: en\nops-name-color: 'c'\nnickname-prefix: '~'\nmax-nick-length: 15\n" },
    { name: "userdata", size: 0, modified: "2026-07-09T12:00:00Z", type: "dir" },
  ],
  "/plugins/Essentials/userdata": [
    { name: "notch.yml", size: 256, modified: "2026-07-09T12:10:00Z", type: "file", content: "lastAccountName: Notch\nlogoutLocation:\n  world: survival_world\n  x: 104.5\n  y: 64.0\n  z: -250.3\n" },
  ],
  "/plugins/LuckPerms": [
    { name: "config.yml", size: 1024, modified: "2026-07-09T12:00:00Z", type: "file", content: "server: global\nstorage-method: h2\nsplit-storage:\n  enabled: false\n" },
  ],
  "/logs": [
    { name: "latest.log", size: 3072, modified: "2026-07-09T13:00:00Z", type: "file", content: "[13:00:01] [Server thread/INFO]: Starting minecraft server version 1.20.4\n[13:00:02] [Server thread/INFO]: Loading properties from server.properties\n[13:00:05] [Server thread/INFO]: Done (4.2s)! For help, type \"help\"\n" },
  ],
  "/world": [
    { name: "level.dat", size: 40960, modified: "2026-07-09T13:45:00Z", type: "file" },
    { name: "region", size: 0, modified: "2026-07-09T13:45:00Z", type: "dir" },
  ],
  "/world/region": [
    { name: "r.0.0.mca", size: 1048576, modified: "2026-07-09T13:45:00Z", type: "file" },
  ],
};

export async function listServerFiles(path: string = "/"): Promise<FileListResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(150);
    const norm = normalizePath(path);
    const entries = staticFilesystem[norm];
    if (!entries) {
      throw new Error(`Directory not found: ${path}`);
    }
    return {
      path: norm,
      entries: entries.map(e => ({
        name: e.name,
        size: e.size,
        modified: e.modified,
        type: e.type
      }))
    };
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to list files: status ${res.status}`);
  }
  return res.json();
}

export async function getServerFileContent(path: string): Promise<FileContentResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(200);
    const norm = normalizePath(path);
    const idx = norm.lastIndexOf("/");
    const parent = normalizePath(idx === 0 ? "/" : norm.substring(0, idx));
    const filename = norm.substring(idx + 1);

    const folder = staticFilesystem[parent];
    const file = folder?.find(f => f.name.toLowerCase() === filename.toLowerCase());

    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    if (file.type === "dir") {
      throw new Error("Specified path is a directory.");
    }

    const isBinary = filename.endsWith(".jar") || filename.endsWith(".dat") || filename.endsWith(".mca") || !file.content;
    if (isBinary) {
      throw new Error("Binary files are rejected.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("File size exceeds 5MB limit.");
    }

    return {
      path: norm,
      size: file.size,
      content: file.content || ""
    };
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/files/content?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error("File exceeds 5MB limit.");
    }
    if (res.status === 400) {
      throw new Error("Cannot open this file (is a directory or binary file).");
    }
    throw new Error(`Failed to read file: status ${res.status}`);
  }
  return res.json();
}

export async function writeServerFileContent(
  path: string,
  content: string,
  force: boolean = false
): Promise<FileWriteResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    await delay(200);
    const norm = normalizePath(path);
    return { status: "ok", path: norm };
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  const res = await fetch(`${base}/api/files/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, force })
  });

  if (!res.ok) {
    if (res.status === 409) {
      throw new Error("File exists. Set force=true to overwrite.");
    }
    throw new Error(`Failed to write file: status ${res.status}`);
  }

  return res.json();
}

export async function uploadServerFile(
  path: string,
  file: File,
  force: boolean = false,
  onProgress?: (pct: number) => void
): Promise<FileWriteResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    for (let pct = 0; pct <= 100; pct += 20) {
      onProgress?.(pct);
      await delay(100);
    }
    const norm = normalizePath(path);
    return { status: "ok", path: norm };
  }

  let base = backendUrl;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  base = base.replace(/\/+$/, "");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/api/files/upload`);

    if (onProgress && xhr.upload) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentage = Math.round((event.loaded * 100) / event.total);
          onProgress(percentage);
        }
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          resolve({ status: "ok", path });
        }
      } else {
        if (xhr.status === 409) {
          reject(new Error("File already exists. Force overwrite to replace it."));
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Network error during file upload."));

    const formData = new FormData();
    formData.append("path", path);
    formData.append("file", file);
    if (force) {
      formData.append("force", "true");
    }

    xhr.send(formData);
  });
}
