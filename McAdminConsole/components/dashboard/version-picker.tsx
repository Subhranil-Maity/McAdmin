"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ApiError,
  FabricVersion,
  MinecraftVersion,
  getFabricGames,
  getFabricLoaders,
  getMinecraftVersions,
} from "@/lib/mc-server";
import { RetryNotice } from "./retry-notice";

const selectClass =
  "w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer font-mono disabled:opacity-60";

interface VersionPickerProps {
  serverType: "vanilla" | "fabric";
  version: string;
  onVersionChange: (v: string) => void;
  loader?: string;
  onLoaderChange?: (v: string) => void;
  disabled?: boolean;
  /** Pick the latest release when `version` is empty or unavailable. */
  autoSelect?: boolean;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Official Minecraft version (and Fabric loader) selector with retry on network errors. */
export function VersionPicker({
  serverType,
  version,
  onVersionChange,
  loader,
  onLoaderChange,
  disabled,
  autoSelect = true,
}: VersionPickerProps) {
  const [snapshots, setSnapshots] = useState(false);
  const [versions, setVersions] = useState<string[]>([]);
  const [latest, setLatest] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loaders, setLoaders] = useState<FabricVersion[]>([]);
  const [loadersLoading, setLoadersLoading] = useState(false);
  const [loadersError, setLoadersError] = useState<string | null>(null);

  const loadVersions = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        if (serverType === "vanilla") {
          const res = await getMinecraftVersions(snapshots, refresh);
          const ids = res.versions.map((v: MinecraftVersion) => v.id);
          setVersions(ids);
          setLatest(res.latest_release ?? ids[0] ?? null);
          setSource(res.source);
        } else {
          const games = await getFabricGames(snapshots);
          const ids = games.map((g) => g.version);
          setVersions(ids);
          setLatest(games.find((g) => g.stable)?.version ?? ids[0] ?? null);
          setSource("live");
        }
      } catch (err) {
        setVersions([]);
        setError(
          err instanceof ApiError && err.isUnreachable
            ? `${serverType === "vanilla" ? "Mojang's version list" : "Fabric's version list"} could not be loaded: ${err.message}`
            : errMessage(err)
        );
      } finally {
        setLoading(false);
      }
    },
    [serverType, snapshots]
  );

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    if (!autoSelect || versions.length === 0) return;
    if (!version || !versions.includes(version)) {
      if (latest) onVersionChange(latest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, latest, autoSelect]);

  const loadLoaders = useCallback(async () => {
    if (serverType !== "fabric" || !version) return;
    setLoadersLoading(true);
    setLoadersError(null);
    try {
      const list = await getFabricLoaders(version);
      setLoaders(list);
      if (onLoaderChange && (!loader || !list.some((l) => l.version === loader))) {
        const stable = list.find((l) => l.stable) ?? list[0];
        if (stable) onLoaderChange(stable.version);
      }
    } catch (err) {
      setLoaders([]);
      setLoadersError(errMessage(err));
    } finally {
      setLoadersLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverType, version]);

  useEffect(() => {
    loadLoaders();
  }, [loadLoaders]);

  const options = version && !versions.includes(version) ? [version, ...versions] : versions;

  return (
    <div className="space-y-2">
      {error ? (
        <RetryNotice compact message={error} onRetry={() => loadVersions(true)} retrying={loading} />
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={version}
            onChange={(e) => onVersionChange(e.target.value)}
            disabled={disabled || loading}
            className={selectClass}
          >
            {loading && options.length === 0 && <option value="">Loading versions...</option>}
            {options.map((v) => (
              <option key={v} value={v}>
                {v}
                {v === latest ? "  (latest)" : ""}
                {!versions.includes(v) ? "  (unknown)" : ""}
              </option>
            ))}
          </select>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500 shrink-0" />}
        </div>
      )}
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={snapshots}
            onChange={(e) => setSnapshots(e.target.checked)}
            disabled={disabled}
            className="accent-indigo-500"
          />
          Show snapshots
        </label>
        {source === "cache" && !error && (
          <span className="text-amber-400/80">Offline: using saved version list</span>
        )}
      </div>

      {serverType === "fabric" && onLoaderChange && version && (
        <div className="space-y-1.5 pt-1">
          <label className="text-[11px] font-semibold text-zinc-400">Fabric loader</label>
          {loadersError ? (
            <RetryNotice compact message={loadersError} onRetry={loadLoaders} retrying={loadersLoading} />
          ) : (
            <select
              value={loader ?? ""}
              onChange={(e) => onLoaderChange(e.target.value)}
              disabled={disabled || loadersLoading}
              className={selectClass}
            >
              {loadersLoading && loaders.length === 0 && <option value="">Loading loaders...</option>}
              {loader && !loaders.some((l) => l.version === loader) && !loadersLoading && (
                <option value={loader}>{loader}</option>
              )}
              {loaders.map((l) => (
                <option key={l.version} value={l.version}>
                  {l.version}
                  {l.stable ? "  (stable)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
