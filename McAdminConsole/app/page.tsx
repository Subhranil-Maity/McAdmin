"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { Shield, Sparkles, LayoutDashboard, Users, Key, LogIn } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LoginDialog } from "@/components/auth/login-dialog";

export default function Home() {
  const { user, isLoading } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className="flex-1 min-h-screen bg-zinc-950 text-zinc-50 flex flex-col justify-center items-center py-20 px-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-[150px] bg-purple-500/10 pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-[150px] bg-amber-500/10 pointer-events-none" />

      {/* Main Container */}
      <main className="max-w-4xl w-full text-center space-y-12 relative z-10">
        {/* Hero Section */}
        <div className="space-y-4">
          <h1 className="text-4xl sm:text-6xl font-black tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">
            Minecraft Admin Portal
          </h1>
          <p className="max-w-xl mx-auto text-sm sm:text-base text-zinc-400 leading-relaxed">
            A self-hosted, multi-instance Minecraft server control panel with Argon2id authentication and granular per-server access control.
          </p>
        </div>

        {/* Dynamic CTA */}
        <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
          {isLoading ? (
            <div className="h-12 w-40 rounded-xl bg-zinc-900 animate-pulse" />
          ) : user ? (
            <>
              <Link
                href="/dashboard"
                className="w-full sm:w-auto flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl text-sm font-semibold bg-white text-black hover:bg-zinc-200 active:scale-[0.98] transition-all duration-200"
              >
                <LayoutDashboard className="w-4 h-4" />
                Go to Dashboard
              </Link>
              {user.is_superuser && (
                <Link
                  href="/manageuser"
                  className="w-full sm:w-auto flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl text-sm font-semibold bg-zinc-900 border border-zinc-800 text-white hover:bg-zinc-800 active:scale-[0.98] transition-all duration-200"
                >
                  <Users className="w-4 h-4" />
                  Manage Users
                </Link>
              )}
            </>
          ) : (
            <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-md max-w-sm w-full mx-auto space-y-4">
              <h3 className="font-bold text-white text-lg">Local Authentication</h3>
              <p className="text-xs text-zinc-400">
                Sign in or create an account to access server instances and manage configurations.
              </p>
              <Button
                onClick={() => setLoginOpen(true)}
                className="w-full py-3 px-4 rounded-xl font-semibold bg-white text-black hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                Sign In / Register
              </Button>
            </div>
          )}
        </div>
      </main>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}
