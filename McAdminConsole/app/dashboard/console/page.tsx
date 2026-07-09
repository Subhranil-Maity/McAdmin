"use client";

import React, { useEffect } from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import ConsoleTab from "@/components/dashboard/console-tab";

export default function DashboardConsolePage() {
  const {
    logs,
    commandInput,
    setCommandInput,
    handleSendCommand,
    consoleEndRef,
    lastCommandResponse,
  } = useDashboard();

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, consoleEndRef]);

  return (
    <ConsoleTab
      logs={logs}
      commandInput={commandInput}
      setCommandInput={setCommandInput}
      handleSendCommand={handleSendCommand}
      consoleEndRef={consoleEndRef}
      lastCommandResponse={lastCommandResponse}
    />
  );
}
