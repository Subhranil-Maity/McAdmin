"use client";

import React from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

interface RetryNoticeProps {
  title?: string;
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  compact?: boolean;
}

/** Inline error for an unreachable upstream (Mojang, Fabric, Modrinth) with a Retry button. */
export function RetryNotice({ title, message, onRetry, retrying, compact }: RetryNoticeProps) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-300 ${
        compact ? "p-2.5 text-[11px]" : "p-4 text-xs"
      }`}
    >
      <AlertTriangle className={`${compact ? "w-3.5 h-3.5" : "w-4 h-4"} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0 space-y-0.5">
        {title && <p className="font-bold text-amber-200">{title}</p>}
        <p className="text-amber-300/80 break-words">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 font-semibold transition-colors disabled:opacity-60 cursor-pointer"
      >
        {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Retry
      </button>
    </div>
  );
}
