import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserRole } from "@/types/roles";
import { DashboardProvider } from "@/components/dashboard/dashboard-context";
import DashboardClientLayout from "@/components/dashboard/dashboard-client-layout";

export default async function InstanceDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ uuid: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/");
  }

  const { uuid } = await params;
  const role = getUserRole(user.publicMetadata);
  const isDev = process.env.NODE_ENV === "development";

  return (
    <DashboardProvider userRole={role} isDev={isDev} instanceId={uuid}>
      <DashboardClientLayout>{children}</DashboardClientLayout>
    </DashboardProvider>
  );
}
