"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Loader2, Package, Search, Check } from "lucide-react";
import {
  ApiError,
  ModrinthProjectType,
  ModrinthSearchHit,
  ModrinthVersion,
  getModrinthVersions,
  searchModrinth,
} from "@/lib/mc-server";
import { Input } from "@/components/ui/input";
import { RetryNotice } from "./retry-notice";

const PAGE_SIZE = 20;

interface ModrinthBrowserProps {
  projectType: ModrinthProjectType;
  /** Filter results and versions to this Minecraft version. */
  gameVersion?: string | null;
  /** Loader filter for versions ("fabric", "datapack"); omitted for resource packs. */
  loader?: string;
  /** Called with the chosen version; may be async. */
  onSelect: (version: ModrinthVersion, hit: ModrinthSearchHit) => void | Promise<void>;
  actionLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Project ids already installed (shows a badge). */
  installedProjectIds?: Set<string>;
  /** Highlights the selected version (create dialog). */
  selectedVersionId?: string | null;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function errText(err: unknown): string {
  if (err instanceof ApiError && err.isUnreachable) {
    return "Modrinth can't be reached right now. Check the worker's internet connection and try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function ModrinthBrowser({
  projectType,
  gameVersion,
  loader,
  onSelect,
  actionLabel = "Install",
  disabled,
  disabledReason,
  installedProjectIds,
  selectedVersionId,
}: ModrinthBrowserProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [index, setIndex] = useState<"relevance" | "downloads" | "updated">("relevance");
  const [hits, setHits] = useState<ModrinthSearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const runSearch = useCallback(
    async (offset: number) => {
      const req = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await searchModrinth({
          query: debounced,
          projectType,
          gameVersion: gameVersion || undefined,
          loader: projectType === "mod" || projectType === "modpack" ? "fabric" : undefined,
          offset,
          limit: PAGE_SIZE,
          index,
        });
        if (req !== requestRef.current) return;
        setHits((prev) => (offset === 0 ? res.hits : [...prev, ...res.hits]));
        setTotal(res.total_hits);
      } catch (err) {
        if (req !== requestRef.current) return;
        setError(errText(err));
      } finally {
        if (req === requestRef.current) setLoading(false);
      }
    },
    [debounced, projectType, gameVersion, index]
  );

  useEffect(() => {
    setExpanded(null);
    runSearch(0);
  }, [runSearch]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Don't submit a surrounding form (create dialog).
              if (e.key === "Enter") {
                e.preventDefault();
                setDebounced(query.trim());
              }
            }}
            placeholder={`Search Modrinth ${projectType === "resourcepack" ? "resource packs" : projectType + "s"}...`}
            className="pl-8 bg-zinc-950 border-zinc-800 text-xs rounded-xl focus-visible:ring-indigo-500"
          />
        </div>
        <select
          value={index}
          onChange={(e) => setIndex(e.target.value as typeof index)}
          className="bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
        >
          <option value="relevance">Relevance</option>
          <option value="downloads">Downloads</option>
          <option value="updated">Recently updated</option>
        </select>
      </div>

      {gameVersion && (
        <p className="text-[10px] text-zinc-500 font-mono">
          Showing projects for Minecraft {gameVersion}
          {projectType === "mod" || projectType === "modpack" ? " · Fabric" : ""}
        </p>
      )}

      {error && <RetryNotice message={error} onRetry={() => runSearch(0)} retrying={loading} />}

      {!error && hits.length === 0 && !loading && (
        <div className="text-center py-8 border border-dashed border-zinc-800 rounded-xl text-xs text-zinc-500">
          No results found
        </div>
      )}

      <div className="space-y-2">
        {hits.map((hit) => (
          <SearchResult
            key={hit.project_id}
            hit={hit}
            expanded={expanded === hit.project_id}
            onToggle={() => setExpanded((e) => (e === hit.project_id ? null : hit.project_id))}
            gameVersion={gameVersion}
            loader={loader}
            onSelect={onSelect}
            actionLabel={actionLabel}
            disabled={disabled}
            disabledReason={disabledReason}
            installed={installedProjectIds?.has(hit.project_id) ?? false}
            selectedVersionId={selectedVersionId}
          />
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-3">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
        </div>
      )}
      {!loading && !error && hits.length < total && (
        <button
          type="button"
          onClick={() => runSearch(hits.length)}
          className="w-full py-2 text-xs text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 rounded-xl transition-colors cursor-pointer"
        >
          Load more ({hits.length} of {formatCount(total)})
        </button>
      )}
    </div>
  );
}

