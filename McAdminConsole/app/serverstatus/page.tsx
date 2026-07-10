"use client";

import React, { useState, useEffect, useRef } from "react";
import { useUser, SignOutButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Server,
  Wifi,
  WifiOff,
  Users,
  Play,
  LogOut,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  AlertTriangle
} from "lucide-react";
import { getServerStatus, ServerStatus } from "@/lib/mc-server";
import { Button } from "@/components/ui/button";

export default function ServerStatusPage() {
  const { user, isLoaded, isSignedIn } = useUser();
  const router = useRouter();

  // Telemetry States
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [isPhysicalServerOnline, setIsPhysicalServerOnline] = useState(true);
  const consecutiveFailuresRef = useRef(0);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Modal State
  const [showStartModal, setShowStartModal] = useState(false);

  // Redirect if not signed in
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace("/");
    }
  }, [isLoaded, isSignedIn, router]);

  // Status Polling Effect
  useEffect(() => {
    if (!isSignedIn) return;

    async function fetchStatus() {
      try {
        const latestStatus = await getServerStatus();
        setStatus(latestStatus);

        if (latestStatus.isReachable === false) {
          if (loadingInitial) {
            consecutiveFailuresRef.current = 3;
            setIsPhysicalServerOnline(false);
          } else {
            consecutiveFailuresRef.current += 1;
            if (consecutiveFailuresRef.current >= 3) {
              setIsPhysicalServerOnline(false);
            }
          }
        } else {
          consecutiveFailuresRef.current = 0;
          setIsPhysicalServerOnline(true);
        }
      } catch (err) {
        console.error("Error in status page polling:", err);
        if (loadingInitial) {
          consecutiveFailuresRef.current = 3;
          setIsPhysicalServerOnline(false);
        } else {
          consecutiveFailuresRef.current += 1;
          if (consecutiveFailuresRef.current >= 3) {
            setIsPhysicalServerOnline(false);
          }
        }
      } finally {
        setLoadingInitial(false);
      }
    }

    // Initial fetch
    fetchStatus();

    // Poll every 2.5 seconds
    const interval = setInterval(fetchStatus, 2500);
    return () => clearInterval(interval);
  }, [isSignedIn]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="flex-1 min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  // Determine status indicators
  const isMcServerOnline = isPhysicalServerOnline && status?.status === "ONLINE";
  const isMcServerStarting = isPhysicalServerOnline && status?.status === "STARTING";
  const isMcServerOffline = !isPhysicalServerOnline || status?.status === "OFFLINE";

  return (
    <div className="flex-1 min-h-screen bg-zinc-950 text-zinc-50 flex flex-col justify-center items-center py-12 px-4 relative overflow-hidden">
      {/* Decorative Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 rounded-full blur-[140px] bg-indigo-500/10 pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-[140px] bg-emerald-500/10 pointer-events-none" />

      {/* Main Container */}
      <div className="max-w-md w-full relative z-10 space-y-6 animate-fade-in">
        
        {/* Navigation Toolbar */}
        <div className="flex items-center justify-between px-1">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Home
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-mono">
              Role: NORMUSER
            </span>
          </div>
        </div>

        {/* Card Component */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/30 backdrop-blur-md shadow-2xl p-6 relative overflow-hidden">
          {/* Top colored accent line */}
          <div className={`absolute top-0 left-0 w-full h-[2px] ${
            isMcServerOnline
              ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600"
              : isMcServerStarting
              ? "bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600"
              : "bg-gradient-to-r from-rose-500 via-red-400 to-rose-600"
          }`} />

          {/* Heading */}
          <div className="space-y-1.5 text-center pb-6 border-b border-zinc-900">
            <div className="mx-auto w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.15)] mb-3">
              <Server className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-black tracking-tight text-white">Server Status</h2>
            <p className="text-xs text-zinc-500">Live hardware & game instance monitor</p>
          </div>

          {/* Telemetry Information */}
          <div className="py-6 space-y-4">
            {loadingInitial ? (
              <div className="flex flex-col items-center justify-center py-4 space-y-2">
                <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
                <span className="text-[10px] text-zinc-500 font-mono tracking-wider uppercase">Fetching Status...</span>
              </div>
            ) : (
              <>
                {/* Physical Server Connection Status */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/40 border border-zinc-900">
                  <div className="flex items-center gap-2.5">
                    {isPhysicalServerOnline ? (
                      <Wifi className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-rose-400" />
                    )}
                    <span className="text-xs font-semibold text-zinc-300">Physical Host Link</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    isPhysicalServerOnline
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                  }`}>
                    {isPhysicalServerOnline ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>

                {/* Minecraft Instance Status */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/40 border border-zinc-900">
                  <div className="flex items-center gap-2.5">
                    <Server className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-zinc-300">Minecraft Instance</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      isMcServerOnline
                        ? "bg-emerald-400 shadow-[0_0_6px_#10b981]"
                        : isMcServerStarting
                        ? "bg-amber-400 animate-pulse"
                        : "bg-rose-400 shadow-[0_0_6px_#f43f5e]"
                    }`} />
                    <span className={`text-xs font-extrabold uppercase ${
                      isMcServerOnline
                        ? "text-emerald-400"
                        : isMcServerStarting
                        ? "text-amber-400"
                        : "text-rose-400"
                    }`}>
                      {isPhysicalServerOnline ? (status?.status || "OFFLINE") : "OFFLINE"}
                    </span>
                  </div>
                </div>

                {/* Player counts (Show only if physical server is reachable) */}
                {isPhysicalServerOnline && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/40 border border-zinc-900">
                    <div className="flex items-center gap-2.5">
                      <Users className="w-4 h-4 text-purple-400" />
                      <span className="text-xs font-semibold text-zinc-300">Online Players</span>
                    </div>
                    <span className="text-xs font-bold font-mono text-zinc-400">
                      {status?.activePlayers !== undefined ? `${status.activePlayers} / ${status.maxPlayers || 20}` : "0 / 20"}
                    </span>
                  </div>
                )}

                {/* IP address info */}
                {isPhysicalServerOnline && status && (
                  <div className="p-3 rounded-xl bg-zinc-950/40 border border-zinc-900 text-center space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">Server Connection IP</div>
                    <div className="text-xs font-bold font-mono text-indigo-400 selection:bg-indigo-500/20">
                      {status.ipAddress}:{status.port}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Action Footer */}
          <div className="pt-6 border-t border-zinc-900 flex flex-col gap-3">
            <Button
              onClick={() => setShowStartModal(true)}
              className="w-full py-4 rounded-xl text-xs font-extrabold bg-indigo-600 text-white hover:bg-indigo-500 hover:shadow-[0_0_15px_rgba(99,102,241,0.4)] active:scale-[0.98] transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Start Server
            </Button>

            <SignOutButton>
              <button className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-semibold bg-zinc-950 border border-zinc-850 hover:bg-zinc-900 text-zinc-400 hover:text-white transition-all cursor-pointer">
                <LogOut className="w-3.5 h-3.5" />
                Sign Out Account
              </button>
            </SignOutButton>
          </div>

        </div>
      </div>

      {/* Modern custom Modal Dialog overlay */}
      {showStartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="max-w-sm w-full rounded-2xl border border-zinc-850 bg-zinc-900/90 backdrop-blur-md shadow-2xl p-6 relative overflow-hidden space-y-4">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-indigo-500 to-purple-600" />
            
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <AlertTriangle className="w-5 h-5" />
            </div>

            <div className="space-y-1">
              <h3 className="font-bold text-white text-base">Action Unwired</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                This start button is not currently wired up to trigger physical orchestration actions.
              </p>
            </div>

            <div className="pt-2">
              <Button
                onClick={() => setShowStartModal(false)}
                className="w-full py-2.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 cursor-pointer"
              >
                Dismiss Dialog
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
