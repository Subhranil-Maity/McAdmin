import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserRole, UserRole, canAccessManageUser } from "@/types/roles";
import { Shield, Check, X, ShieldAlert, ArrowRight, User, Settings } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/");
  }

  const role = getUserRole(user.publicMetadata);
  const email = user.emailAddresses[0]?.emailAddress || "No email provided";
  const fullName = user.fullName || user.username || "User";

  // Build the list of active/inactive permissions
  const isDev = process.env.NODE_ENV === "development";
  const permissionsList = [
    {
      name: "View Dashboard",
      desc: "Access basic user statistics and general profile settings.",
      allowed: true, // Always true for logged-in users
    },
    {
      name: "View Registered Users",
      desc: "Ability to see the full list of registered users on the platform.",
      allowed: isDev || role === UserRole.OWNER || role === UserRole.ADMIN,
    },
    {
      name: "Modify User Roles",
      desc: "Manage roles, promoting/demoting other users (Owner-only in Production).",
      allowed: isDev || role === UserRole.OWNER,
    },
  ];

  const canManage = canAccessManageUser(role);

  // Styling based on role
  const roleStyles = {
    [UserRole.OWNER]: {
      badge: "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.15)]",
      glow: "from-amber-500/20 to-transparent",
      text: "text-amber-400",
      icon: <Shield className="w-5 h-5 text-amber-400" />,
    },
    [UserRole.ADMIN]: {
      badge: "bg-purple-500/10 text-purple-400 border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)]",
      glow: "from-purple-500/20 to-transparent",
      text: "text-purple-400",
      icon: <Settings className="w-5 h-5 text-purple-400" />,
    },
    [UserRole.NORMUSER]: {
      badge: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
      glow: "from-zinc-500/10 to-transparent",
      text: "text-zinc-400",
      icon: <User className="w-5 h-5 text-zinc-400" />,
    },
  };

  const style = roleStyles[role];

  return (
    <div className="flex-1 min-h-screen bg-zinc-950 text-zinc-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Welcome Hero Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-md p-8 md:p-10 shadow-2xl transition-all duration-300 hover:border-zinc-700">
          <div className={`absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r ${role === UserRole.OWNER ? 'from-amber-500 via-yellow-400 to-amber-600' : role === UserRole.ADMIN ? 'from-purple-500 via-pink-500 to-purple-600' : 'from-zinc-500 via-zinc-400 to-zinc-600'}`} />
          <div className={`absolute -right-24 -top-24 w-48 h-48 rounded-full blur-[100px] bg-gradient-to-br ${style.glow}`} />
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="flex items-center gap-4">
              {user.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt={fullName}
                  className="w-16 h-16 rounded-full border-2 border-zinc-700 object-cover"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center border-2 border-zinc-700">
                  <User className="w-8 h-8 text-zinc-400" />
                </div>
              )}
              <div>
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
                  Welcome, {fullName}
                </h1>
                <p className="text-sm text-zinc-400 mt-1">{email}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className={`flex items-center gap-1.5 px-4 py-2 rounded-full border text-xs font-semibold uppercase tracking-wider ${style.badge}`}>
                {style.icon}
                <span>{role}</span>
              </div>
              {isDev && (
                <span className="px-3 py-1.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-full text-xs font-medium">
                  Dev Mode
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Permission Matrix */}
          <div className="md:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-md p-6 sm:p-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-zinc-400" />
                Your Platform Permissions
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Your permissions are determined dynamically based on your role {isDev && "and the current development bypass rules"}.
              </p>
            </div>

            <div className="divide-y divide-zinc-800/60">
              {permissionsList.map((perm, idx) => (
                <div key={idx} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                  <div className={`mt-0.5 p-1 rounded-full ${perm.allowed ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                    {perm.allowed ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </div>
                  <div>
                    <h3 className={`font-semibold text-sm ${perm.allowed ? 'text-zinc-200' : 'text-zinc-500 line-through'}`}>
                      {perm.name}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">{perm.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Callout Card */}
          <div className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-900/10 backdrop-blur-md p-6 flex flex-col justify-between space-y-6 hover:border-zinc-700 transition-all duration-300">
            <div className="space-y-3">
              <h3 className="text-lg font-bold text-white">Quick Navigation</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {canManage 
                  ? "You have administrative credentials. You can access the User Management panel to change user roles." 
                  : "You are logged in as a normal user. To manage users or roles, you require OWNER access (or dev-mode bypass)."}
              </p>
            </div>
            
            {canManage ? (
              <Link 
                href="/manageuser"
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold bg-white text-black hover:bg-zinc-200 active:scale-[0.98] transition-all duration-200"
              >
                Manage Users
                <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <div className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium bg-zinc-800/40 text-zinc-500 border border-zinc-800 cursor-not-allowed">
                Management Locked
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
