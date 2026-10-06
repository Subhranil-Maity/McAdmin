import { apiJson } from "./minecraft";
import { getBackendBaseUrl } from "./utils";
import type { InstanceDetail } from "./instances";
import type { ServerType } from "./minecraft";

export type ModrinthProjectType = "mod" | "datapack" | "resourcepack" | "modpack";
export type ContentKind = "mod" | "datapack" | "resourcepack";

export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string | null;
  author: string;
  downloads: number;
  follows: number;
  project_type: string;
  categories: string[];
  versions: string[];
  latest_version?: string;
  server_side?: string;
  client_side?: string;
}

export interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

export interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  size?: number;
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  version_type: string;
  date_published: string;
  files: ModrinthVersionFile[];
}

export interface SearchOptions {
  query?: string;
  projectType: ModrinthProjectType;
  gameVersion?: string;
  loader?: string;
  offset?: number;
  limit?: number;
  index?: "relevance" | "downloads" | "follows" | "newest" | "updated";
}

export async function searchModrinth(opts: SearchOptions): Promise<ModrinthSearchResponse> {
  const base = getBackendBaseUrl();
  const qs = new URLSearchParams({ project_type: opts.projectType });
  if (opts.query) qs.set("query", opts.query);
  if (opts.gameVersion) qs.set("game_version", opts.gameVersion);
  if (opts.loader) qs.set("loader", opts.loader);
  if (opts.offset) qs.set("offset", String(opts.offset));
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.index) qs.set("index", opts.index);
  return apiJson(`${base}/api/modrinth/search?${qs}`, undefined, "Modrinth search failed");
}

export async function getModrinthVersions(
  projectId: string,
  opts: { gameVersion?: string; loader?: string } = {}
): Promise<ModrinthVersion[]> {
  const base = getBackendBaseUrl();
  const qs = new URLSearchParams();
  if (opts.gameVersion) qs.set("game_version", opts.gameVersion);
  if (opts.loader) qs.set("loader", opts.loader);
  return apiJson(
    `${base}/api/modrinth/project/${encodeURIComponent(projectId)}/versions?${qs}`,
    undefined,
    "Failed to load versions"
  );
}

// ---------- jobs ----------

export interface JobInfo {
  id: string;
  instance_id: string;
  kind: "install" | "identify" | "modpack" | string;
  title: string;
  state: "running" | "done" | "failed";
  done: number;
  total: number;
  message: string;
  error?: string | null;
  waiting_secs: number;
  started_at: string;
  finished_at?: string | null;
  result?: unknown;
}

export async function getJob(jobId: string): Promise<JobInfo> {
  const base = getBackendBaseUrl();
  return apiJson(`${base}/api/jobs/${encodeURIComponent(jobId)}`, undefined, "Failed to load job");
}

export async function listInstanceJobs(instanceId: string): Promise<JobInfo[]> {
  const base = getBackendBaseUrl();
  return apiJson(`${base}/api/instances/${encodeURIComponent(instanceId)}/jobs`, undefined, "Failed to load jobs");
}

// ---------- installed content ----------

export interface ContentItem {
  kind: ContentKind;
  filename: string;
  size?: number | null;
  is_dir: boolean;
  status: "modrinth" | "identified" | "modpack" | "manual" | "unidentified";
  project_id?: string | null;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  has_icon: boolean;
  version_id?: string | null;
  version_number?: string | null;
  game_versions: string[];
  latest_version_id?: string | null;
  latest_version_number?: string | null;
  update_available: boolean;
  url?: string | null;
}

export interface InstalledModpack {
  project_id: string;
  version_id: string;
  version_number: string;
  name: string;
  minecraft_version: string;
  loader_version: string;
  installed_at: string;
}

export interface ContentListing {
  items: ContentItem[];
  level_name: string;
  last_identified?: string | null;
  last_update_check?: string | null;
  modpack?: InstalledModpack | null;
  server_type: ServerType;
  minecraft_version?: string | null;
  loader_version?: string | null;
}

const instanceUrl = (id: string, path: string) =>
  `${getBackendBaseUrl()}/api/instances/${encodeURIComponent(id)}${path}`;

export async function listContent(instanceId: string): Promise<ContentListing> {
  return apiJson(instanceUrl(instanceId, "/content"), undefined, "Failed to load installed content");
}

export function contentIconUrl(instanceId: string, projectId: string): string {
  return instanceUrl(instanceId, `/content/icon/${encodeURIComponent(projectId)}`);
}

export async function deleteContent(instanceId: string, kind: ContentKind, filename: string): Promise<void> {
  await apiJson(
    instanceUrl(instanceId, "/content"),
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, filename }),
    },
    "Failed to remove"
  );
}

export async function installContent(
  instanceId: string,
  versionId: string,
  kind: ContentKind
): Promise<{ job_id: string }> {
  return apiJson(
    instanceUrl(instanceId, "/content/install"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version_id: versionId, kind }),
    },
    "Failed to start install"
  );
}

export async function identifyContent(instanceId: string, force = false): Promise<{ job_id: string }> {
  return apiJson(
    instanceUrl(instanceId, "/content/identify"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    },
    "Failed to start identification"
  );
}

export async function installModpack(instanceId: string, versionId: string): Promise<{ job_id: string }> {
  return apiJson(
    instanceUrl(instanceId, "/modpack"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version_id: versionId }),
    },
    "Failed to start modpack install"
  );
}

export interface CreateModpackInstancePayload {
  name: string;
  version_id: string;
  ram_gb?: number;
  java_runtime?: string;
  server_port?: number;
  rcon_port?: number;
}

export async function createModpackInstance(
  payload: CreateModpackInstancePayload
): Promise<InstanceDetail & { job_id: string }> {
  return apiJson(
    `${getBackendBaseUrl()}/api/instances/modpack`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to create modpack server"
  );
}
