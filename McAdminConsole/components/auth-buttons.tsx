"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { LoginDialog } from "@/components/auth/login-dialog";
import { LogOut, User as UserIcon, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthButtons() {
  const { user, logout, isLoading } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-zinc-800 animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setDialogOpen(true)}
            className="px-4 py-1.5 text-sm font-medium text-zinc-950 bg-white hover:bg-zinc-200 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white rounded-lg transition-colors cursor-pointer"
          >
            Sign In
          </Button>
        </div>
        <LoginDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-300">
        <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400">
          <UserIcon className="w-3 h-3" />
        </div>
        <span className="font-semibold text-zinc-100">{user.username}</span>
        {user.is_superuser && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
            <Crown className="w-2.5 h-2.5" />
            Super
          </span>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={logout}
        title="Sign Out"
        className="w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
      >
        <LogOut className="w-4 h-4" />
      </Button>
    </div>
  );
}
