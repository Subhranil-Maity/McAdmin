import { getBackendBaseUrl, apiFetch } from "./utils";

export interface JavaRuntime {
  id: string;
  name: string;
  path: string;
  is_default: boolean;
  version_detected?: string;
  is_valid: boolean;
}

export async function listJavaRuntimes(): Promise<JavaRuntime[]> {
  const base = getBackendBaseUrl();
  if (!base) {
    return [
      {
        id: "java-21",
        name: "Java 21 (OpenJDK 21.0.6)",
        path: "/usr/lib/jvm/java-21-openjdk/bin/java",
        is_default: true,
        version_detected: "21.0.6",
        is_valid: true,
      },
      {
        id: "default",
        name: "System Default (java)",
        path: "java",
        is_default: false,
        version_detected: "21.0.6",
        is_valid: true,
      },
    ];
  }

  const res = await apiFetch(`${base}/api/java-runtimes`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Java runtimes: ${res.status}`);
  }

  return res.json();
}

export async function scanJavaRuntimes(): Promise<JavaRuntime[]> {
  const base = getBackendBaseUrl();
  if (!base) return [];

  const res = await apiFetch(`${base}/api/java-runtimes/scan`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(`Failed to scan host Java runtimes: ${res.status}`);
  }

  return res.json();
}

export async function saveJavaRuntime(runtime: {
  id?: string;
  name: string;
  path: string;
  is_default?: boolean;
}): Promise<void> {
  const base = getBackendBaseUrl();
  if (!base) return;

  const res = await apiFetch(`${base}/api/java-runtimes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runtime),
  });

  if (!res.ok) {
    throw new Error(`Failed to save Java runtime: ${res.status}`);
  }
}

export async function deleteJavaRuntime(id: string): Promise<void> {
  const base = getBackendBaseUrl();
  if (!base) return;

  const res = await apiFetch(`${base}/api/java-runtimes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error(`Failed to delete Java runtime: ${res.status}`);
  }
}
