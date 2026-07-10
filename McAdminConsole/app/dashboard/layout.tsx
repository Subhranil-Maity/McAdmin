import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserRole, UserRole } from "@/types/roles";
import { DashboardProvider } from "@/components/dashboard/dashboard-context";
import DashboardClientLayout from "@/components/dashboard/dashboard-client-layout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();

  if (!user) {
    redirect("/");
  }

  const role = getUserRole(user.publicMetadata);
  if (role === UserRole.NORMUSER) {
    redirect("/serverstatus");
  }
  
  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 flex flex-col bg-zinc-950 text-zinc-50 overflow-hidden">
      <DashboardProvider userRole={role} isDev={isDev}>
        <DashboardClientLayout>
          {children}
        </DashboardClientLayout>
      </DashboardProvider>
    </div>
  );
}
