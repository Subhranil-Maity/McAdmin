import { FileListResponse, FileContentResponse, FileWriteResponse } from "./types";
import { delay, getBackendBaseUrl, normalizePath, apiFetch, getAuthToken } from "./utils";

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
    { name: "server.properties", size: 1024, modified: "2026-07-09T11:15:00Z", type: "file", content: "motd=Minecraft Server\npvp=true\ndifficulty=hard\nmax-players=20\nserver-port=25565\n" },
  ],
  "/logs": [
    { name: "latest.log", size: 3072, modified: "2026-07-09T13:00:00Z", type: "file", content: "Done (4.2s)! For help, type \"help\"\n" },
  ],
};

export async function listServerFiles(
  path: string = "/",
  instanceId?: string
): Promise<FileListResponse> {
  const base = getBackendBaseUrl();
  if (!base) {
    await delay(150);
    const norm = normalizePath(path);
    const entries = staticFilesystem[norm] || [];
    return {
      path: norm,
      entries: entries.map((e) => ({
        name: e.name,
        size: e.size,
        modified: e.modified,
        type: e.type,
      })),
    };
  }

  const endpoint = instanceId
    ? `${base}/api/instances/${encodeURIComponent(instanceId)}/files?path=${encodeURIComponent(path)}`
    : `${base}/api/files?path=${encodeURIComponent(path)}`;

  const res = await apiFetch(endpoint, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to list files: status ${res.status}`);
  }
  return res.json();
}

export async function getServerFileContent(
  path: string,
  instanceId?: string
): Promise<FileContentResponse> {
  const base = getBackendBaseUrl();
  if (!base) {
    await delay(200);
    const norm = normalizePath(path);
    const idx = norm.lastIndexOf("/");
    const parent = normalizePath(idx === 0 ? "/" : norm.substring(0, idx));
    const filename = norm.substring(idx + 1);

    const folder = staticFilesystem[parent];
    const file = folder?.find((f) => f.name.toLowerCase() === filename.toLowerCase());

    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    return {
      path: norm,
      size: file.size,
      content: file.content || "",
    };
  }

  const endpoint = instanceId
    ? `${base}/api/instances/${encodeURIComponent(instanceId)}/files/content?path=${encodeURIComponent(path)}`
    : `${base}/api/files/content?path=${encodeURIComponent(path)}`;

  const res = await apiFetch(endpoint, { cache: "no-store" });
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
  force: boolean = false,
  instanceId?: string
): Promise<FileWriteResponse> {
  const base = getBackendBaseUrl();
  if (!base) {
    await delay(200);
    const norm = normalizePath(path);
    return { status: "ok", path: norm };
  }

  const endpoint = instanceId
    ? `${base}/api/instances/${encodeURIComponent(instanceId)}/files/write`
    : `${base}/api/files/write`;

  const res = await apiFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, force }),
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
  onProgress?: (pct: number) => void,
  instanceId?: string
): Promise<FileWriteResponse> {
  const base = getBackendBaseUrl();
  if (!base) {
    for (let pct = 0; pct <= 100; pct += 20) {
      onProgress?.(pct);
      await delay(100);
    }
    const norm = normalizePath(path);
    return { status: "ok", path: norm };
  }

  const endpoint = instanceId
    ? `${base}/api/instances/${encodeURIComponent(instanceId)}/files/upload`
    : `${base}/api/files/upload`;

  const token = await getAuthToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.withCredentials = true;
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

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
        } catch {
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
