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
  ServerPermissions,
  ADMIN_PERMISSIONS,
  MODERATOR_PERMISSIONS,
  VIEWER_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PERMISSION_KEYS,
  TOTAL_PERMISSIONS_COUNT,
  detectPermissionPreset,
} from "@/types/roles";
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
  Sliders,
  Sparkles,
  Server,
  Terminal,
  Users,
  UserCheck,
  Folder,
  FileText,
  Key,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface UserSearchResult {
  id: string;
  username: string;
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  server: Server,
  console: Terminal,
  players: Users,
  whitelist: UserCheck,
  files: Folder,
  properties: FileText,
  members: Key,
};

export default function AdminsTab() {
  const {
    instanceId,
    instanceDetail,
    refreshAllInstances,
    refreshPermissions,
    canManageMembers,
  } = useDashboard();
  const { user } = useAuth();

  const [members, setMembers] = useState<InstanceMembersResponse>({
    owner: null,
    admins: [],
    users: [],
    members: [],
  });
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Edit Permissions Modal State
  const [editingUser, setEditingUser] = useState<{
    id: string;
    username: string;
    isNew?: boolean;
    permissions: ServerPermissions;
  } | null>(null);
  const [modalSaving, setModalSaving] = useState(false);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isSuperuser = Boolean(user?.is_superuser);
  const isOwner = Boolean(
    user && (members.owner?.id === user.id || instanceDetail?.owner_id === user.id)
  );
  const isDev = process.env.NODE_ENV === "development";
  const canManage = canManageMembers || isSuperuser || isOwner || isDev;

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

  // Quick 1-Click "Make Admin" handler
  const handleQuickMakeAdmin = async (targetUserId: string) => {
    if (!instanceId || !canManage) return;
    setUpdatingId(`${targetUserId}-admin`);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await addInstanceMember(instanceId, targetUserId, "admin", ADMIN_PERMISSIONS);
      await loadMembers();
      await refreshAllInstances();
      await refreshPermissions();
      showSuccess(`Promoted to Administrator with all ${TOTAL_PERMISSIONS_COUNT} permissions!`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to promote to Admin.");
    } finally {
      setUpdatingId(null);
    }
  };

  // Quick 1-Click "Make Viewer" handler
  const handleQuickMakeViewer = async (targetUserId: string) => {
    if (!instanceId || !canManage) return;
    setUpdatingId(`${targetUserId}-viewer`);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await addInstanceMember(instanceId, targetUserId, "user", VIEWER_PERMISSIONS);
      await loadMembers();
      await refreshAllInstances();
      await refreshPermissions();
      showSuccess("Assigned member as Viewer.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to assign member.");
    } finally {
      setUpdatingId(null);
    }
  };

  // Open Edit Permissions dialog for an existing member
  const handleOpenEditPermissions = (targetUser: MemberInfo) => {
    const initialPerms: ServerPermissions = targetUser.permissions || (
      targetUser.role === "admin" ? ADMIN_PERMISSIONS : VIEWER_PERMISSIONS
    );

    setEditingUser({
      id: targetUser.id,
      username: targetUser.username,
      permissions: { ...initialPerms },
    });
  };

  // Open Custom Permissions dialog for a new user from search
  const handleOpenNewCustomPermissions = (targetUser: UserSearchResult) => {
    setEditingUser({
      id: targetUser.id,
      username: targetUser.username,
      isNew: true,
      permissions: { ...VIEWER_PERMISSIONS },
    });
  };

  // Toggle single permission inside dialog
  const handleTogglePermission = (key: keyof ServerPermissions, explicitVal?: boolean) => {
    setEditingUser((prev) => {
      if (!prev) return null;
      const nextVal = typeof explicitVal === "boolean" ? explicitVal : !prev.permissions[key];
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          [key]: nextVal,
        },
      };
    });
  };

  // Apply preset inside dialog
  const handleApplyPreset = (preset: "admin" | "moderator" | "viewer" | "clear") => {
    setEditingUser((prev) => {
      if (!prev) return null;
      if (preset === "admin") {
        return { ...prev, permissions: { ...ADMIN_PERMISSIONS } };
      } else if (preset === "moderator") {
        return { ...prev, permissions: { ...MODERATOR_PERMISSIONS } };
      } else if (preset === "viewer") {
        return { ...prev, permissions: { ...VIEWER_PERMISSIONS } };
      } else if (preset === "clear") {
        const cleared = Object.keys(ADMIN_PERMISSIONS).reduce((acc, k) => {
          acc[k as keyof ServerPermissions] = false;
          return acc;
        }, {} as ServerPermissions);
        return { ...prev, permissions: cleared };
      }
      return prev;
    });
  };

  // Save permissions from dialog
  const handleSavePermissionsModal = async () => {
    if (!instanceId || !editingUser || !canManage) return;
    setModalSaving(true);
    setErrorMsg(null);
    try {
      const preset = detectPermissionPreset(editingUser.permissions);
      const roleName =
        preset === "admin"
          ? "admin"
          : preset === "moderator"
          ? "moderator"
          : preset === "viewer"
          ? "user"
          : "custom";

      await addInstanceMember(
        instanceId,
        editingUser.id,
        roleName,
        editingUser.permissions
      );
      await loadMembers();
      await refreshAllInstances();
      await refreshPermissions();
      showSuccess(
        editingUser.isNew
          ? `Added @${editingUser.username} to server.`
          : `Updated permissions for @${editingUser.username}.`
      );
      setEditingUser(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save permissions.");
    } finally {
      setModalSaving(false);
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!instanceId || !canManage) return;
    const ok = window.confirm("Are you sure you want to remove this member from the server?");
    if (!ok) return;

    setUpdatingId(targetUserId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await removeInstanceMember(instanceId, targetUserId);
      await loadMembers();
      await refreshAllInstances();
      await refreshPermissions();
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
      await refreshPermissions();
      showSuccess("Ownership transferred successfully.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to transfer ownership.");
    } finally {
      setUpdatingId(null);
    }
  };

  const isMember = (uid: string) => {
    if (members.owner?.id === uid) return true;
    if (members.members && members.members.some((m) => m.id === uid)) return true;
    if (members.admins.some((a) => a.id === uid)) return true;
    if (members.users.some((u) => u.id === uid)) return true;
    return false;
  };

  // Compile list of non-owner active members
  const nonOwnerMembers: MemberInfo[] =
    members.members && members.members.length > 0
      ? members.members.filter((m) => !members.owner || m.id !== members.owner.id)
      : [
          ...members.admins.map((a) => ({
            ...a,
            role: a.role || "admin",
            permissions: a.permissions || ADMIN_PERMISSIONS,
          })),
          ...members.users.map((u) => ({
            ...u,
            role: u.role || "user",
            permissions: u.permissions || VIEWER_PERMISSIONS,
          })),
        ];

  // Count active permissions for editingUser
  const grantedCount = editingUser
    ? PERMISSION_KEYS.filter((k) => Boolean(editingUser.permissions[k])).length
    : 0;

  const currentModalPreset = editingUser
    ? detectPermissionPreset(editingUser.permissions)
    : "viewer";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-900 pb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            Access & Granular Permissions
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Fine-grained access control across 7 categories and {TOTAL_PERMISSIONS_COUNT} permissions. Promote users with 1-click &quot;Make Admin&quot; or maintain individual custom overrides.
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
            You have read-only access to this server&apos;s roster. Only administrators with member management privileges can modify permissions.
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
            Server Team Roster ({nonOwnerMembers.length + (members.owner ? 1 : 0)})
          </CardTitle>
          <CardDescription className="text-xs text-zinc-400">
            Assigned roles and fine-grained permissions stored for this Minecraft server instance.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4 sm:p-6 space-y-5">
          {loadingMembers ? (
            <div className="py-8 flex justify-center text-zinc-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              {/* Owner Card */}
              {members.owner && (
                <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                      <Crown className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm truncate">
                          {members.owner.username}
                        </span>
                        <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px] font-mono font-bold uppercase">
                          Owner
                        </Badge>
                      </div>
                      <p className="text-[11px] font-mono text-zinc-500 truncate">{members.owner.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono text-amber-400/80 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                      Full Root Authority ({TOTAL_PERMISSIONS_COUNT}/{TOTAL_PERMISSIONS_COUNT})
                    </span>
                  </div>
                </div>
              )}

              {/* Members List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-zinc-400" />
                    Server Members ({nonOwnerMembers.length})
                  </h4>
                </div>

                {nonOwnerMembers.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-zinc-850 rounded-xl bg-zinc-950/20">
                    <UserIcon className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
                    <p className="text-xs text-zinc-500">No additional members added yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {nonOwnerMembers.map((member) => {
                      const perms = member.permissions || (
                        member.role === "admin" ? ADMIN_PERMISSIONS : VIEWER_PERMISSIONS
                      );
                      const preset = detectPermissionPreset(perms);
                      const activePermsCount = PERMISSION_KEYS.filter((k) => Boolean(perms[k])).length;
                      const isFullAdmin = preset === "admin";
                      const isUpdating = updatingId?.startsWith(member.id);

                      return (
                        <div
                          key={member.id}
                          className="p-4 rounded-xl border border-zinc-850 bg-zinc-950/60 hover:bg-zinc-950/90 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                        >
                          {/* Member Information & Badges */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 font-bold text-xs shrink-0">
                              {member.username.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white text-sm truncate">
                                  {member.username}
                                </span>

                                {/* Preset / Custom Role Badge */}
                                {preset === "admin" ? (
                                  <Badge className="bg-purple-500/10 border-purple-500/20 text-purple-400 text-[10px] font-mono font-bold uppercase">
                                    Admin ({TOTAL_PERMISSIONS_COUNT}/{TOTAL_PERMISSIONS_COUNT})
                                  </Badge>
                                ) : preset === "moderator" ? (
                                  <Badge className="bg-blue-500/10 border-blue-500/20 text-blue-400 text-[10px] font-mono font-bold uppercase">
                                    Moderator ({activePermsCount}/{TOTAL_PERMISSIONS_COUNT})
                                  </Badge>
                                ) : preset === "viewer" ? (
                                  <Badge className="bg-zinc-800 border-zinc-700 text-zinc-400 text-[10px] font-mono font-bold uppercase">
                                    Viewer ({activePermsCount}/{TOTAL_PERMISSIONS_COUNT})
                                  </Badge>
                                ) : (
                                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-[10px] font-mono font-bold uppercase">
                                    Custom ({activePermsCount}/{TOTAL_PERMISSIONS_COUNT})
                                  </Badge>
                                )}
                              </div>
                              <span className="text-[11px] font-mono text-zinc-500 truncate block">
                                {member.id}
                              </span>
                            </div>
                          </div>

                          {/* Member Action Controls */}
                          {canManage && (
                            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                              {/* 1-Click "Make Admin" Action Button */}
                              {!isFullAdmin && (
                                <Button
                                  size="sm"
                                  onClick={() => handleQuickMakeAdmin(member.id)}
                                  disabled={Boolean(isUpdating)}
                                  className="h-8 px-3 text-xs bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/30 font-semibold cursor-pointer transition-all flex items-center gap-1.5"
                                  title={`1-Click promote to full Administrator with all ${TOTAL_PERMISSIONS_COUNT} permissions`}
                                >
                                  {isUpdating ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                                  )}
                                  Make Admin
                                </Button>
                              )}

                              {/* Edit Permissions Modal Trigger */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenEditPermissions(member)}
                                disabled={Boolean(isUpdating)}
                                className="h-8 px-3 text-xs border-zinc-750 hover:bg-zinc-800 text-zinc-200 cursor-pointer flex items-center gap-1.5"
                                title="Open fine-grained permission editor"
                              >
                                <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                                Edit Permissions
                              </Button>

                              {/* Transfer Ownership Button */}
                              {isOwner && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleTransferOwnership(member.id)}
                                  disabled={Boolean(isUpdating)}
                                  className="h-8 px-2.5 text-xs text-amber-400 hover:bg-amber-500/10 cursor-pointer"
                                  title="Transfer ownership of server"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1" />
                                  Transfer
                                </Button>
                              )}

                              {/* Remove Member Button */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveMember(member.id)}
                                disabled={Boolean(isUpdating)}
                                className="h-8 w-8 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                                title="Remove member"
                              >
                                <UserMinus className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add New Members Section (Authorized only) */}
      {canManage && (
        <Card className="border-zinc-850 bg-zinc-900/20 backdrop-blur-md rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-zinc-900">
            <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-indigo-400" />
              Add Server Members
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              Search local registered accounts and quickly assign them as Admin, Viewer, or custom permissions.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-4 sm:p-6 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                placeholder="Search registered accounts by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-10 bg-zinc-900/80 border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600 rounded-xl"
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
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-950/40 hover:bg-zinc-900/40 transition-colors"
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
                          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900 px-2.5 py-1 rounded-lg border border-zinc-800">
                            Already Member
                          </span>
                        ) : (
                          <>
                            {/* 1-Click "Make Admin" button */}
                            <Button
                              size="sm"
                              onClick={() => handleQuickMakeAdmin(sr.id)}
                              disabled={Boolean(isBusy)}
                              className="h-8 px-3 text-xs bg-purple-600 hover:bg-purple-500 text-white font-semibold cursor-pointer shadow-sm flex items-center gap-1"
                              title="Add user immediately as full Administrator"
                            >
                              <Sparkles className="w-3.5 h-3.5 mr-0.5" />
                              + Make Admin
                            </Button>

                            {/* Add as standard Viewer */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleQuickMakeViewer(sr.id)}
                              disabled={Boolean(isBusy)}
                              className="h-8 px-3 text-xs border-zinc-800 hover:bg-zinc-800 text-zinc-300 cursor-pointer"
                              title="Add user as read-only Viewer"
                            >
                              + Viewer
                            </Button>

                            {/* Open Custom Permissions dialog */}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleOpenNewCustomPermissions(sr)}
                              disabled={Boolean(isBusy)}
                              className="h-8 px-2.5 text-xs text-indigo-400 hover:bg-indigo-500/10 cursor-pointer"
                              title="Customize permissions before adding"
                            >
                              <Sliders className="w-3.5 h-3.5 mr-1" />
                              Custom...
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

      {/* Granular Permissions Modal Dialog */}
      {editingUser && (
        <Dialog
          open={Boolean(editingUser)}
          onOpenChange={(open) => {
            if (!open) setEditingUser(null);
          }}
        >
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
            {/* Modal Header */}
            <DialogHeader className="pb-3 border-b border-zinc-800 shrink-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-indigo-400" />
                    Configure Granular Permissions
                  </DialogTitle>
                  <DialogDescription className="text-xs text-zinc-400 mt-1">
                    Fine-tune permissions for <span className="font-semibold text-white">@{editingUser.username}</span>.
                  </DialogDescription>
                </div>

                {/* Preset Badge */}
                <div className="shrink-0 pr-6">
                  {currentModalPreset === "admin" ? (
                    <Badge className="bg-purple-500/10 border-purple-500/20 text-purple-400 text-[10px] font-mono uppercase font-bold">
                      Preset: Administrator ({TOTAL_PERMISSIONS_COUNT}/{TOTAL_PERMISSIONS_COUNT})
                    </Badge>
                  ) : currentModalPreset === "moderator" ? (
                    <Badge className="bg-blue-500/10 border-blue-500/20 text-blue-400 text-[10px] font-mono uppercase font-bold">
                      Preset: Moderator ({grantedCount}/{TOTAL_PERMISSIONS_COUNT})
                    </Badge>
                  ) : currentModalPreset === "viewer" ? (
                    <Badge className="bg-zinc-800 border-zinc-700 text-zinc-400 text-[10px] font-mono uppercase font-bold">
                      Preset: Viewer ({grantedCount}/{TOTAL_PERMISSIONS_COUNT})
                    </Badge>
                  ) : (
                    <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-[10px] font-mono uppercase font-bold">
                      Custom ({grantedCount}/{TOTAL_PERMISSIONS_COUNT})
                    </Badge>
                  )}
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-2 pt-3 flex-wrap">
                <span className="text-[11px] font-mono uppercase text-zinc-500 font-semibold mr-1">
                  Quick Presets:
                </span>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => handleApplyPreset("admin")}
                  className={`h-7 px-2.5 text-xs font-semibold rounded-lg cursor-pointer ${
                    currentModalPreset === "admin"
                      ? "bg-purple-600 text-white border-purple-500"
                      : "border-zinc-800 hover:bg-zinc-850 text-purple-400"
                  }`}
                >
                  <Sparkles className="w-3 h-3 mr-1" />
                  Make Admin (All {TOTAL_PERMISSIONS_COUNT})
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => handleApplyPreset("moderator")}
                  className={`h-7 px-2.5 text-xs font-semibold rounded-lg cursor-pointer ${
                    currentModalPreset === "moderator"
                      ? "bg-blue-600 text-white border-blue-500"
                      : "border-zinc-800 hover:bg-zinc-850 text-blue-400"
                  }`}
                >
                  Moderator
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => handleApplyPreset("viewer")}
                  className={`h-7 px-2.5 text-xs font-semibold rounded-lg cursor-pointer ${
                    currentModalPreset === "viewer"
                      ? "bg-zinc-700 text-white border-zinc-600"
                      : "border-zinc-800 hover:bg-zinc-850 text-zinc-300"
                  }`}
                >
                  Viewer
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => handleApplyPreset("clear")}
                  className="h-7 px-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 cursor-pointer ml-auto"
                >
                  Clear All
                </Button>
              </div>
            </DialogHeader>

            {/* Scrollable Categories List */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 scrollbar-thin scrollbar-thumb-zinc-800">
              {PERMISSION_CATEGORIES.map((category) => {
                const Icon = CATEGORY_ICONS[category.id] || Shield;
                const categoryActiveCount = category.permissions.filter((p) =>
                  Boolean(editingUser.permissions[p.key])
                ).length;

                return (
                  <div
                    key={category.id}
                    className="border border-zinc-850 rounded-xl bg-zinc-900/40 p-3.5 space-y-3"
                  >
                    {/* Category Title */}
                    <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400">
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-white leading-tight">
                            {category.name}
                          </h4>
                          <p className="text-[10px] text-zinc-500">
                            {category.description}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-500">
                        {categoryActiveCount}/{category.permissions.length} granted
                      </span>
                    </div>

                    {/* Permissions list */}
                    <div className="space-y-2 pt-1">
                      {category.permissions.map((perm) => {
                        const isGranted = Boolean(editingUser.permissions[perm.key]);
                        return (
                          <div
                            key={perm.key}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleTogglePermission(perm.key)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleTogglePermission(perm.key);
                              }
                            }}
                            className={cn(
                              "p-2.5 rounded-lg border transition-colors flex items-center justify-between gap-3 cursor-pointer select-none",
                              isGranted
                                ? "border-emerald-500/30 bg-emerald-950/15 hover:bg-emerald-950/25"
                                : "border-zinc-850/60 bg-zinc-950/40 hover:bg-zinc-950/80"
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "text-xs font-semibold block transition-colors",
                                  isGranted ? "text-emerald-300" : "text-zinc-200"
                                )}
                              >
                                {perm.label}
                              </span>
                              <span className="text-[10px] text-zinc-500 block">
                                {perm.description}
                              </span>
                            </div>

                            <div className="pointer-events-none shrink-0">
                              <Switch
                                checked={isGranted}
                                tabIndex={-1}
                                readOnly
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <DialogFooter className="pt-3 border-t border-zinc-800 shrink-0 flex items-center justify-between sm:justify-between">
              <span className="text-xs font-mono text-zinc-500">
                {grantedCount} of {TOTAL_PERMISSIONS_COUNT} permissions granted
              </span>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingUser(null)}
                  disabled={modalSaving}
                  className="h-9 px-4 text-xs text-zinc-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSavePermissionsModal}
                  disabled={modalSaving}
                  className="h-9 px-5 text-xs font-bold bg-white text-black hover:bg-zinc-200 cursor-pointer flex items-center gap-1.5"
                >
                  {modalSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  Save Permissions
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

