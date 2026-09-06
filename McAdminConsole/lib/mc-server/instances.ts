import { getBackendBaseUrl } from "./utils";

export interface InstanceSummary {
  id: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "STARTING";
  server_port: number;
  rcon_port: number;
  ram_gb: number;
  created_at: string;
  owner_id?: string;
  admins: string[];
  active_players: number;
  max_players: number;
  is_running: boolean;
}

export interface InstanceDetail {
  id: string;
  name: string;
  folder: string;
  jar_name: string;
  server_port: number;
  rcon_port: number;
  rcon_password?: string;
  ram_gb: number;
  created_at: string;
  owner_id?: string;
  admins: string[];
}

export async function listInstances(): Promise<InstanceSummary[]> {
  const base = getBackendBaseUrl();
  if (!base) {
    return [
      {
        id: "demo-instance-1",
        name: "Demo Survival World",
        status: "ONLINE",
        server_port: 25565,
        rcon_port: 25575,
        ram_gb: 4,
        created_at: new Date().toISOString(),
        admins: [],
        active_players: 2,
        max_players: 20,
        is_running: true,
      },
    ];
  }

  const res = await fetch(`${base}/api/instances`, {
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Failed to list instances: ${res.status}`);
  }

  return res.json();
}

export async function getInstance(id: string): Promise<InstanceDetail> {
  const base = getBackendBaseUrl();
  if (!base) {
    return {
      id,
      name: "Demo Survival World",
      folder: `instances/${id}`,
      jar_name: "server.jar",
      server_port: 25565,
      rcon_port: 25575,
      ram_gb: 4,
      created_at: new Date().toISOString(),
      admins: [],
    };
  }

  const res = await fetch(`${base}/api/instances/${encodeURIComponent(id)}`, {
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Failed to get instance ${id}: ${res.status}`);
  }

  return res.json();
}

export async function createInstance(
  formData: FormData,
  onProgress?: (pct: number) => void
): Promise<InstanceDetail> {
  const base = getBackendBaseUrl();
  if (!base) {
    return {
      id: "demo-new-instance",
      name: (formData.get("name") as string) || "New Instance",
      folder: "instances/demo-new-instance",
      jar_name: "server.jar",
      server_port: 25566,
      rcon_port: 25576,
      ram_gb: 2,
      created_at: new Date().toISOString(),
      admins: [],
    };
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/api/instances`);
    xhr.withCredentials = true;

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
          reject(new Error("Invalid JSON response from server"));
        }
      } else {
        reject(new Error(`Failed to create instance: status ${xhr.status} ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during instance creation"));
    xhr.send(formData);
  });
}

export async function deleteInstance(id: string): Promise<void> {
  const base = getBackendBaseUrl();
  if (!base) return;

  const res = await fetch(`${base}/api/instances/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Failed to delete instance: status ${res.status}`);
  }
}

export async function updateInstanceAdmins(id: string, admins: string[]): Promise<InstanceDetail> {
  const base = getBackendBaseUrl();
  if (!base) {
    return {
      id,
      name: "Demo Server",
      folder: `instances/${id}`,
      jar_name: "server.jar",
      server_port: 25565,
      rcon_port: 25575,
      ram_gb: 4,
      created_at: new Date().toISOString(),
      admins,
    };
  }

  const res = await fetch(`${base}/api/instances/${encodeURIComponent(id)}/admins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admins }),
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Failed to update instance admins: ${res.status}`);
  }

  return res.json();
}
