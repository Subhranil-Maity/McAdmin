import { Outlet, useParams } from "react-router";
import { DashboardProvider } from "@/components/dashboard/dashboard-context";
import DashboardClientLayout from "@/components/dashboard/dashboard-client-layout";

export default function InstanceDashboardLayout() {
  const { uuid = "" } = useParams<{ uuid: string }>();
  const isDev = import.meta.env.DEV;

  return (
    // Keyed by instance so switching servers resets all per-instance state,
    // matching the remount Next.js did when the dynamic segment changed.
    <DashboardProvider key={uuid} isDev={isDev} instanceId={uuid}>
      <DashboardClientLayout>
        <Outlet />
      </DashboardClientLayout>
    </DashboardProvider>
  );
}
