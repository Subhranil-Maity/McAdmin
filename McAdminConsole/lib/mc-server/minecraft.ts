import { apiFetch, getBackendBaseUrl } from "./utils";

/** Error returned by the worker as `{ error: <code>, message }`. */
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  /** Upstream (Mojang/Fabric/Modrinth) unreachable: show a Retry button. */
  get isUnreachable(): boolean {
    return (
      this.code === "modrinth_unreachable" ||
      this.code === "fabric_unreachable" ||
      this.code === "version_list_unavailable" ||
      this.status === 0
    );
  }
}

export async function toApiError(res: Response, fallback: string): Promise<ApiError> {
  let code = "error";
  let message = `${fallback} (status ${res.status})`;
  try {
    const data = await res.json();
    if (data?.error) code = String(data.error);
    if (data?.message) message = String(data.message);
    else if (typeof data?.error === "string" && data.error.includes(" ")) message = data.error;
  } catch {}
  return new ApiError(res.status, code, message);
}

/** apiFetch that converts network failures into an `ApiError` with status 0. */
export async function apiJson<T>(url: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(url, init);
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the McAdmin worker");
  }
  if (!res.ok) throw await toApiError(res, fallback);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type ServerType = "vanilla" | "fabric" | "custom";
export type VersionStatus = "official" | "unknown";

export interface MinecraftVersion {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha" | string;
  release_time: string;
}

export interface MinecraftVersionsResponse {
  versions: MinecraftVersion[];
  latest_release?: string | null;
  latest_snapshot?: string | null;
  /** live = fresh from Mojang, cache = saved copy (Mojang unreachable or not refreshed yet). */
  source: "live" | "cache" | "none";
  fetched_at?: string | null;
}

export interface FabricVersion {
  version: string;
  stable: boolean;
}

export async function getMinecraftVersions(
  includeSnapshots = false,
  refresh = false
): Promise<MinecraftVersionsResponse> {
  const base = getBackendBaseUrl();
  const qs = new URLSearchParams();
  if (includeSnapshots) qs.set("include_snapshots", "true");
  if (refresh) qs.set("refresh", "true");
  return apiJson(`${base}/api/minecraft/versions?${qs}`, undefined, "Failed to load Minecraft versions");
}

export async function getFabricGames(includeSnapshots = false): Promise<FabricVersion[]> {
  const base = getBackendBaseUrl();
  const qs = includeSnapshots ? "?include_snapshots=true" : "";
  return apiJson(`${base}/api/minecraft/fabric/games${qs}`, undefined, "Failed to load Fabric versions");
}

export async function getFabricLoaders(game: string): Promise<FabricVersion[]> {
  const base = getBackendBaseUrl();
  return apiJson(
    `${base}/api/minecraft/fabric/loaders?game=${encodeURIComponent(game)}`,
    undefined,
    "Failed to load Fabric loaders"
  );
}
