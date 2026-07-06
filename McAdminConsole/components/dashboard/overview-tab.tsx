"use client";

import React from "react";
import { Cpu, Activity, Database, Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ServerStatus, formatUptime } from "@/lib/mc-server";

interface OverviewTabProps {
  status: ServerStatus | null;
  userRole: string;
}

export default function OverviewTab({ status, userRole }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* CPU Monitor */}
        <Card className="border-zinc-800 bg-zinc-900/30 backdrop-blur-md">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-white">CPU Utilisation</CardTitle>
              <CardDescription className="text-xs text-zinc-500">Processing load</CardDescription>
            </div>
            <Cpu className="w-5 h-5 text-emerald-400" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">{status?.cpu || 0}%</span>
              <span className="text-xs text-zinc-500">allocated cores</span>
            </div>
            <Progress value={status?.cpu || 0} max={100} className="h-2 bg-zinc-800 [&>div]:bg-emerald-500 [&>div]:shadow-[0_0_10px_#10b981]" />
          </CardContent>
        </Card>

        {/* RAM Monitor */}
        <Card className="border-zinc-800 bg-zinc-900/30 backdrop-blur-md">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-white">Memory Allocation</CardTitle>
              <CardDescription className="text-xs text-zinc-500">
                RAM usage telemetry
              </CardDescription>
            </div>
            <Activity className="w-5 h-5 text-purple-400" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">{status?.ramUsed || 0} GB</span>
              <span className="text-xs text-zinc-500">/ {status?.ramMax || 8} GB</span>
            </div>
            <Progress value={status?.ramUsed || 0} max={status?.ramMax || 8} className="h-2 bg-zinc-800 [&>div]:bg-purple-500 [&>div]:shadow-[0_0_10px_#a855f7]" />
          </CardContent>
        </Card>

        {/* Storage Monitor */}
        <Card className="border-zinc-800 bg-zinc-900/30 backdrop-blur-md">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-white">Disk Storage</CardTitle>
              <CardDescription className="text-xs text-zinc-500">Server files size</CardDescription>
            </div>
            <Database className="w-5 h-5 text-sky-400" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">2.34 GB</span>
              <span className="text-xs text-zinc-500">/ 25 GB</span>
            </div>
            <Progress value={2.34} max={25} className="h-2 bg-zinc-800 [&>div]:bg-sky-400 [&>div]:shadow-[0_0_10px_#38bdf8]" />
          </CardContent>
        </Card>

      </div>

      {/* Quick info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-zinc-800 bg-zinc-900/20 p-6 flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="font-bold text-white text-lg">Server Details</h3>
            <div className="grid grid-cols-2 gap-4 text-xs font-mono text-zinc-400 pt-2">
              <div>IP Address: <span className="text-zinc-200">{status?.ipAddress}</span></div>
              <div>Server Port: <span className="text-zinc-200">{status?.port}</span></div>
              <div>Engine: <span className="text-zinc-200">{status?.version}</span></div>
              <div>Uptime: <span className="text-zinc-200">{status ? formatUptime(status.uptime) : "—"}</span></div>
            </div>
          </div>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/20 p-6 flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="font-bold text-white text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-amber-500" /> Administrative Access
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              You are logged in with the <strong className="text-white uppercase">{userRole}</strong> role.
              You have full operations and management permissions in this panel.
            </p>
          </div>
          <div className="pt-2 text-[10px] text-zinc-500 uppercase font-mono tracking-wider">
            Access Level &bull; {userRole}
          </div>
        </Card>
      </div>
    </div>
  );
}
