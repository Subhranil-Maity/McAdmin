"use client";

import React from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import WhitelistTab from "@/components/dashboard/whitelist-tab";

export default function DashboardWhitelistPage() {
  const {
    whitelist,
    newWhitelistName,
    setNewWhitelistName,
    handleAddWhitelist,
    handleRemoveWhitelist,
    whitelistLoading,
  } = useDashboard();

  return (
    <WhitelistTab
      whitelist={whitelist}
      newWhitelistName={newWhitelistName}
      setNewWhitelistName={setNewWhitelistName}
      handleAddWhitelist={handleAddWhitelist}
      handleRemoveWhitelist={handleRemoveWhitelist}
      whitelistLoading={whitelistLoading}
    />
  );
}
