"use client";

import React from "react";
import { useDashboard } from "./dashboard-context";
import OverviewTab from "./overview-tab";

export default function OverviewTabWrapper() {
  const { status, userRole } = useDashboard();
  return <OverviewTab status={status} userRole={userRole} />;
}
