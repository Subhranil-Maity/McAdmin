import { DashboardProvider } from "@/components/dashboard/dashboard-context";
import DashboardClientLayout from "@/components/dashboard/dashboard-client-layout";

export default async function InstanceDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  const isDev = process.env.NODE_ENV === "development";

  return (
    <DashboardProvider isDev={isDev} instanceId={uuid}>
      <DashboardClientLayout>{children}</DashboardClientLayout>
    </DashboardProvider>
  );
}
