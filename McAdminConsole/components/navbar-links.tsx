"use client";

import React from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { getUserRole, canAccessManageUser } from "@/types/roles";

export function NavbarLinks() {
  const { user, isLoaded, isSignedIn } = useUser();

  // If auth state is not loaded, or user is not signed in, do not render links
  if (!isLoaded || !isSignedIn || !user) {
    return null;
  }

  const role = getUserRole(user.publicMetadata);
  const canManage = canAccessManageUser(role);

  return (
    <nav className="flex items-center gap-4">
      <Link
        href="/dashboard"
        className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
      >
        Dashboard
      </Link>
      {canManage && (
        <Link
          href="/manageuser"
          className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
        >
          Manage Users
        </Link>
      )}
    </nav>
  );
}
