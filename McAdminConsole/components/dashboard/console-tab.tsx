"use client";

import React from "react";
import { Terminal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConsoleLog, CommandResponse } from "@/lib/mc-server";

interface ConsoleTabProps {
  logs: ConsoleLog[];
  commandInput: string;
  setCommandInput: (val: string) => void;
  handleSendCommand: (e: React.FormEvent) => void;
  consoleEndRef: React.RefObject<HTMLDivElement | null>;
  lastCommandResponse?: CommandResponse | null;
}

export default function ConsoleTab({
  logs,
  commandInput,
  setCommandInput,
  handleSendCommand,
  consoleEndRef,
  lastCommandResponse,
}: ConsoleTabProps) {
  return (
    <Card className="border-zinc-850 bg-zinc-950 p-4 rounded-2xl flex flex-col shadow-2xl">
      {/* Terminal Window Output */}
      <div className="h-96 overflow-y-auto font-mono text-xs text-zinc-300 space-y-1.5 p-4 rounded-xl bg-black border border-zinc-900 scrollbar-thin scrollbar-thumb-zinc-800">
        {logs.length > 0 ? (
          logs.map((log, index) => {
            const isError = log.level === "ERROR";
            const isWarn = log.level === "WARN";
            const levelColor = isError ? "text-rose-500" : isWarn ? "text-amber-500" : "text-emerald-500";
            
            return (
              <div key={index} className="leading-5">
                <span className="text-zinc-600">[{log.timestamp}]</span>{" "}
                <span className={`font-semibold ${levelColor}`}>[{log.level}]</span>:{" "}
                <span>{log.message}</span>
              </div>
            );
          })
        ) : (
          <div className="text-zinc-500 italic">No console logs available...</div>
        )}
        <div ref={consoleEndRef} />
      </div>

      {/* Terminal Command Input Form */}
      <form onSubmit={handleSendCommand} className="flex gap-3 mt-4">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 font-mono text-sm">&gt;</span>
          <Input
            type="text"
            placeholder="Type a server command (e.g. /say Hello, /whitelist add Notch)..."
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            className="pl-7 bg-black border-zinc-850 rounded-xl text-zinc-200 placeholder-zinc-600 font-mono text-xs h-11 focus-visible:ring-zinc-800 focus-visible:border-zinc-800"
          />
        </div>
        <Button
          type="submit"
          className="px-5 rounded-xl text-xs font-semibold bg-white text-black hover:bg-zinc-200 transition-colors h-11 cursor-pointer flex items-center gap-1.5"
        >
          <Terminal className="w-3.5 h-3.5" />
          Send
        </Button>
      </form>

      {/* Formatted last command response display */}
      {lastCommandResponse && (
        <div className="mt-4 p-4 rounded-xl border border-zinc-900 bg-zinc-900/10 backdrop-blur-sm space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider font-mono">Last command telemetry</span>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${lastCommandResponse.status === "ok" ? "bg-emerald-400 shadow-[0_0_6px_#10b981]" : "bg-rose-500 shadow-[0_0_6px_#f43f5e]"}`} />
              <span className={`text-[10px] font-extrabold uppercase font-mono ${lastCommandResponse.status === "ok" ? "text-emerald-400" : "text-rose-400"}`}>
                {lastCommandResponse.status}
              </span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs font-mono pt-1">
            <div className="md:col-span-1">
              <span className="text-zinc-500">Command:</span>
              <p className="text-zinc-300 font-semibold mt-0.5 truncate">{lastCommandResponse.command}</p>
            </div>
            <div className="md:col-span-3">
              <span className="text-zinc-500">Response:</span>
              <p className="text-zinc-200 mt-0.5 whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-850">{lastCommandResponse.response}</p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
