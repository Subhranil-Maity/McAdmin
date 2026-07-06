"use client";

import React, { useState, useTransition } from "react";
import { UserRole } from "@/types/roles";
import { updateUserRole } from "@/app/actions/user";
import { Search, Shield, Settings, User, Loader2, Check, AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface SerializableUser {
  id: string;
  fullName: string;
  email: string;
  imageUrl: string;
  role: UserRole;
}

interface ManageUsersClientProps {
  initialUsers: SerializableUser[];
  currentUserId: string;
  currentUserRole: UserRole;
  isDev: boolean;
}

export default function ManageUsersClient({
  initialUsers,
  currentUserId,
  currentUserRole,
  isDev,
}: ManageUsersClientProps) {
  const [users, setUsers] = useState<SerializableUser[]>(initialUsers);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Role badges definitions
  const roleBadges: Record<UserRole, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
    [UserRole.OWNER]: {
      label: "Owner",
      bg: "bg-amber-500/10 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.1)]",
      text: "text-amber-400",
      icon: <Shield className="w-3.5 h-3.5" />,
    },
    [UserRole.ADMIN]: {
      label: "Admin",
      bg: "bg-purple-500/10 border-purple-500/20 shadow-[0_0_10px_rgba(168,85,247,0.1)]",
      text: "text-purple-400",
      icon: <Settings className="w-3.5 h-3.5" />,
    },
    [UserRole.NORMUSER]: {
      label: "User",
      bg: "bg-zinc-500/10 border-zinc-500/20",
      text: "text-zinc-400",
      icon: <User className="w-3.5 h-3.5" />,
    },
  };

  const handleRoleChange = async (targetUserId: string, newRole: UserRole) => {
    setUpdatingUserId(targetUserId);
    setMessage(null);

    startTransition(async () => {
      try {
        const result = await updateUserRole(targetUserId, newRole);
        if (result?.success) {
          setUsers((prev) =>
            prev.map((u) => (u.id === targetUserId ? { ...u, role: newRole } : u))
          );
          setMessage({
            type: "success",
            text: "User role updated successfully.",
          });
        }
      } catch (err: any) {
        setMessage({
          type: "error",
          text: err.message || "Failed to update role.",
        });
      } finally {
        setUpdatingUserId(null);
      }
    });
  };

  // Filter users based on search query and role filter
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.fullName.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchesRole = filterRole === "ALL" || u.role === filterRole;
    return matchesSearch && matchesRole;
  });

  // Check if current user is allowed to edit roles (Owner-only in Production)
  const canEdit = isDev || currentUserRole === UserRole.OWNER;

  return (
    <div className="space-y-6">
      
      {/* Header and Back Link */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors mb-2"
          >
            <ArrowLeft className="w-3 h-3" /> Back to Dashboard
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            User Directory
            <span className="text-xs px-2.5 py-1 bg-zinc-800 text-zinc-400 rounded-full font-semibold border border-zinc-700">
              {users.length} total
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            {canEdit 
              ? "Update roles and manage permissions for all registered accounts." 
              : "Viewing directory. Role modification is locked to OWNER only in production."}
          </p>
        </div>
      </div>

      {/* Global Status/Toast message */}
      {message && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm animate-fade-in ${
            message.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-rose-500/10 border-rose-500/20 text-rose-400"
          }`}
        >
          {message.type === "success" ? (
            <Check className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span className="font-medium">{message.text}</span>
          <button
            onClick={() => setMessage(null)}
            className="ml-auto hover:text-white transition-colors"
          >
            &times;
          </button>
        </div>
      )}

      {/* Search and Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-md">
        
        {/* Search */}
        <div className="sm:col-span-2 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm placeholder-zinc-500 text-zinc-200 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
          />
        </div>

        {/* Filter Dropdown */}
        <div className="relative">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-200 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all appearance-none cursor-pointer"
          >
            <option value="ALL">All Roles</option>
            <option value={UserRole.OWNER}>Owners</option>
            <option value={UserRole.ADMIN}>Admins</option>
            <option value={UserRole.NORMUSER}>Users</option>
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 text-xs font-bold">
            ▼
          </div>
        </div>
      </div>

      {/* Directory Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredUsers.length > 0 ? (
          filteredUsers.map((user) => {
            const isSelf = user.id === currentUserId;
            const badge = roleBadges[user.role];

            return (
              <div
                key={user.id}
                className="relative rounded-2xl border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 transition-all duration-300 p-5 flex flex-col justify-between gap-4 group"
              >
                {/* User Card Top */}
                <div className="flex items-start gap-4">
                  {user.imageUrl ? (
                    <img
                      src={user.imageUrl}
                      alt={user.fullName}
                      className="w-12 h-12 rounded-full border border-zinc-700 object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700">
                      <User className="w-6 h-6 text-zinc-500" />
                    </div>
                  )}

                  <div className="space-y-1 min-w-0">
                    <h3 className="font-bold text-white text-base truncate flex items-center gap-2">
                      {user.fullName}
                      {isSelf && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded border border-zinc-700 font-semibold uppercase">
                          You
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-zinc-400 truncate">{user.email}</p>
                  </div>
                </div>

                {/* User Card Bottom */}
                <div className="flex items-center justify-between border-t border-zinc-800/60 pt-4 mt-1">
                  
                  {/* Active Role Badge */}
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium uppercase tracking-wider ${badge.bg} ${badge.text}`}>
                    {badge.icon}
                    <span>{badge.label}</span>
                  </div>

                  {/* Role Selector */}
                  {canEdit && (!isSelf || isDev) ? (
                    <div className="relative">
                      {updatingUserId === user.id ? (
                        <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium py-1 px-3">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
                        </div>
                      ) : (
                        <select
                          value={user.role}
                          onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                          className="bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 hover:text-white rounded-lg py-1 px-3 pr-8 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 cursor-pointer appearance-none transition-all uppercase font-semibold"
                        >
                          <option value={UserRole.NORMUSER}>Make User</option>
                          <option value={UserRole.ADMIN}>Make Admin</option>
                          <option value={UserRole.OWNER}>Make Owner</option>
                        </select>
                      )}
                      {updatingUserId !== user.id && (
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500 text-[8px]">
                          ▼
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[10px] text-zinc-500 italic">
                      {isSelf ? "Self-modification locked" : "Permission locked"}
                    </div>
                  )}

                </div>
              </div>
            );
          })
        ) : (
          <div className="md:col-span-2 text-center py-12 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/10">
            <User className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
            <h3 className="font-semibold text-zinc-400">No users found</h3>
            <p className="text-xs text-zinc-500 mt-1">Try broadening your search or change the filter.</p>
          </div>
        )}
      </div>

    </div>
  );
}
