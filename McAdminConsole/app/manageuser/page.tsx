"use client";

import React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import ManageUsersClient from "./manage-users-client";
import { ShieldAlert, ArrowLeft, Terminal, Loader2 } from "lucide-react";
import Link from "next/link";

export default function ManageUsersPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex-1 min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
          <span className="text-sm text-zinc-400">Loading user permissions...</span>
        </div>
      </div>
    );
  }

  // If unauthorized, render the "Access Denied" page
  if (!user || !user.is_superuser) {
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
              The User Management route is restricted to <strong className="text-rose-400">SUPERUSERS</strong>.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-left space-y-2 text-xs font-mono text-zinc-500">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Terminal className="w-3.5 h-3.5" />
              <span>Diagnostic Console</span>
            </div>
            <div>REQUIRED: SUPERUSER</div>
            <div>CURRENT_USER: {user ? user.username : "Unauthenticated"}</div>
            <div>IS_SUPERUSER: {user?.is_superuser ? "true" : "false"}</div>
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

  return (
    <div className="flex-1 min-h-screen bg-zinc-950 text-zinc-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <ManageUsersClient currentUserId={user.id} />
      </div>
    </div>
  );
}
