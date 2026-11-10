import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router";
import RootLayout from "@/app/layout";
import DashboardLayout from "@/app/dashboard/layout";
import InstanceDashboardLayout from "@/app/dashboard/[uuid]/layout";

// Route-level code splitting: each page is its own chunk.
const Home = lazy(() => import("@/app/page"));
const ServerStatusPage = lazy(() => import("@/app/serverstatus/page"));
const ManageUsersPage = lazy(() => import("@/app/manageuser/page"));
const DashboardPage = lazy(() => import("@/app/dashboard/page"));
const InstanceOverviewPage = lazy(() => import("@/app/dashboard/[uuid]/overview/page"));
const InstanceConsolePage = lazy(() => import("@/app/dashboard/[uuid]/console/page"));
const InstanceContentPage = lazy(() => import("@/app/dashboard/[uuid]/content/page"));
const InstanceFilesPage = lazy(() => import("@/app/dashboard/[uuid]/files/page"));
const InstancePlayersPage = lazy(() => import("@/app/dashboard/[uuid]/players/page"));
const InstancePropertiesPage = lazy(() => import("@/app/dashboard/[uuid]/properties/page"));
const InstanceWhitelistPage = lazy(() => import("@/app/dashboard/[uuid]/whitelist/page"));
const InstanceAdminsPage = lazy(() => import("@/app/dashboard/[uuid]/admins/page"));

function page(Component: ComponentType) {
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  );
}

/** Old pre-multi-instance dashboard tabs; they all bounce back to the server list. */
const LEGACY_DASHBOARD_TABS = [
  "console",
  "files",
  "overview",
  "players",
  "plugins",
  "properties",
  "whitelist",
];

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route index element={page(Home)} />
        <Route path="serverstatus" element={page(ServerStatusPage)} />
        <Route path="manageuser" element={page(ManageUsersPage)} />

        <Route path="dashboard" element={<DashboardLayout />}>
          <Route index element={page(DashboardPage)} />
          {LEGACY_DASHBOARD_TABS.map((tab) => (
            <Route key={tab} path={tab} element={<Navigate to="/dashboard" replace />} />
          ))}

          <Route path=":uuid" element={<InstanceDashboardLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={page(InstanceOverviewPage)} />
            <Route path="console" element={page(InstanceConsolePage)} />
            <Route path="content" element={page(InstanceContentPage)} />
            <Route path="files" element={page(InstanceFilesPage)} />
            <Route path="players" element={page(InstancePlayersPage)} />
            <Route path="properties" element={page(InstancePropertiesPage)} />
            <Route path="whitelist" element={page(InstanceWhitelistPage)} />
            <Route path="admins" element={page(InstanceAdminsPage)} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
