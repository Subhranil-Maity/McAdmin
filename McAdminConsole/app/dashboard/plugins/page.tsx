"use client";

import React from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import PluginsTab from "@/components/dashboard/plugins-tab";

export default function DashboardPluginsPage() {
  const {
    plugins,
    handleTogglePlugin,
  } = useDashboard();

  return (
    <PluginsTab
      plugins={plugins}
      handleTogglePlugin={handleTogglePlugin}
    />
  );
}
