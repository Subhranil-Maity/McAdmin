"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useDashboard } from "./dashboard-context";
import { useUser } from "@clerk/nextjs";
import { UserRole, getUserRole } from "@/types/roles";
import { searchUsers, UserSearchResult } from "@/app/actions/user";
import { updateInstanceAdmins } from "@/lib/mc-server/instances";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AdminsTab() {
  const { instanceId, instanceDetail, refreshAllInstances } = useDashboard();
  const { user, isLoaded } = useUser();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  const currentUserRole = getUserRole(user?.publicMetadata);
  const isSuperAdmin = currentUserRole === UserRole.SUPERADMIN;
  const isOwner = Boolean(user && instanceDetail?.owner_id && instanceDetail.owner_id === user.id);
  const isDev = process.env.NODE_ENV === "development";
  const canManage = isSuperAdmin || isOwner || isDev;

  const currentAdminIds = instanceDetail?.admins || [];
  const ownerId = instanceDetail?.owner_id;

  // Initial user load & search
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const results = await searchUsers(searchQuery);
        if (active) {
          setSearchResults(results);
        }
      } catch (err) {
        console.error("Failed to search users:", err);
      } finally {
        if (active) setLoadingSearch(false);
      }
    }, searchQuery ? 300 : 0);

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

  const handleAddAdmin = async (targetUserId: string) => {
    if (!instanceId || !canManage) return;
    if (currentAdminIds.includes(targetUserId)) return;

    setUpdatingId(targetUserId);
    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      try {
        const newAdmins = [...currentAdminIds, targetUserId];
        await updateInstanceAdmins(instanceId, newAdmins);
        await refreshAllInstances();
        showSuccess("Admin added successfully.");
      } catch (err) {
        console.error(err);
        showError(err instanceof Error ? err.message : "Failed to add admin.");
      } finally {
        setUpdatingId(null);
      }
    });
  };

  const handleRemoveAdmin = async (targetUserId: string) => {
    if (!instanceId || !canManage) return;

    setUpdatingId(targetUserId);
    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      try {
        const newAdmins = currentAdminIds.filter((id) => id !== targetUserId);
        await updateInstanceAdmins(instanceId, newAdmins);
        await refreshAllInstances();
        showSuccess("Admin removed successfully.");
      } catch (err) {
        console.error(err);
        showError(err instanceof Error ? err.message : "Failed to remove admin.");
      } finally {
        setUpdatingId(null);
      }
    });
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-500">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // Find user info for current admins if available in searchResults
  const adminUsers = currentAdminIds.map((id) => {
    const found = searchResults.find((u) => u.id === id);
    return (
      found || {
        id,
        fullName: "Server Administrator",
        email: id,
        imageUrl: "",
        role: UserRole.ADMIN,
      }
    );
  });

  // Owner user object if available
  const ownerUser = ownerId ? searchResults.find((u) => u.id === ownerId) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-900 pb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            Server Administrators
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Admins have full operational control over this instance, including start/stop, console access, file editing, and properties.
          </p>
        </div>

        {isDev && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-400 text-xs font-mono font-medium">
            <ShieldAlert className="w-4 h-4" />
            Dev Mode: Access Allowed
          </div>
        )}
      </div>

      {/* Access Notice */}
      {!canManage && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 text-zinc-400 text-xs">
          <Lock className="w-4 h-4 text-zinc-500 shrink-0" />
          <span>
            You have read-only access to this server&apos;s admin roster. Only the server owner or a superadmin can modify administrators.
          </span>
        </div>
      )}

      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold shadow-[0_0_15px_rgba(16,185,129,0.15)] animate-in fade-in duration-300">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-xs font-semibold shadow-[0_0_15px_rgba(244,63,94,0.15)] animate-in fade-in duration-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Owner & Current Admins Section */}
      <Card className="border-zinc-850 bg-zinc-900/20 backdrop-blur-md rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-zinc-900">
          <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Active Instance Management Roster
          </CardTitle>
          <CardDescription className="text-xs text-zinc-400">
            Users who currently hold administrative authority on this specific Minecraft instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 space-y-4">
          {/* Owner Card */}
          {ownerId && (
            <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {ownerUser?.imageUrl ? (
                  <img
                    src={ownerUser.imageUrl}
                    alt={ownerUser.fullName}
                    className="w-10 h-10 rounded-full border border-amber-500/30 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <Crown className="w-5 h-5 text-amber-400" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm truncate">
                      {ownerUser ? ownerUser.fullName : "Server Owner"}
                    </span>
                    <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                      Instance Owner
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 truncate">
                    {ownerUser ? ownerUser.email : `User ID: ${ownerId}`}
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono text-zinc-500 shrink-0">Full Ownership</span>
            </div>
          )}

          {/* Admins List */}
          {adminUsers.length === 0 ? (
            <div className="text-center py-8 text-zinc-500 text-xs">
              No additional administrators assigned. Use the search directory below to appoint admins.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {adminUsers.map((adm) => {
                const isUpdating = updatingId === adm.id;
                return (
                  <div
                    key={adm.id}
                    className="p-3.5 rounded-xl border border-zinc-850 bg-zinc-950/40 hover:border-zinc-800 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {adm.imageUrl ? (
                        <img
                          src={adm.imageUrl}
                          alt={adm.fullName}
                          className="w-9 h-9 rounded-full border border-zinc-800 object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                          <UserIcon className="w-4 h-4 text-zinc-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-white text-xs truncate">{adm.fullName}</div>
                        <div className="text-[11px] text-zinc-500 truncate font-mono">{adm.email}</div>
                      </div>
                    </div>

                    {canManage && (
                      <Button
                        onClick={() => handleRemoveAdmin(adm.id)}
                        disabled={isUpdating}
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2.5 rounded-lg text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer shrink-0 transition-colors"
                      >
                        {isUpdating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <UserMinus className="w-3.5 h-3.5 mr-1" />
                            Remove
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assign New Admins Section */}
      {canManage && (
        <Card className="border-zinc-850 bg-zinc-900/20 backdrop-blur-md rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-zinc-900">
            <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-indigo-400" />
              Assign New Administrators
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              Search registered users across your organization to grant instance admin access.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 space-y-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                type="text"
                placeholder="Search users by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 py-5 bg-black/50 border-zinc-850 rounded-xl text-xs placeholder-zinc-500 text-zinc-200 focus-visible:ring-zinc-700 w-full"
              />
            </div>

            {/* Results */}
            {loadingSearch ? (
              <div className="flex items-center justify-center py-12 text-zinc-500 gap-2 text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Searching directory...</span>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-xs">
                No users found matching &quot;{searchQuery}&quot;.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                {searchResults.map((u) => {
                  const isOwnerUser = u.id === ownerId;
                  const isAdminUser = currentAdminIds.includes(u.id);
                  const isUpdating = updatingId === u.id;

                  return (
                    <div
                      key={u.id}
                      className="p-3.5 rounded-xl border border-zinc-850 bg-zinc-950/40 hover:border-zinc-800 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {u.imageUrl ? (
                          <img
                            src={u.imageUrl}
                            alt={u.fullName}
                            className="w-9 h-9 rounded-full border border-zinc-800 object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                            <UserIcon className="w-4 h-4 text-zinc-400" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-white text-xs truncate">{u.fullName}</span>
                            {u.role === UserRole.SUPERADMIN && (
                              <Crown className="w-3 h-3 text-rose-400 shrink-0" />
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate font-mono">{u.email}</div>
                        </div>
                      </div>

                      {isOwnerUser ? (
                        <span className="text-[10px] font-mono uppercase font-bold text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 shrink-0">
                          Owner
                        </span>
                      ) : isAdminUser ? (
                        <Button
                          onClick={() => handleRemoveAdmin(u.id)}
                          disabled={isUpdating}
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2.5 rounded-lg text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer shrink-0"
                        >
                          {isUpdating ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <UserMinus className="w-3.5 h-3.5 mr-1" />
                              Remove
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handleAddAdmin(u.id)}
                          disabled={isUpdating}
                          variant="outline"
                          size="sm"
                          className="h-8 px-2.5 rounded-lg text-xs font-semibold border-zinc-850 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 cursor-pointer shrink-0"
                        >
                          {isUpdating ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <UserPlus className="w-3.5 h-3.5 mr-1 text-indigo-400" />
                              Add Admin
                            </>
                          )}
                        </Button>
                      )}
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
