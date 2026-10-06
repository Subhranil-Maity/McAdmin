"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpCircle,
  Boxes,
  FileArchive,
  Fingerprint,
  Image as ImageIcon,
  Layers,
  Loader2,
  Package,
  PackageCheck,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  ContentItem,
  ContentKind,
  ContentListing,
  ModrinthSearchHit,
  ModrinthVersion,
  contentIconUrl,
  deleteContent,
  identifyContent,
  installContent,
  installModpack,
  listContent,
} from "@/lib/mc-server";
import { useDashboard } from "./dashboard-context";
import { JobProgress } from "./job-progress";
import { ModrinthBrowser } from "./modrinth-browser";
import { AuthImage } from "./auth-image";
import { RetryNotice } from "./retry-notice";

type SubTab = "installed" | "mods" | "datapacks" | "resourcepack" | "modpack";

const KIND_LABEL: Record<ContentKind, string> = {
  mod: "Mods",
  datapack: "Datapacks",
  resourcepack: "Server resource pack",
};

const STATUS_BADGE: Record<ContentItem["status"], { label: string; className: string; title: string }> = {
  modrinth: {
    label: "Modrinth",
    className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    title: "Installed from Modrinth",
  },
  identified: {
    label: "Identified",
    className: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    title: "Matched to a Modrinth project by file hash",
  },
  modpack: {
    label: "Modpack",
    className: "text-purple-300 bg-purple-500/10 border-purple-500/20",
    title: "Installed as part of a modpack",
  },
  manual: {
    label: "Manual",
    className: "text-zinc-300 bg-zinc-500/10 border-zinc-500/20",
    title: "Not found on Modrinth",
  },
  unidentified: {
    label: "Unidentified",
    className: "text-amber-300 bg-amber-500/10 border-amber-500/20",
    title: "Not checked yet. Click \"Identify mods\".",
  },
};

function formatSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  return `${Math.round(secs / 86400)} d ago`;
}

