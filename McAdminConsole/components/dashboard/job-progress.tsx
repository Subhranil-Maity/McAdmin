"use client";

import React from "react";
import { CheckCircle2, Clock, Loader2, XCircle, X } from "lucide-react";
import { JobInfo } from "@/lib/mc-server";

interface JobProgressProps {
  job: JobInfo;
  onDismiss?: () => void;
}

/** Progress bar for a background job (install, identify, modpack). */
export function JobProgress({ job, onDismiss }: JobProgressProps) {
  const running = job.state === "running";
  const failed = job.state === "failed";
  const pct = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : running ? 0 : 100;
  const waiting = running && job.waiting_secs > 0;

  return (
    <div
      className={`rounded-xl border p-3 space-y-2 ${
        failed
          ? "border-rose-500/20 bg-rose-500/5"
          : running
          ? "border-indigo-500/20 bg-indigo-500/5"
          : "border-emerald-500/20 bg-emerald-500/5"
      }`}
    >
      <div className="flex items-center gap-2">
        {running ? (
          waiting ? (
            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
          )
        ) : failed ? (
          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        )}
        <span className="text-xs font-bold text-zinc-100 flex-1 truncate">{job.title}</span>
        {job.total > 0 && (
          <span className="text-[10px] font-mono text-zinc-400">
            {Math.min(job.done, job.total)} / {job.total}
          </span>
        )}
        {!running && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-zinc-500 hover:text-zinc-200 p-0.5 rounded cursor-pointer"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {running && (
        <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              waiting ? "bg-amber-400" : job.total > 0 ? "bg-indigo-500" : "bg-indigo-500/60 animate-pulse"
            }`}
            style={{ width: job.total > 0 ? `${pct}%` : "100%" }}
          />
        </div>
      )}
      <p
        className={`text-[11px] break-words ${
          failed ? "text-rose-300" : waiting ? "text-amber-300" : "text-zinc-400"
        }`}
      >
        {job.message}
      </p>
    </div>
  );
}
