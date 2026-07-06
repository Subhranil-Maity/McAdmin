"use client";

import React, { useState, useEffect } from "react";
import { FileText, Search, Save, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Helper function to normalize and retrieve backend API URL
const getBackendUrl = () => {
  const url = process.env.NEXT_PUBLIC_BACKEND_URL || "localhost:8000";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `http://${url}`;
};

export default function PropertiesTab() {
  const [properties, setProperties] = useState<Record<string, string>>({});
  const [editedProperties, setEditedProperties] = useState<Record<string, string>>({});
  const [propertySearch, setPropertySearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch properties from backend url
  const fetchProperties = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${getBackendUrl()}/api/server/properties`);
      if (!res.ok) {
        throw new Error(`Server returned status: ${res.status}`);
      }
      const data = await res.json();
      setProperties(data);
      setEditedProperties(data);
    } catch (err) {
      console.error("Could not load properties from API:", err);
      setErrorMessage("Failed to load server properties. Please check if your backend server is running and accessible.");
      setProperties({});
      setEditedProperties({});
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  }, []);

  // Update a single property value in state
  const handleInputChange = (key: string, value: string) => {
    setEditedProperties((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Submit full updated properties JSON to backend
  const handleSaveProperties = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const confirmed = window.confirm(
      "Are you sure you want to save the server properties? Changing values like server-port or level-name will require a server restart to take effect."
    );
    if (!confirmed) return;

    setIsSaving(true);
    try {
      const res = await fetch(`${getBackendUrl()}/api/server/properties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editedProperties),
      });

      if (!res.ok) {
        throw new Error(`Server returned error status: ${res.status}`);
      }

      setProperties(editedProperties);
      setSuccessMessage("Server properties saved successfully!");
      
      // Auto-hide success message after 4 seconds
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Failed to save properties:", err);
      setErrorMessage("Failed to save server properties. Please verify backend connection.");
    } finally {
      setIsSaving(false);
    }
  };

  // Check if any properties have been edited
  const isDirty = JSON.stringify(properties) !== JSON.stringify(editedProperties);

  // Filter keys alphabetically matching the search term
  const filteredKeys = Object.keys(editedProperties)
    .sort()
    .filter((key) => key.toLowerCase().includes(propertySearch.toLowerCase()));

  // Render Full Screen Loading State
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 gap-3 bg-zinc-950/20 border border-zinc-900 rounded-2xl p-6">
        <Loader2 className="w-8 h-8 text-zinc-500 animate-spin" />
        <span className="text-xs text-zinc-500 font-medium">Reading server.properties file...</span>
      </div>
    );
  }

  // Render Loading Failure / Retry Screen
  if (errorMessage && Object.keys(properties).length === 0) {
    return (
      <Card className="border-rose-500/20 bg-rose-500/5 p-6 rounded-2xl text-center max-w-md mx-auto my-8 shadow-xl">
        <CardHeader className="p-0 pb-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-2">
            <AlertCircle className="w-6 h-6" />
          </div>
          <CardTitle className="text-sm font-black text-rose-400">Failed to Load Properties</CardTitle>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          <p className="text-xs text-zinc-400 leading-relaxed">
            {errorMessage}
          </p>
          <Button
            onClick={fetchProperties}
            className="px-6 h-9 rounded-xl text-xs font-bold bg-zinc-900 hover:bg-zinc-850 text-zinc-200 border border-zinc-800 cursor-pointer transition-all active:scale-[0.98]"
          >
            Retry Connection
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Banner Message Alerts for Save Actions */}
      {successMessage && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold shadow-[0_0_15px_rgba(16,185,129,0.15)] transition-all">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-xs font-semibold shadow-[0_0_15px_rgba(244,63,94,0.15)] transition-all">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Filter and Save toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            type="text"
            placeholder="Search properties (pvp, max-players, motd)..."
            value={propertySearch}
            onChange={(e) => setPropertySearch(e.target.value)}
            className="pl-10 py-5 bg-zinc-900/30 border-zinc-850 rounded-xl text-sm placeholder-zinc-500 text-zinc-200 focus-visible:ring-zinc-700"
          />
        </div>
        
        <Button
          onClick={handleSaveProperties}
          disabled={isSaving || isLoading || !isDirty}
          className={`h-11 px-5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
            isDirty && !isSaving && !isLoading
              ? "bg-white text-black hover:bg-zinc-200 active:scale-[0.98]"
              : "bg-zinc-900 text-zinc-500 border border-zinc-850 cursor-not-allowed"
          }`}
        >
          {isSaving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Save Changes
        </Button>
      </div>

      {/* Properties list */}
      <Card className="border-zinc-850 bg-zinc-900/10 p-5 rounded-2xl">
        <CardHeader className="p-0 pb-4 border-b border-zinc-800/40">
          <CardTitle className="text-sm font-black text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-zinc-400" />
            server.properties Configuration
          </CardTitle>
        </CardHeader>
        
        <CardContent className="p-0 pt-4">
          {filteredKeys.length > 0 ? (
            <div className="space-y-3.5 divide-y divide-zinc-800/40 max-h-[60vh] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-900">
              {filteredKeys.map((key, idx) => (
                <div
                  key={key}
                  className={`flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                    idx > 0 ? "pt-3.5" : ""
                  }`}
                >
                  <div className="flex flex-col gap-0.5 max-w-sm w-full">
                    <span className="font-mono font-bold text-zinc-200 text-sm">{key}</span>
                  </div>

                  <div className="flex-1 max-w-md w-full">
                    <Input
                      type="text"
                      value={editedProperties[key]}
                      onChange={(e) => handleInputChange(key, e.target.value)}
                      className="bg-black border-zinc-850 rounded-lg text-xs font-mono w-full h-9 text-zinc-200 focus-visible:ring-zinc-800"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <FileText className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-xs text-zinc-500">No properties matches the search query</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
