import React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { Link, useLocation } from "react-router";

export function NavbarLinks() {
  const { user } = useAuth();
  const { pathname } = useLocation();

  if (!user) {
    return null;
  }

  return (
    <nav className="flex items-center gap-4">
      <Link
        to="/dashboard"
        className={`text-sm font-medium transition-colors ${
          pathname.startsWith("/dashboard")
            ? "text-zinc-50 font-semibold"
            : "text-zinc-400 hover:text-zinc-100"
        }`}
      >
        Servers
      </Link>
      {user.is_superuser && (
        <Link
          to="/manageuser"
          className={`text-sm font-medium transition-colors ${
            pathname === "/manageuser"
              ? "text-zinc-50 font-semibold"
              : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          Manage Users
        </Link>
      )}
    </nav>
  );
}
