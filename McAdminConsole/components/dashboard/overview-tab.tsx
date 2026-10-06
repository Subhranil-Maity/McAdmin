"use client";

import React, { useState, useEffect } from "react";
import {
  Cpu,
  Activity,
  Database,
  Shield,
  HardDrive,
  Layers,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  Coffee,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServerStatus, formatUptime, updateInstance } from "@/lib/mc-server";
import { listJavaRuntimes, JavaRuntime } from "@/lib/mc-server/java";
import { JavaRuntimeOptions } from "@/components/dashboard/java-runtime-options";
import { useDashboard, METRICS_WINDOW } from "./dashboard-context";
import { Sparkline } from "./sparkline";
import { VersionPicker } from "./version-picker";

interface OverviewTabProps {
  status?: ServerStatus | null;
  userRole?: string;
}

export default function OverviewTab({ status: propStatus, userRole: propUserRole }: OverviewTabProps) {
  const context = useDashboard();
  const status = propStatus ?? context.status;
  const userRole = propUserRole ?? context.userRole;
  const { instanceId, instanceDetail, refreshInstanceDetail, refreshAllInstances, metricsHistory, allInstances } = context;
  const serverType = instanceDetail?.server_type ?? "custom";
  const isManaged = serverType === "vanilla" || serverType === "fabric";
  const versionStatus = allInstances.find((i) => i.id === instanceId)?.version_status;

  const [ramGb, setRamGb] = useState<number>(instanceDetail?.ram_gb ?? 2);
  const [versionInput, setVersionInput] = useState<string>(instanceDetail?.minecraft_version ?? "");
  const [javaRuntimes, setJavaRuntimes] = useState<JavaRuntime[]>([]);
  const [selectedJava, setSelectedJava] = useState<string>(instanceDetail?.java_runtime ?? "");
  const [loaderInput, setLoaderInput] = useState<string>(instanceDetail?.loader_version ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    listJavaRuntimes()
      .then((list) => setJavaRuntimes(list))
      .catch((err) => console.error("Failed to load Java runtimes:", err));
  }, []);

  useEffect(() => {
    if (instanceDetail) {
      if (instanceDetail.ram_gb) setRamGb(instanceDetail.ram_gb);
      if (instanceDetail.minecraft_version !== undefined) {
        setVersionInput(instanceDetail.minecraft_version || "");
      }
      if (instanceDetail.java_runtime !== undefined) {
        setSelectedJava(instanceDetail.java_runtime || "");
      }
      setLoaderInput(instanceDetail.loader_version || "");
    }
  }, [instanceDetail]);

  const currentRam = instanceDetail?.ram_gb ?? 2;
  const currentVersion = instanceDetail?.minecraft_version || "";
  const currentJava = instanceDetail?.java_runtime || "";
  const currentLoader = instanceDetail?.loader_version || "";
  const versionChanged = versionInput.trim() !== currentVersion;
  const loaderChanged = serverType === "fabric" && loaderInput !== currentLoader;
  const isDirty = ramGb !== currentRam || versionChanged || selectedJava !== currentJava || loaderChanged;

  const handleSaveConfig = async () => {
    if (!instanceId) return;
    setIsSaving(true);
    setSaveSuccess(null);
    setSaveError(null);
    try {
      const trimmedVersion = versionInput.trim();
      await updateInstance(instanceId, {
        ram_gb: ramGb,
        minecraft_version: trimmedVersion,
        java_runtime: selectedJava,
        ...(serverType === "fabric" ? { loader_version: loaderInput } : {}),
      });
      await refreshInstanceDetail();
      await refreshAllInstances();
      setSaveSuccess(
        isManaged && (versionChanged || loaderChanged)
          ? "Configuration saved! The matching server jar will be downloaded the next time the server starts."
          : "Configuration saved! If the server is running, restart it to apply RAM and Java runtime changes."
      );
      setTimeout(() => setSaveSuccess(null), 5000);
    } catch (err) {
      console.error("Failed to update instance config:", err);
      setSaveError(err instanceof Error ? err.message : "Failed to update configuration");
    } finally {
      setIsSaving(false);
    }
  };

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
            <Progress
              value={status?.cpu || 0}
              max={100}
              className="h-2 bg-zinc-800 [&>div]:bg-emerald-500 [&>div]:shadow-[0_0_10px_#10b981]"
            />
            <div>
              <Sparkline
                values={metricsHistory.map((p) => p.cpu)}
                max={100}
                slots={METRICS_WINDOW}
                className="text-emerald-400"
              />
              <p className="text-[10px] text-zinc-500 font-mono mt-1">last 60s</p>
            </div>
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
              <span className="text-xs text-zinc-500">/ {instanceDetail?.ram_gb ?? status?.ramMax ?? 8} GB</span>
            </div>
            <Progress
              value={status?.ramUsed || 0}
              max={instanceDetail?.ram_gb ?? status?.ramMax ?? 8}
              className="h-2 bg-zinc-800 [&>div]:bg-purple-500 [&>div]:shadow-[0_0_10px_#a855f7]"
            />
            <div>
              <Sparkline
                values={metricsHistory.map((p) => p.ramGb)}
                max={instanceDetail?.ram_gb ?? status?.ramMax ?? 8}
                slots={METRICS_WINDOW}
                className="text-purple-400"
              />
              <p className="text-[10px] text-zinc-500 font-mono mt-1">last 60s</p>
            </div>
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
            <Progress
              value={2.34}
              max={25}
              className="h-2 bg-zinc-800 [&>div]:bg-sky-400 [&>div]:shadow-[0_0_10px_#38bdf8]"
            />
          </CardContent>
        </Card>
      </div>

      {/* Instance Configuration Card (RAM Allocation & Minecraft Version) */}
      {instanceId && (
        <Card className="border-zinc-800 bg-zinc-900/30 backdrop-blur-md p-6 rounded-2xl">
          <CardHeader className="p-0 pb-4 border-b border-zinc-800/60 mb-6 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                <Sliders className="w-5 h-5 text-indigo-400" />
                Instance Configuration
              </CardTitle>
              <CardDescription className="text-xs text-zinc-500">
                Adjust runtime memory allocation and Minecraft game version
              </CardDescription>
            </div>
            {isDirty && (
              <span className="text-[11px] font-mono text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-md">
                Unsaved changes
              </span>
            )}
          </CardHeader>
          <CardContent className="p-0 space-y-6">
            {saveSuccess && (
              <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{saveSuccess}</span>
              </div>
            )}
            {saveError && (
              <div className="flex items-center gap-2 p-3 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-xs font-semibold shadow-[0_0_15px_rgba(244,63,94,0.15)]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* RAM Allocation */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                    <HardDrive className="w-4 h-4 text-purple-400" /> RAM Allocation
                  </label>
                  <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 rounded-lg">
                    {ramGb} GB
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="32"
                  step="1"
                  value={ramGb}
                  onChange={(e) => setRamGb(parseInt(e.target.value, 10))}
                  disabled={isSaving}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>1 GB</span>
                  <span>4 GB</span>
                  <span>8 GB</span>
                  <span>16 GB</span>
                  <span>32 GB</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[2, 4, 6, 8, 12, 16].map((gb) => (
                    <button
                      key={gb}
                      type="button"
                      onClick={() => setRamGb(gb)}
                      disabled={isSaving}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border transition-all cursor-pointer ${
                        ramGb === gb
                          ? "bg-indigo-600 text-white border-indigo-500 font-bold shadow-[0_0_10px_rgba(99,102,241,0.3)]"
                          : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {gb} GB
                    </button>
                  ))}
                </div>
              </div>

              {/* Minecraft Version */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                    <Layers className="w-4 h-4 text-emerald-400" /> Minecraft Version
                  </label>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">
                      {serverType === "vanilla" ? "Official" : serverType === "fabric" ? "Fabric" : "Custom JAR"}
                    </span>
                    {versionStatus === "unknown" && currentVersion && (
                      <span
                        title="Not in the official Minecraft release list (or the list couldn't be loaded)"
                        className="text-[10px] font-bold uppercase text-amber-300 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded"
                      >
                        Unknown
                      </span>
                    )}
                  </span>
                </div>
                {isManaged ? (
                  <>
                    <VersionPicker
                      serverType={serverType}
                      version={versionInput}
                      onVersionChange={setVersionInput}
                      loader={loaderInput}
                      onLoaderChange={setLoaderInput}
                      disabled={isSaving}
                      autoSelect={false}
                    />
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Changing the version downloads the matching official
                      {serverType === "fabric" ? " Minecraft and Fabric" : ""} server jar on the next start. Mods may need
                      updating for a new version.
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      type="text"
                      placeholder="1.20.4"
                      value={versionInput}
                      onChange={(e) => setVersionInput(e.target.value)}
                      disabled={isSaving}
                      className="bg-zinc-950 border-zinc-800 text-xs font-mono rounded-xl h-10 text-zinc-200 focus-visible:ring-indigo-500 placeholder:text-zinc-600"
                    />
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Custom JAR servers use the uploaded jar as-is; the version is a label used to pick Java. Any value is
                      allowed. Versions that aren&apos;t official releases are shown as &quot;unknown&quot;.
                    </p>
                  </>
                )}
              </div>

              {/* Java Runtime */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                    <Coffee className="w-4 h-4 text-amber-400" /> Java Runtime Environment
                  </label>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {javaRuntimes.some((r) => !r.managed) ? `${javaRuntimes.filter((r) => !r.managed).length} on host` : "Official downloads"}
                  </span>
                </div>
                <select
                  value={selectedJava}
                  onChange={(e) => setSelectedJava(e.target.value)}
                  disabled={isSaving}
                  className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer font-mono"
                >
                  <JavaRuntimeOptions runtimes={javaRuntimes} />
                </select>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Select the Java executable used to launch this Minecraft instance. Official Eclipse Temurin runtimes are downloaded automatically on first start (progress shown in the console).
                </p>
              </div>
            </div>

            {/* Bottom save action and warning */}
            <div className="pt-2 border-t border-zinc-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>RAM and Java runtime changes will take effect next time the server is restarted.</span>
              </p>
              <Button
                onClick={handleSaveConfig}
                disabled={isSaving || !isDirty}
                className={`h-9 px-5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                  isDirty && !isSaving
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white active:scale-[0.98] shadow-[0_0_15px_rgba(99,102,241,0.3)]"
                    : "bg-zinc-900 text-zinc-500 border border-zinc-800 cursor-not-allowed"
                }`}
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save Configuration
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-zinc-800 bg-zinc-900/20 p-6 flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="font-bold text-white text-lg">Server Details</h3>
            <div className="grid grid-cols-2 gap-4 text-xs font-mono text-zinc-400 pt-2">
              <div>
                IP Address: <span className="text-zinc-200">{status?.ipAddress}</span>
              </div>
              <div>
                Server Port: <span className="text-zinc-200">{status?.port}</span>
              </div>
              <div>
                Version: <span className="text-zinc-200">{status?.version || instanceDetail?.minecraft_version || "—"}</span>
              </div>
              <div>
                Uptime: <span className="text-zinc-200">{status ? formatUptime(status.uptime) : "—"}</span>
              </div>
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
