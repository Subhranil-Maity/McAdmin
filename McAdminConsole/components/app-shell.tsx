"use client";

import React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { BackendUnavailable } from "@/components/backend-unavailable";
import { NavbarLinks } from "@/components/navbar-links";
import { AuthButtons } from "@/components/auth-buttons";
import Link from "next/link";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isBackendAvailable } = useAuth();

  if (isBackendAvailable === false) {
    return <BackendUnavailable />;
  }

  return (
    <>
      <header className="h-16 flex items-center justify-between px-6 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40 shrink-0">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-bold text-lg text-zinc-50 hover:opacity-80 transition-opacity flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            MC Admin
          </Link>
          <NavbarLinks />
        </div>
        <AuthButtons />
      </header>
      <div className="flex-1 flex flex-col">
        {children}
      </div>
    </>
  );
}
