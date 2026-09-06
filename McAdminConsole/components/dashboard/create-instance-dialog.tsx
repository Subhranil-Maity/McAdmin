"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createInstance, InstanceSummary } from "@/lib/mc-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, X, Loader2, Server, HardDrive, Network, CheckCircle2 } from "lucide-react";

interface CreateInstanceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  existingInstances: InstanceSummary[];
  onCreated?: () => void;
}

export default function CreateInstanceDialog({
  isOpen,
  onClose,
  existingInstances,
  onCreated,
}: CreateInstanceDialogProps) {
  const router = useRouter();

  // Find next available ports
  const usedServerPorts = new Set(existingInstances.map((i) => i.server_port));
  const usedRconPorts = new Set(existingInstances.map((i) => i.rcon_port));

  let nextServerPort = 25565;
  while (usedServerPorts.has(nextServerPort)) {
    nextServerPort += 1;
  }

  let nextRconPort = 25575;
  while (usedRconPorts.has(nextRconPort)) {
    nextRconPort += 1;
  }

  const [name, setName] = useState("");
  const [minecraftVersion, setMinecraftVersion] = useState("1.20.4");
  const [ramGb, setRamGb] = useState(2);
  const [serverPort, setServerPort] = useState(nextServerPort);
  const [rconPort, setRconPort] = useState(nextRconPort);
  const [jarFile, setJarFile] = useState<File | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith(".jar")) {
        setJarFile(file);
        setError(null);
      } else {
        setError("Please upload a valid .jar file");
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.name.endsWith(".jar")) {
        setJarFile(file);
        setError(null);
      } else {
        setError("Please upload a valid .jar file");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Instance name is required");
      return;
    }
    if (!jarFile) {
      setError("A Minecraft server .jar file is required");
      return;
    }

    setIsLoading(true);
    setError(null);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("name", name.trim());
    if (minecraftVersion.trim()) {
      formData.append("minecraft_version", minecraftVersion.trim());
    }
    formData.append("ram_gb", ramGb.toString());
    formData.append("server_port", serverPort.toString());
    formData.append("rcon_port", rconPort.toString());
    formData.append("file", jarFile);

    try {
      const created = await createInstance(formData, (pct) => {
        setUploadProgress(pct);
      });

      onCreated?.();
      onClose();
      router.push(`/dashboard/${created.id}`);
    } catch (err: unknown) {
      console.error("Failed to create instance:", err);
      const msg = err instanceof Error ? err.message : "Failed to create server instance";
      setError(msg);
      setIsLoading(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in select-none">
      <Card className="max-w-lg w-full border-zinc-800 bg-zinc-900 shadow-2xl relative overflow-hidden">
        {/* Top gradient accent line */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

        <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold text-white">Create Minecraft Instance</CardTitle>
              <CardDescription className="text-xs text-zinc-400">
                Deploy a new isolated Minecraft server with custom JAR
              </CardDescription>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4 pt-4">
            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
                {error}
              </div>
            )}

            {/* Server Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300">Server Name</label>
              <Input
                type="text"
                placeholder="e.g. Survival SMP, Creative 1.20"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
                required
                className="bg-zinc-950 border-zinc-800 text-xs rounded-xl focus-visible:ring-indigo-500"
              />
            </div>

            {/* Minecraft Version */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                <span>Minecraft Version</span>
                <span className="text-[10px] text-zinc-500 font-mono">e.g. 1.20.4</span>
              </label>
              <Input
                type="text"
                placeholder="1.20.4"
                value={minecraftVersion}
                onChange={(e) => setMinecraftVersion(e.target.value)}
                disabled={isLoading}
                className="bg-zinc-950 border-zinc-800 text-xs font-mono rounded-xl placeholder:text-zinc-600 focus-visible:ring-indigo-500"
              />
            </div>

            {/* RAM Allocation */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                  RAM Allocation: <span className="text-indigo-400 font-bold">{ramGb} GB</span>
                </label>
              </div>
              <input
                type="range"
                min="1"
                max="16"
                step="1"
                value={ramGb}
                onChange={(e) => setRamGb(parseInt(e.target.value, 10))}
                disabled={isLoading}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>1 GB</span>
                <span>4 GB</span>
                <span>8 GB</span>
                <span>16 GB</span>
              </div>
            </div>

            {/* Ports */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                  <Network className="w-3.5 h-3.5 text-sky-400" /> Game Port
                </label>
                <Input
                  type="number"
                  value={serverPort}
                  onChange={(e) => setServerPort(parseInt(e.target.value, 10) || 25565)}
                  disabled={isLoading}
                  className="bg-zinc-950 border-zinc-800 text-xs font-mono rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                  <Network className="w-3.5 h-3.5 text-amber-400" /> RCON Port
                </label>
                <Input
                  type="number"
                  value={rconPort}
                  onChange={(e) => setRconPort(parseInt(e.target.value, 10) || 25575)}
                  disabled={isLoading}
                  className="bg-zinc-950 border-zinc-800 text-xs font-mono rounded-xl"
                />
              </div>
            </div>

            {/* JAR File Upload */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300">Server JAR File</label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => !isLoading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                  jarFile
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                    : "border-zinc-800 hover:border-zinc-700 bg-zinc-950/50 text-zinc-400"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jar"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {jarFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span className="text-xs font-semibold truncate">{jarFile.name}</span>
                    <span className="text-[10px] text-zinc-500">
                      ({(jarFile.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="w-5 h-5 mx-auto text-zinc-500 mb-1" />
                    <p className="text-xs font-semibold text-zinc-300">
                      Click or drag and drop your server <span className="text-indigo-400">.jar</span> here
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      Supports Paper, Purpur, Fabric, Vanilla, or Forge
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Progress Bar during upload */}
            {uploadProgress !== null && (
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Uploading JAR...</span>
                  <span className="font-mono font-bold text-indigo-400">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} max={100} className="h-1.5 bg-zinc-800 [&>div]:bg-indigo-500" />
              </div>
            )}

            {/* Footer buttons */}
            <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isLoading}
                className="text-xs rounded-xl border-zinc-800 hover:bg-zinc-800"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading || !name.trim() || !jarFile}
                className="text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Creating Instance...
                  </>
                ) : (
                  "Create & Launch"
                )}
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
