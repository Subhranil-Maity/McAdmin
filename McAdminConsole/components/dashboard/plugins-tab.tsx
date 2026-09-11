"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Plugin } from "@/lib/mc-server";

interface PluginsTabProps {
  plugins: Plugin[];
  handleTogglePlugin: (pluginId: string, enabled: boolean) => void;
}

export default function PluginsTab({
  plugins,
  handleTogglePlugin,
}: PluginsTabProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {plugins.length > 0 ? (
        plugins.map((plugin) => (
          <Card
            key={plugin.id}
            className={`border-zinc-850 bg-zinc-900/10 p-5 rounded-2xl flex flex-col justify-between gap-4 hover:border-zinc-800 transition-all ${
              plugin.enabled ? "shadow-[0_0_10px_rgba(24,24,27,0.5)]" : "opacity-60"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <h4 className="font-bold text-white text-base flex items-center gap-2">
                  {plugin.name}
                  <span className="text-[10px] text-zinc-500 font-mono">v{plugin.version}</span>
                </h4>
                <p className="text-xs text-zinc-400 leading-relaxed">{plugin.description}</p>
              </div>

              <Switch
                checked={plugin.enabled}
                onCheckedChange={(val) => handleTogglePlugin(plugin.id, val)}
              />
            </div>

            <div className="flex items-center gap-2 border-t border-zinc-800/40 pt-3">
              <span className={`w-2 h-2 rounded-full ${plugin.enabled ? "bg-emerald-400" : "bg-rose-500"}`} />
              <span className="text-[10px] uppercase font-mono font-bold text-zinc-500">
                {plugin.enabled ? "Active" : "Disabled"}
              </span>
            </div>
          </Card>
        ))
      ) : (
        <div className="col-span-full text-center py-10 border border-dashed border-zinc-850 rounded-2xl bg-zinc-900/5">
          <p className="text-xs text-zinc-500">No plugins loaded on this server</p>
        </div>
      )}
    </div>
  );
}