interface SearchResultProps {
  hit: ModrinthSearchHit;
  expanded: boolean;
  onToggle: () => void;
  gameVersion?: string | null;
  loader?: string;
  onSelect: (version: ModrinthVersion, hit: ModrinthSearchHit) => void | Promise<void>;
  actionLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  installed: boolean;
  selectedVersionId?: string | null;
}

function SearchResult({
  hit,
  expanded,
  onToggle,
  gameVersion,
  loader,
  onSelect,
  actionLabel,
  disabled,
  disabledReason,
  installed,
  selectedVersionId,
}: SearchResultProps) {
  const [versions, setVersions] = useState<ModrinthVersion[] | null>(null);
  const [versionId, setVersionId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getModrinthVersions(hit.project_id, {
        gameVersion: gameVersion || undefined,
        loader,
      });
      setVersions(list);
      setVersionId(list[0]?.id ?? "");
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, [hit.project_id, gameVersion, loader]);

  useEffect(() => {
    if (expanded && versions === null && !loading) loadVersions();
  }, [expanded, versions, loading, loadVersions]);

  const selected = versions?.find((v) => v.id === versionId);
  const isSelected = Boolean(selectedVersionId && versions?.some((v) => v.id === selectedVersionId));

  const handleAction = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await onSelect(selected, hit);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-xl border transition-colors ${
        isSelected ? "border-indigo-500/50 bg-indigo-500/5" : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
      }`}
    >
      <button type="button" onClick={onToggle} className="w-full flex items-start gap-3 p-3 text-left cursor-pointer">
        {hit.icon_url ? (
          <img src={hit.icon_url} alt="" className="w-10 h-10 rounded-lg bg-zinc-800 object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-zinc-500" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-white">{hit.title}</span>
            <span className="text-[10px] text-zinc-500">by {hit.author}</span>
            {installed && (
              <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                Installed
              </span>
            )}
            {isSelected && (
              <span className="text-[9px] font-bold uppercase tracking-wide text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 px-1.5 py-0.5 rounded">
                Selected
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5">{hit.description}</p>
          <p className="text-[10px] text-zinc-500 font-mono mt-1 flex items-center gap-1">
            <Download className="w-3 h-3" /> {formatCount(hit.downloads)}
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-zinc-800/60">
          <div className="pt-3">
            {loading && (
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading versions...
              </div>
            )}
            {error && <RetryNotice compact message={error} onRetry={loadVersions} retrying={loading} />}
            {versions && versions.length === 0 && (
              <p className="text-[11px] text-amber-400">
                No compatible versions{gameVersion ? ` for Minecraft ${gameVersion}` : ""}.
              </p>
            )}
            {versions && versions.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={versionId}
                  onChange={(e) => setVersionId(e.target.value)}
                  className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer font-mono"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.version_number} · MC {v.game_versions.slice(-3).join(", ")}
                      {v.version_type !== "release" ? ` · ${v.version_type}` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAction}
                  disabled={disabled || busy || !selected}
                  title={disabled ? disabledReason : undefined}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {busy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : selectedVersionId === versionId ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  {actionLabel}
                </button>
              </div>
            )}
            {disabled && disabledReason && versions && versions.length > 0 && (
              <p className="text-[10px] text-zinc-500 mt-1.5">{disabledReason}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