export default function ContentTab() {
  const {
    instanceId,
    status,
    canReadFiles,
    canUploadFiles,
    canDeleteFiles,
    jobs,
    trackJob,
    dismissJob,
    jobsFinishedCount,
  } = useDashboard();

  const [listing, setListing] = useState<ContentListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SubTab>("installed");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [recheckAll, setRecheckAll] = useState(false);

  const load = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    setError(null);
    try {
      setListing(await listContent(instanceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    load();
  }, [load, jobsFinishedCount]);

  const isFabric = listing?.server_type === "fabric";
  const mcVersion = listing?.minecraft_version || null;
  const runningJob = jobs.find((j) => j.state === "running");
  const serverOffline = status?.status === "OFFLINE";

  const installedProjects = useMemo(
    () => new Set((listing?.items ?? []).map((i) => i.project_id).filter((p): p is string => Boolean(p))),
    [listing]
  );

  const counts = useMemo(() => {
    const c = { mod: 0, datapack: 0, resourcepack: 0, updates: 0, unidentified: 0 };
    for (const i of listing?.items ?? []) {
      c[i.kind] += 1;
      if (i.update_available) c.updates += 1;
      if (i.status === "unidentified") c.unidentified += 1;
    }
    return c;
  }, [listing]);

  if (!canReadFiles) {
    return (
      <div className="text-center py-16 text-xs text-zinc-500">
        You don&apos;t have permission to view this server&apos;s files.
      </div>
    );
  }

  const startJob = async (fn: () => Promise<{ job_id: string }>) => {
    setActionError(null);
    try {
      const { job_id } = await fn();
      trackJob(job_id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInstall = (kind: ContentKind) => async (version: ModrinthVersion) => {
    if (!instanceId) return;
    await startJob(() => installContent(instanceId, version.id, kind));
  };

  const handleModpack = async (version: ModrinthVersion, hit: ModrinthSearchHit) => {
    if (!instanceId) return;
    const ok = window.confirm(
      `Install ${hit.title} ${version.version_number}?\n\n` +
        `The server will switch to Minecraft ${version.game_versions[0] ?? "?"} with the pack's Fabric loader. ` +
        `Files from a previously installed modpack are replaced; worlds and mods you added yourself are kept.`
    );
    if (!ok) return;
    await startJob(() => installModpack(instanceId, version.id));
  };

  const handleRemove = async (item: ContentItem) => {
    if (!instanceId) return;
    const name = item.title || item.filename;
    if (!window.confirm(`Remove ${name}?`)) return;
    setBusyFile(`${item.kind}:${item.filename}`);
    setActionError(null);
    try {
      await deleteContent(instanceId, item.kind, item.filename);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyFile(null);
    }
  };

  const tabs: { id: SubTab; label: string; icon: React.ElementType; show: boolean }[] = [
    { id: "installed", label: "Installed", icon: PackageCheck, show: true },
    { id: "mods", label: "Mods", icon: Boxes, show: isFabric },
    { id: "datapacks", label: "Datapacks", icon: FileArchive, show: true },
    { id: "resourcepack", label: "Resource pack", icon: ImageIcon, show: true },
    { id: "modpack", label: "Modpack", icon: Layers, show: isFabric },
  ];

  const uploadReason = canUploadFiles ? undefined : "You need the Upload Files permission to install content.";

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="border-zinc-800 bg-zinc-900/30 p-5 rounded-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Package className="w-5 h-5 text-indigo-400" /> Mods &amp; Packs
            </h2>
            <p className="text-xs text-zinc-400">
              {listing ? (
                <>
                  <span className="uppercase font-mono text-zinc-300">{listing.server_type}</span>
                  {mcVersion && (
                    <>
                      {" "}
                      · Minecraft <span className="font-mono text-zinc-300">{mcVersion}</span>
                    </>
                  )}
                  {listing.loader_version && (
                    <>
                      {" "}
                      · Fabric loader <span className="font-mono text-zinc-300">{listing.loader_version}</span>
                    </>
                  )}
                </>
              ) : (
                "Loading..."
              )}
            </p>
            <p className="text-[11px] text-zinc-500">
              Everything is downloaded by the server itself. Installed info is saved locally, so it stays visible
              while Modrinth is offline. Last identified {timeAgo(listing?.last_identified)}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={recheckAll}
                onChange={(e) => setRecheckAll(e.target.checked)}
                className="accent-indigo-500"
              />
              Recheck all
            </label>
            <button
              type="button"
              onClick={() => instanceId && startJob(() => identifyContent(instanceId, recheckAll))}
              disabled={!canUploadFiles || Boolean(runningJob)}
              title={uploadReason ?? "Match installed jars to Modrinth projects by file hash and check for updates"}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Fingerprint className="w-3.5 h-3.5" /> Identify mods
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </Card>

      {/* Jobs */}
      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => (
            <JobProgress key={job.id} job={job} onDismiss={() => dismissJob(job.id)} />
          ))}
        </div>
      )}

      {actionError && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">{actionError}</div>
      )}

      {/* Sub tabs */}
      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors cursor-pointer ${
                tab === t.id
                  ? "border-indigo-500 text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {t.id === "installed" && listing && (
                <span className="text-[10px] font-mono text-zinc-500">{listing.items.length}</span>
              )}
            </button>
          ))}
      </div>

      {tab === "installed" && (
        <div className="space-y-5">
          {error && <RetryNotice message={error} onRetry={load} retrying={loading} />}
          {listing && counts.unidentified > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {counts.unidentified} file(s) haven&apos;t been identified yet. Click &quot;Identify mods&quot; to look them
              up on Modrinth.
            </div>
          )}
          {listing && counts.updates > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-sky-500/20 bg-sky-500/5 text-xs text-sky-300">
              <ArrowUpCircle className="w-4 h-4 shrink-0" />
              {counts.updates} update(s) available (checked {timeAgo(listing.last_update_check)}).
            </div>
          )}
          {listing?.modpack && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-purple-500/20 bg-purple-500/5 text-xs text-purple-200">
              <Layers className="w-4 h-4 shrink-0" />
              Modpack: <strong>{listing.modpack.name}</strong> {listing.modpack.version_number}
              <span className="text-purple-300/70">
                (Minecraft {listing.modpack.minecraft_version}, Fabric {listing.modpack.loader_version})
              </span>
            </div>
          )}

          {listing && listing.items.length === 0 && (
            <div className="text-center py-12 border border-dashed border-zinc-800 rounded-2xl text-xs text-zinc-500">
              Nothing installed yet.{" "}
              {isFabric ? "Browse the Mods tab to add some." : "Browse Datapacks or Resource pack to add content."}
            </div>
          )}

          {(["mod", "datapack", "resourcepack"] as ContentKind[]).map((kind) => {
            const items = (listing?.items ?? []).filter((i) => i.kind === kind);
            if (items.length === 0) return null;
            return (
              <div key={kind} className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 font-mono">
                  {KIND_LABEL[kind]} <span className="text-zinc-600">({items.length})</span>
                  {kind === "datapack" && listing && (
                    <span className="normal-case tracking-normal font-normal text-zinc-600">
                      {" "}
                      · {listing.level_name}/datapacks
                    </span>
                  )}
                </h3>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                  {items.map((item) => (
                    <InstalledRow
                      key={`${item.kind}:${item.filename}`}
                      instanceId={instanceId!}
                      item={item}
                      busy={busyFile === `${item.kind}:${item.filename}`}
                      canDelete={canDeleteFiles && !runningJob}
                      canUpdate={canUploadFiles && !runningJob}
                      onRemove={() => handleRemove(item)}
                      onUpdate={() =>
                        item.latest_version_id &&
                        instanceId &&
                        startJob(() => installContent(instanceId, item.latest_version_id!, item.kind))
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "mods" && isFabric && (
        <ModrinthBrowser
          projectType="mod"
          gameVersion={mcVersion}
          loader="fabric"
          onSelect={handleInstall("mod")}
          disabled={!canUploadFiles || Boolean(runningJob)}
          disabledReason={uploadReason ?? (runningJob ? "Wait for the current install to finish." : undefined)}
          installedProjectIds={installedProjects}
        />
      )}

      {tab === "datapacks" && (
        <div className="space-y-3">
          <p className="text-[11px] text-zinc-500">
            Datapacks go into <span className="font-mono text-zinc-400">{listing?.level_name ?? "world"}/datapacks</span>.
            Run <span className="font-mono text-zinc-400">/reload</span> or restart the server to load them.
          </p>
          <ModrinthBrowser
            projectType="datapack"
            gameVersion={mcVersion}
            loader="datapack"
            onSelect={handleInstall("datapack")}
            disabled={!canUploadFiles || Boolean(runningJob)}
            disabledReason={uploadReason ?? (runningJob ? "Wait for the current install to finish." : undefined)}
            installedProjectIds={installedProjects}
          />
        </div>
      )}

      {tab === "resourcepack" && (
        <div className="space-y-3">
          <p className="text-[11px] text-zinc-500">
            Dedicated servers offer one resource pack to players. Installing sets{" "}
            <span className="font-mono text-zinc-400">resource-pack</span> and{" "}
            <span className="font-mono text-zinc-400">resource-pack-sha1</span> in server.properties to the Modrinth
            download, replacing any current pack. Restart the server to apply.
          </p>
          <ModrinthBrowser
            projectType="resourcepack"
            gameVersion={mcVersion}
            onSelect={handleInstall("resourcepack")}
            actionLabel="Set as server pack"
            disabled={!canUploadFiles || Boolean(runningJob)}
            disabledReason={uploadReason ?? (runningJob ? "Wait for the current install to finish." : undefined)}
            installedProjectIds={installedProjects}
          />
        </div>
      )}

      {tab === "modpack" && isFabric && (
        <div className="space-y-3">
          {listing?.modpack && (
            <p className="text-xs text-zinc-300">
              Currently installed: <strong>{listing.modpack.name}</strong> {listing.modpack.version_number}
            </p>
          )}
          <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[11px] text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Installing a modpack switches this server to the pack&apos;s Minecraft and Fabric versions and replaces the
              files of any previously installed pack. Worlds and mods you added yourself are kept. Mods you added may
              not work with the pack&apos;s Minecraft version. The server must be stopped first.
            </span>
          </div>
          <ModrinthBrowser
            projectType="modpack"
            loader="fabric"
            onSelect={handleModpack}
            disabled={!canUploadFiles || !serverOffline || Boolean(runningJob)}
            disabledReason={
              uploadReason ??
              (!serverOffline
                ? "Stop the server before installing a modpack."
                : runningJob
                ? "Wait for the current install to finish."
                : undefined)
            }
            installedProjectIds={installedProjects}
          />
        </div>
      )}
    </div>
  );
}

interface InstalledRowProps {
  instanceId: string;
  item: ContentItem;
  busy: boolean;
  canDelete: boolean;
  canUpdate: boolean;
  onRemove: () => void;
  onUpdate: () => void;
}

function InstalledRow({ instanceId, item, busy, canDelete, canUpdate, onRemove, onUpdate }: InstalledRowProps) {
  const badge = STATUS_BADGE[item.status];
  const fallbackIcon = (
    <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
      <Package className="w-4 h-4 text-zinc-500" />
    </div>
  );
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-zinc-800 bg-zinc-950/40">
      {item.has_icon && item.project_id ? (
        <AuthImage
          src={contentIconUrl(instanceId, item.project_id)}
          alt=""
          className="w-9 h-9 rounded-lg bg-zinc-800 object-cover shrink-0"
          fallback={fallbackIcon}
        />
      ) : (
        fallbackIcon
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-bold text-white truncate">{item.title || item.filename}</span>
          {item.version_number && (
            <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[10rem]">{item.version_number}</span>
          )}
          <span
            title={badge.title}
            className={`text-[9px] font-bold uppercase tracking-wide border px-1.5 py-0.5 rounded ${badge.className}`}
          >
            {badge.label}
          </span>
          {item.update_available && (
            <span className="text-[9px] font-bold uppercase tracking-wide border px-1.5 py-0.5 rounded text-sky-300 bg-sky-500/10 border-sky-500/20">
              Update: {item.latest_version_number}
            </span>
          )}
        </div>
        <p className="text-[10px] text-zinc-500 font-mono truncate" title={item.url ?? item.filename}>
          {item.filename}
          {item.size ? ` · ${formatSize(item.size)}` : ""}
          {item.is_dir ? " · folder" : ""}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {item.update_available && item.latest_version_id && (
          <button
            type="button"
            onClick={onUpdate}
            disabled={!canUpdate}
            title="Install the latest compatible version"
            className="p-1.5 rounded-lg text-sky-400 hover:bg-sky-500/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <ArrowUpCircle className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={!canDelete || busy}
          title={item.kind === "resourcepack" ? "Remove server resource pack" : "Delete file"}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
