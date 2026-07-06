import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserRole } from "@/types/roles";
import MCDashboard from "@/components/mc-dashboard";

export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/");
  }

  const role = getUserRole(user.publicMetadata);
  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 flex flex-col bg-zinc-950 text-zinc-50 overflow-hidden">
      <MCDashboard userRole={role} isDev={isDev} />
    </div>
  );
}
