"use client";

import React, { useState, useEffect } from "react";
import { ServerOff, RefreshCw, AlertTriangle, Activity, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBackendBaseUrl } from "@/lib/mc-server/utils";
import { useAuth } from "@/lib/auth/auth-context";

export function BackendUnavailable() {
  const { checkBackendHealth } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const [lastCheck, setLastCheck] = useState<string>("");
  const backendUrl = getBackendBaseUrl();

  const handleRetry = async () => {
    setRetrying(true);
    setLastCheck(new Date().toLocaleTimeString());
    try {
      await checkBackendHealth();
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    setLastCheck(new Date().toLocaleTimeString());
    const interval = setInterval(async () => {
      setLastCheck(new Date().toLocaleTimeString());
      await checkBackendHealth();
    }, 4000);

    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="max-w-md w-full text-center space-y-6 p-8 rounded-2xl border border-rose-500/20 bg-zinc-900/60 backdrop-blur-md shadow-2xl relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-rose-500 via-amber-500 to-rose-600" />
        <div className="absolute -right-16 -top-16 w-32 h-32 rounded-full blur-[80px] bg-rose-500/10 pointer-events-none" />

        {/* Icon */}
        <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
          <ServerOff className="w-8 h-8 animate-pulse" />
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h2 className="text-2xl font-black tracking-tight text-white">Backend Unavailable</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            The web console cannot establish a connection to the <span className="text-zinc-200 font-medium">McAdminWorker</span> backend daemon.
          </p>
        </div>

        {/* Diagnostics Card */}
        <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/80 text-left space-y-2.5 text-xs font-mono">
          <div className="flex items-center justify-between text-zinc-400 pb-1.5 border-b border-zinc-900">
            <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <Activity className="w-3.5 h-3.5 text-amber-400" /> Connection Probe
            </span>
            <span className="flex items-center gap-1 text-[10px] text-rose-400 font-semibold bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping inline-block mr-0.5" />
              OFFLINE
            </span>
          </div>

          <div className="space-y-1 text-zinc-400">
            <div className="flex items-center justify-between">
              <span>TARGET URL:</span>
              <span className="text-zinc-200 font-medium truncate max-w-[200px]" title={backendUrl || "Not Configured"}>
                {backendUrl || "(NEXT_PUBLIC_BACKEND_URL missing)"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>LAST ATTEMPT:</span>
              <span className="text-zinc-300">{lastCheck || "Just now"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>AUTO-RETRY:</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <Wifi className="w-3 h-3" /> Every 4s
              </span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2 flex flex-col gap-2">
          <Button
            onClick={handleRetry}
            disabled={retrying}
            className="w-full py-2.5 px-4 rounded-xl font-semibold bg-zinc-100 text-zinc-950 hover:bg-white active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Checking Connection..." : "Retry Connection"}
          </Button>
          <p className="text-[11px] text-zinc-500">
            Ensure <code className="text-zinc-400">mc_admin_worker</code> is started on the server host.
          </p>
        </div>
      </div>
    </div>
  );
}
