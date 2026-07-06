import { currentUser } from "@clerk/nextjs/server";
import { getUserRole, UserRole } from "@/types/roles";
import { Shield, Sparkles, LayoutDashboard, Users, Key } from "lucide-react";
import Link from "next/link";

export default async function Home() {
  const user = await currentUser();
  const role = user ? getUserRole(user.publicMetadata) : null;

  return (
    <div className="flex-1 min-h-screen bg-zinc-950 text-zinc-50 flex flex-col justify-center items-center py-20 px-4 relative overflow-hidden">
      
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-[150px] bg-purple-500/10 pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-[150px] bg-amber-500/10 pointer-events-none" />

      {/* Main Container */}
      <main className="max-w-4xl w-full text-center space-y-12 relative z-10">
        
        {/* Hero Section */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-purple-500/20 bg-purple-500/10 text-purple-400 text-xs font-semibold uppercase tracking-wider animate-pulse">
            <Sparkles className="w-3.5 h-3.5" />
            <span>NextJS 16 & Clerk v7 System</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-black tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">
            Minecraft Admin Portal
          </h1>
          <p className="max-w-xl mx-auto text-sm sm:text-base text-zinc-400 leading-relaxed">
            A premium, role-based administration dashboard configured dynamically via Clerk public metadata. Control roles, inspect permissions, and manage user directories.
          </p>
        </div>

        {/* Dynamic CTA */}
        <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="w-full sm:w-auto flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl text-sm font-semibold bg-white text-black hover:bg-zinc-200 active:scale-[0.98] transition-all duration-200"
              >
                <LayoutDashboard className="w-4 h-4" />
                Go to Dashboard
              </Link>
              {(role === UserRole.OWNER || process.env.NODE_ENV === "development") && (
                <Link
                  href="/manageuser"
                  className="w-full sm:w-auto flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl text-sm font-semibold bg-zinc-900 border border-zinc-800 text-white hover:bg-zinc-850 hover:border-zinc-700 active:scale-[0.98] transition-all duration-200"
                >
                  <Users className="w-4 h-4" />
                  Manage Users
                </Link>
              )}
            </>
          ) : (
            <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-md max-w-sm w-full mx-auto space-y-4">
              <h3 className="font-bold text-white text-lg">Secure Administration</h3>
              <p className="text-xs text-zinc-400">
                Please sign in or sign up to access your permission matrix and dashboard panel.
              </p>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">
                Locked &bull; TLS Secured
              </div>
            </div>
          )}
        </div>

        {/* Feature Cards / Role Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
          
          {/* Owner Role Card */}
          <div className="rounded-2xl border border-amber-500/10 bg-zinc-900/40 p-6 space-y-4 hover:border-amber-500/20 hover:scale-[1.01] transition-all duration-300">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
              <Shield className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-white text-base">OWNER Role</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Full directory privileges. View the dashboard, navigate users, and update anyone's role.
              </p>
            </div>
          </div>

          {/* Admin Role Card */}
          <div className="rounded-2xl border border-purple-500/10 bg-zinc-900/40 p-6 space-y-4 hover:border-purple-500/20 hover:scale-[1.01] transition-all duration-300">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mx-auto">
              <Users className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-white text-base">ADMIN Role</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Elevated directory access. View dashboard and read directory list. Role updates are disabled.
              </p>
            </div>
          </div>

          {/* User Role Card */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-4 hover:border-zinc-700 hover:scale-[1.01] transition-all duration-300">
            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400 mx-auto">
              <Key className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-white text-base">NORMUSER Role</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Standard security access. General dashboard visibility. Restrictive access to administration routes.
              </p>
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}
