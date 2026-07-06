import { currentUser, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserRole, UserRole, canAccessManageUser } from "@/types/roles";
import ManageUsersClient from "./manage-users-client";
import { ShieldAlert, ArrowLeft, Terminal } from "lucide-react";
import Link from "next/link";

interface SerializableUser {
  id: string;
  fullName: string;
  email: string;
  imageUrl: string;
  role: UserRole;
}

export default async function ManageUsersPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/");
  }

  const role = getUserRole(user.publicMetadata);
  const isDev = process.env.NODE_ENV === "development";
  const hasAccess = canAccessManageUser(role);

  // If unauthorized, render the "Access Denied" dashboard page
  if (!hasAccess) {
    return (
      <div className="flex-1 min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full text-center space-y-6 p-8 rounded-2xl border border-rose-500/20 bg-zinc-900/50 backdrop-blur-md shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-rose-500 via-red-400 to-rose-600" />
          <div className="absolute -right-12 -top-12 w-24 h-24 rounded-full blur-[80px] bg-rose-500/10" />

          <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 animate-pulse">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-black tracking-tight text-white">Access Denied</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              The User Management route is restricted to the <strong className="text-amber-400">OWNER</strong> role in production environments.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-left space-y-2 text-xs font-mono text-zinc-500">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Terminal className="w-3.5 h-3.5" />
              <span>Diagnostic Console</span>
            </div>
            <div>ENVIRONMENT: production</div>
            <div>REQUIRED_ROLE: OWNER</div>
            <div>CURRENT_ROLE: {role}</div>
          </div>

          <div className="pt-2">
            <Link
              href="/dashboard"
              className="inline-flex w-full items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold bg-zinc-800 text-white hover:bg-zinc-700 active:scale-[0.98] transition-all duration-200"
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Fetch registered users from Clerk Client
  const client = await clerkClient();
  const response = await client.users.getUserList({
    orderBy: "-created_at",
    limit: 100,
  });

  // Map users to a safe, serializable array for Client Component hydration
  const serializedUsers: SerializableUser[] = response.data.map((u) => {
    const email = u.emailAddresses[0]?.emailAddress || "No email";
    const name = 
      u.fullName || 
      [u.firstName, u.lastName].filter(Boolean).join(" ") || 
      u.username || 
      "Anonymous User";
    
    return {
      id: u.id,
      fullName: name,
      email: email,
      imageUrl: u.imageUrl || "",
      role: getUserRole(u.publicMetadata),
    };
  });

  return (
    <div className="flex-1 min-h-screen bg-zinc-950 text-zinc-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <ManageUsersClient
          initialUsers={serializedUsers}
          currentUserId={user.id}
          currentUserRole={role}
          isDev={isDev}
        />
      </div>
    </div>
  );
}
