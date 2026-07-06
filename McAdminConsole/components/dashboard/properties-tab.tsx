"use client";

import React from "react";
import { FileText, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ServerProperty } from "@/lib/mc-server";

interface PropertiesTabProps {
  properties: ServerProperty[];
  propertySearch: string;
  setPropertySearch: (val: string) => void;
  handlePropertyChange: (name: string, value: string) => void;
}

export default function PropertiesTab({
  properties,
  propertySearch,
  setPropertySearch,
  handlePropertyChange,
}: PropertiesTabProps) {
  // Filter properties list
  const filteredProperties = properties.filter(
    (p) =>
      p.name.toLowerCase().includes(propertySearch.toLowerCase()) ||
      p.description.toLowerCase().includes(propertySearch.toLowerCase()) ||
      p.category.toLowerCase().includes(propertySearch.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <Input
          type="text"
          placeholder="Search properties (difficulty, pvp, port, motd)..."
          value={propertySearch}
          onChange={(e) => setPropertySearch(e.target.value)}
          className="pl-10 py-5 bg-zinc-900/30 border-zinc-850 rounded-xl text-sm placeholder-zinc-500 text-zinc-200 focus-visible:ring-zinc-700"
        />
      </div>

      {/* Properties list */}
      <Card className="border-zinc-850 bg-zinc-900/10 p-5 rounded-2xl">
        <div className="space-y-4 divide-y divide-zinc-800/40">
          {filteredProperties.length > 0 ? (
            filteredProperties.map((prop, idx) => {
              const isBool = prop.value === "true" || prop.value === "false";
              return (
                <div key={prop.name} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${idx > 0 ? "pt-4" : ""}`}>
                  <div className="space-y-0.5 max-w-lg">
                    <label className="font-bold text-zinc-200 text-sm font-mono">{prop.name}</label>
                    <p className="text-xs text-zinc-400">{prop.description}</p>
                    <span className="inline-block text-[9px] uppercase font-bold text-zinc-500 border border-zinc-800 px-1.5 py-0.2 rounded mt-1 bg-zinc-950 font-mono">
                      {prop.category}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {isBool ? (
                      <Switch
                        checked={prop.value === "true"}
                        onCheckedChange={(val) => handlePropertyChange(prop.name, val ? "true" : "false")}
                      />
                    ) : (
                      <Input
                        type="text"
                        value={prop.value}
                        onChange={(e) => handlePropertyChange(prop.name, e.target.value)}
                        className="bg-black border-zinc-850 rounded-lg text-xs w-48 text-right font-mono"
                      />
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-10">
              <FileText className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
              <p className="text-xs text-zinc-500">No properties matches the search</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
