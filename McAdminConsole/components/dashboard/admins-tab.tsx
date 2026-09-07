"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useDashboard } from "./dashboard-context";
import { useAuth } from "@/lib/auth/auth-context";
import {
  getInstanceMembers,
  addInstanceMember,
  removeInstanceMember,
  transferInstanceOwnership,
  InstanceMembersResponse,
  MemberInfo,
} from "@/lib/mc-server/instances";
import { getBackendBaseUrl, apiFetch } from "@/lib/mc-server/utils";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UserMinus,
  Search,
  Loader2,
  AlertCircle,
  CheckCircle,
  Crown,
  User as UserIcon,
  Lock,
  ArrowRightLeft,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface UserSearchResult {
  id: string;
  username: string;
}

export default function AdminsTab() {
  const { instanceId, instanceDetail, refreshAllInstances } = useDashboard();
  const { user } = useAuth();

  const [members, setMembers] = useState<InstanceMembersResponse>({
    owner: null,
    admins: [],
    users: [],
  });
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isSuperuser = Boolean(user?.is_superuser);
  const isOwner = Boolean(
    user && (members.owner?.id === user.id || instanceDetail?.owner_id === user.id)
  );
  const isDev = process.env.NODE_ENV === "development";
  const canManage = isSuperuser || isOwner || isDev;

  const loadMembers = useCallback(async () => {
    if (!instanceId) return;
    try {
      const data = await getInstanceMembers(instanceId);
      setMembers(data);
    } catch (err) {
      console.error("Failed to load instance members:", err);
    } finally {
      setLoadingMembers(false);
    }
  }, [instanceId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // User search debounce
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const base = getBackendBaseUrl();
        const url = searchQuery
          ? `${base}/api/users?query=${encodeURIComponent(searchQuery)}`
          : `${base}/api/users`;
        const res = await apiFetch(url);
        if (res.ok && active) {
          const list: UserSearchResult[] = await res.json();
          setSearchResults(list);
        }
      } catch (err) {
        console.error("Failed to search users:", err);
      } finally {
        if (active) setLoadingSearch(false);
      }
    }, searchQuery ? 250 : 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  };

  const handleAddMember = async (targetUserId: string, role: "admin" | "user") => {
    if (!instanceId || !canManage) return;
    setUpdatingId(`${targetUserId}-${role}`);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await addInstanceMember(instanceId, targetUserId, role);
      await loadMembers();
      await refreshAllInstances();
      showSuccess(`Added user as instance ${role}.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : `Failed to add ${role}.`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!instanceId || !canManage) return;
    setUpdatingId(targetUserId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await removeInstanceMember(instanceId, targetUserId);
      await loadMembers();
      await refreshAllInstances();
      showSuccess("Member removed from instance.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to remove member.");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleTransferOwnership = async (newOwnerId: string) => {
    if (!instanceId || !canManage) return;
    const ok = window.confirm(
      "Are you sure you want to transfer ownership of this server? The new owner will gain complete authority."
    );
    if (!ok) return;

    setUpdatingId(newOwnerId);
    try {
      await transferInstanceOwnership(instanceId, newOwnerId);
      await loadMembers();
      await refreshAllInstances();
      showSuccess("Ownership transferred successfully.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to transfer ownership.");
    } finally {
      setUpdatingId(null);
    }
  };

  const isMember = (uid: string) => {
    if (members.owner?.id === uid) return true;
    if (members.admins.some((a) => a.id === uid)) return true;
    if (members.users.some((u) => u.id === uid)) return true;
    return false;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-900 pb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            Access & Instance Roles
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Control server membership. Instance owners hold full management; admins operate console, files, and server power; users hold viewer access.
          </p>
        </div>

        {isDev && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-400 text-xs font-mono font-medium">
            <ShieldAlert className="w-4 h-4" />
            Dev Mode: Full Access
          </div>
        )}
      </div>

      {/* Access Notice */}
      {!canManage && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 text-zinc-400 text-xs">
          <Lock className="w-4 h-4 text-zinc-500 shrink-0" />
          <span>
            You have read-only access to this server&apos;s roster. Only the server owner or a superuser can modify member roles.
          </span>
        </div>
      )}

      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold shadow-[0_0_15px_rgba(16,185,129,0.15)] animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-xs font-semibold shadow-[0_0_15px_rgba(244,63,94,0.15)] animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Active Members Roster */}
      <Card className="border-zinc-850 bg-zinc-900/20 backdrop-blur-md rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-zinc-900">
          <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Active Instance Members Roster
          </CardTitle>
          <CardDescription className="text-xs text-zinc-400">
            Assigned roles stored for this Minecraft server instance.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4 sm:p-6 space-y-5">
          {loadingMembers ? (
            <div className="py-8 flex justify-center text-zinc-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              {/* Owner */}
              {members.owner && (
                <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                      <Crown className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm truncate">
                          {members.owner.username}
                        </span>
                        <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                          Owner
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-zinc-500 truncate">{members.owner.id}</p>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-zinc-400 shrink-0">Primary Owner</span>
                </div>
              )}

              {/* Admins */}
              <div className="space-y-2">
                <h4 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-purple-400" />
                  Administrators ({members.admins.length})
                </h4>
                {members.admins.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">No administrators assigned yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {members.admins.map((admin) => (
                      <div
                        key={admin.id}
                        className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0 font-semibold text-xs">
                            {admin.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-white text-xs truncate block">
                              {admin.username}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-500">{admin.id}</span>
                          </div>
                        </div>

                        {canManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            {isOwner && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleTransferOwnership(admin.id)}
                                disabled={updatingId === admin.id}
                                className="h-7 px-2 text-[11px] text-amber-400 hover:bg-amber-500/10"
                                title="Transfer Ownership"
                              >
                                <ArrowRightLeft className="w-3 h-3 mr-1" />
                                Owner
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveMember(admin.id)}
                              disabled={updatingId === admin.id}
                              className="h-7 w-7 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
                              title="Remove Admin"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Users */}
              <div className="space-y-2 pt-2 border-t border-zinc-900">
                <h4 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5">
                  <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
                  Viewers / Users ({members.users.length})
                </h4>
                {members.users.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">No standard users assigned yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {members.users.map((u) => (
                      <div
                        key={u.id}
                        className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 shrink-0 font-semibold text-xs">
                            {u.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-white text-xs truncate block">
                              {u.username}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-500">{u.id}</span>
                          </div>
                        </div>

                        {canManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAddMember(u.id, "admin")}
                              disabled={updatingId === `${u.id}-admin`}
                              className="h-7 px-2 text-[11px] text-purple-400 hover:bg-purple-500/10"
                              title="Promote to Admin"
                            >
                              Promote
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveMember(u.id)}
                              disabled={updatingId === u.id}
                              className="h-7 w-7 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
                              title="Remove User"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add New Members Section (Owner / Superuser only) */}
      {canManage && (
        <Card className="border-zinc-850 bg-zinc-900/20 backdrop-blur-md rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-zinc-900">
            <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-indigo-400" />
              Add Server Members
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              Search local registered accounts and assign them as Admin or User on this server.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-4 sm:p-6 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                placeholder="Search registered accounts by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 bg-zinc-900/80 border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
            </div>

            {loadingSearch ? (
              <div className="py-6 flex justify-center text-zinc-500">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-6 text-zinc-500 text-xs">
                {searchQuery ? `No users matching "${searchQuery}"` : "Search for users above"}
              </div>
            ) : (
              <div className="divide-y divide-zinc-850 border border-zinc-850 rounded-xl overflow-hidden">
                {searchResults.map((sr) => {
                  const alreadyMember = isMember(sr.id);
                  const isBusy = updatingId?.startsWith(sr.id);

                  return (
                    <div
                      key={sr.id}
                      className="p-3 flex items-center justify-between gap-3 bg-zinc-950/40 hover:bg-zinc-900/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 shrink-0 font-semibold text-xs">
                          {sr.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span className="font-bold text-white text-xs truncate block">
                            {sr.username}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500">{sr.id}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {alreadyMember ? (
                          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900 px-2 py-1 rounded border border-zinc-800">
                            Already Member
                          </span>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleAddMember(sr.id, "user")}
                              disabled={Boolean(isBusy)}
                              className="h-7 px-2.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                            >
                              + User
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleAddMember(sr.id, "admin")}
                              disabled={Boolean(isBusy)}
                              className="h-7 px-2.5 text-xs bg-purple-600 hover:bg-purple-500 text-white font-semibold"
                            >
                              + Admin
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
