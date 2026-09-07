import { getBackendBaseUrl, apiFetch, getAuthToken } from "./utils";

export interface InstanceSummary {
  id: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "STARTING";
  server_port: number;
  rcon_port: number;
  ram_gb: number;
  minecraft_version?: string;
  java_runtime?: string;
  created_at: string;
  owner_id?: string;
  admins: string[];
  users?: string[];
  role?: string;
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
  minecraft_version?: string;
  java_runtime?: string;
  created_at: string;
  owner_id?: string;
  admins: string[];
  users?: string[];
  role?: string;
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

  const res = await apiFetch(`${base}/api/instances`, {
    cache: "no-store",
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

  const res = await apiFetch(`${base}/api/instances/${encodeURIComponent(id)}`, {
    cache: "no-store",
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

  const token = await getAuthToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/api/instances`);
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

  const res = await apiFetch(`${base}/api/instances/${encodeURIComponent(id)}`, {
    method: "DELETE",
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

  const res = await apiFetch(`${base}/api/instances/${encodeURIComponent(id)}/admins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admins }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update instance admins: ${res.status}`);
  }

  return res.json();
}

export interface UpdateInstancePayload {
  ram_gb?: number;
  minecraft_version?: string;
  name?: string;
  java_runtime?: string;
}

export async function updateInstance(
  id: string,
  payload: UpdateInstancePayload
): Promise<InstanceDetail> {
  const base = getBackendBaseUrl();
  if (!base) {
    return {
      id,
      name: payload.name || "Demo Instance",
      folder: `instances/${id}`,
      jar_name: "server.jar",
      server_port: 25565,
      rcon_port: 25575,
      ram_gb: payload.ram_gb ?? 4,
      minecraft_version: payload.minecraft_version ? payload.minecraft_version.trim() : undefined,
      java_runtime: payload.java_runtime ? payload.java_runtime.trim() : undefined,
      created_at: new Date().toISOString(),
      admins: [],
    };
  }

  const cleanedPayload: UpdateInstancePayload = { ...payload };
  if (cleanedPayload.minecraft_version !== undefined) {
    cleanedPayload.minecraft_version = cleanedPayload.minecraft_version.trim();
  }
  if (cleanedPayload.java_runtime !== undefined) {
    cleanedPayload.java_runtime = cleanedPayload.java_runtime.trim();
  }

  const res = await apiFetch(`${base}/api/instances/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cleanedPayload),
  });

  if (!res.ok) {
    throw new Error(`Failed to update instance: ${res.status}`);
  }

  return res.json();
}

export interface MemberInfo {
  id: string;
  username: string;
}

export interface InstanceMembersResponse {
  owner: MemberInfo | null;
  admins: MemberInfo[];
  users: MemberInfo[];
}

export async function getInstanceMembers(instanceId: string): Promise<InstanceMembersResponse> {
  const base = getBackendBaseUrl();
  const res = await apiFetch(`${base}/api/instances/${encodeURIComponent(instanceId)}/members`);
  if (!res.ok) {
    throw new Error(`Failed to fetch instance members: ${res.status}`);
  }
  return res.json();
}

export async function addInstanceMember(
  instanceId: string,
  userId: string,
  role: "admin" | "user"
): Promise<void> {
  const base = getBackendBaseUrl();
  const res = await apiFetch(`${base}/api/instances/${encodeURIComponent(instanceId)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, role }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to add member: ${res.status}`);
  }
}

export async function removeInstanceMember(instanceId: string, userId: string): Promise<void> {
  const base = getBackendBaseUrl();
  const res = await apiFetch(
    `${base}/api/instances/${encodeURIComponent(instanceId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to remove member: ${res.status}`);
  }
}

export async function transferInstanceOwnership(instanceId: string, newOwnerId: string): Promise<void> {
  const base = getBackendBaseUrl();
  const res = await apiFetch(`${base}/api/instances/${encodeURIComponent(instanceId)}/transfer-ownership`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_owner_id: newOwnerId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to transfer ownership: ${res.status}`);
  }
}

