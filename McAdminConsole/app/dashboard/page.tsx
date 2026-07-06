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
    <div className="flex-1 min-h-screen bg-zinc-950 text-zinc-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">
              Control Panel
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Logged in as <span className="text-zinc-200 font-semibold">{user.fullName || user.username || "User"}</span> ({role})
            </p>
          </div>
          {isDev && (
            <span className="px-3 py-1.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-full text-xs font-semibold">
              Dev Mode Enabled
            </span>
          )}
        </div>

        {/* Minecraft Server Dashboard */}
        <MCDashboard userRole={role} isDev={isDev} />

      </div>
    </div>
  );
}
