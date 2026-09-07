"use client";

import React, { useState, useEffect } from "react";
import {
  Search,
  Shield,
  Crown,
  User as UserIcon,
  Loader2,
  Trash2,
  Key,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Server,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBackendBaseUrl, apiFetch } from "@/lib/mc-server/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface ManagedUser {
  id: string;
  username: string;
  is_superuser: boolean;
  permissions: {
    can_create_server: boolean;
  };
  created_at: string;
}

export default function ManageUsersClient({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password reset dialog state
  const [resetTargetUser, setResetTargetUser] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  const fetchUsers = async () => {
    try {
      const base = getBackendBaseUrl();
      const res = await apiFetch(`${base}/api/users`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error("Failed to load users:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const showMessage = (type: "success" | "error", text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleToggleSuperuser = async (targetUser: ManagedUser) => {
    setUpdatingId(targetUser.id);
    try {
      const base = getBackendBaseUrl();
      const res = await apiFetch(`${base}/api/users/${encodeURIComponent(targetUser.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_superuser: !targetUser.is_superuser }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update superuser status");
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, is_superuser: !u.is_superuser } : u))
      );
      showMessage("success", `Updated superuser status for ${targetUser.username}`);
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleCanCreateServer = async (targetUser: ManagedUser) => {
    setUpdatingId(targetUser.id);
    const newCanCreate = !targetUser.permissions?.can_create_server;
    try {
      const base = getBackendBaseUrl();
      const res = await apiFetch(`${base}/api/users/${encodeURIComponent(targetUser.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ can_create_server: newCanCreate }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update permissions");
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.id === targetUser.id
            ? { ...u, permissions: { ...u.permissions, can_create_server: newCanCreate } }
            : u
        )
      );
      showMessage("success", `Updated server creation permission for ${targetUser.username}`);
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteUser = async (targetUser: ManagedUser) => {
    const ok = window.confirm(
      `Are you sure you want to permanently delete user '${targetUser.username}'?`
    );
    if (!ok) return;

    setUpdatingId(targetUser.id);
    try {
      const base = getBackendBaseUrl();
      const res = await apiFetch(`${base}/api/users/${encodeURIComponent(targetUser.id)}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete user");
      }

      setUsers((prev) => prev.filter((u) => u.id !== targetUser.id));
      showMessage("success", `Deleted user ${targetUser.username}`);
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Delete failed");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser) return;
    if (newPassword.length < 6) {
      showMessage("error", "Password must be at least 6 characters.");
      return;
    }

    setResettingPassword(true);
    try {
      const base = getBackendBaseUrl();
      const res = await apiFetch(`${base}/api/users/${encodeURIComponent(resetTargetUser.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: newPassword }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password");
      }

      showMessage("success", `Reset password for ${resetTargetUser.username}`);
      setResetTargetUser(null);
      setNewPassword("");
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Password reset failed");
    } finally {
      setResettingPassword(false);
    }
  };

  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-850 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
              title="Back to Servers"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Shield className="w-6 h-6 text-rose-400" />
              User & Permission Management
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Superuser control panel: toggle global privileges, grant server creation, reset passwords, or delete accounts.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search usernames..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-zinc-900/80 border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
      </div>

      {/* Notification Toast */}
      {statusMessage && (
        <div
          className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-medium animate-in fade-in ${
            statusMessage.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
              : "bg-rose-500/10 border-rose-500/20 text-rose-300"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* User Table */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
          <span className="text-xs text-zinc-500 font-mono">Loading registered users...</span>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 text-zinc-400 text-xs">
          No users matching &quot;{search}&quot;
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/40 backdrop-blur-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400 uppercase tracking-wider text-[10px] font-mono font-semibold">
                <tr>
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">Superuser Access</th>
                  <th className="py-3.5 px-4">Can Create Server</th>
                  <th className="py-3.5 px-4">Registered</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-850">
                {filteredUsers.map((u) => {
                  const isBusy = updatingId === u.id;
                  const isSelf = u.id === currentUserId;

                  return (
                    <tr key={u.id} className="hover:bg-zinc-800/30 transition-colors">
                      {/* User column */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700/50 flex items-center justify-center text-zinc-400 font-semibold text-xs">
                            {u.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-zinc-100 flex items-center gap-1.5">
                              {u.username}
                              {isSelf && (
                                <span className="text-[9px] font-mono text-zinc-500 bg-zinc-800 px-1 rounded">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-mono text-zinc-500">{u.id}</div>
                          </div>
                        </div>
                      </td>

                      {/* Superuser toggle */}
                      <td className="py-4 px-4">
                        <button
                          onClick={() => handleToggleSuperuser(u)}
                          disabled={isBusy}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold cursor-pointer transition-all ${
                            u.is_superuser
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
                              : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-750 hover:text-zinc-200"
                          }`}
                        >
                          <Crown className="w-3 h-3" />
                          {u.is_superuser ? "Superuser" : "Standard"}
                        </button>
                      </td>

                      {/* Can create server toggle */}
                      <td className="py-4 px-4">
                        <button
                          onClick={() => handleToggleCanCreateServer(u)}
                          disabled={isBusy}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold cursor-pointer transition-all ${
                            u.permissions?.can_create_server
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                              : "bg-zinc-800/80 text-zinc-500 border-zinc-700/80 hover:bg-zinc-750"
                          }`}
                        >
                          <Server className="w-3 h-3" />
                          {u.permissions?.can_create_server ? "Allowed" : "Disabled"}
                        </button>
                      </td>

                      {/* Registered date */}
                      <td className="py-4 px-4 font-mono text-[11px] text-zinc-400">
                        {new Date(u.created_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setResetTargetUser(u);
                              setNewPassword("");
                            }}
                            className="h-8 px-2.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs"
                            title="Reset password"
                          >
                            <Key className="w-3.5 h-3.5 mr-1" />
                            Password
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteUser(u)}
                            disabled={isBusy}
                            className="h-8 w-8 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
                            title="Delete user"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reset Password Dialog */}
      <Dialog open={Boolean(resetTargetUser)} onOpenChange={(open) => !open && setResetTargetUser(null)}>
        <DialogContent className="sm:max-w-sm bg-zinc-950 border-zinc-800 text-zinc-50 p-6 shadow-2xl">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-base font-bold">
              Reset Password for {resetTargetUser?.username}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Set a new password for this user account (minimum 6 characters).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetPassword} className="space-y-4 pt-2">
            <Input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoFocus
              className="bg-zinc-900 border-zinc-800 text-xs text-zinc-100"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetTargetUser(null)}
                className="text-xs rounded-xl border-zinc-800"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={resettingPassword || newPassword.length < 6}
                className="text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white"
              >
                {resettingPassword ? "Saving..." : "Update Password"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
