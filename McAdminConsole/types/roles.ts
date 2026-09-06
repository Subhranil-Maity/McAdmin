export enum UserRole {
  SUPERADMIN = "SUPERADMIN",
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  NORMUSER = "NORMUSER"
}

export type Permission = 
  | "view_dashboard"
  | "view_users"
  | "manage_roles"
  | "manage_all_servers";

// Role-to-permission mapping for production
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPERADMIN]: ["view_dashboard", "view_users", "manage_roles", "manage_all_servers"],
  [UserRole.OWNER]: ["view_dashboard", "view_users", "manage_roles"],
  [UserRole.ADMIN]: ["view_dashboard", "view_users"],
  [UserRole.NORMUSER]: ["view_dashboard"],
};

/**
 * Safely parse role from Clerk public metadata with a default fallback to NORMUSER.
 */
export function getUserRole(publicMetadata: Record<string, unknown> | null | undefined): UserRole {
  const role = typeof publicMetadata?.role === "string" ? publicMetadata.role.toUpperCase() : null;
  if (role && Object.values(UserRole).includes(role as UserRole)) {
    return role as UserRole;
  }
  return UserRole.NORMUSER;
}

/**
 * Check if the user has permission based on role and environment.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  if (role === UserRole.SUPERADMIN) {
    return true;
  }

  if (permission === "manage_roles" || permission === "view_users") {
    return false;
  }
  
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Check if a user can access the /manageuser route.
 * In development, anyone can visit it.
 * In production, only SUPERADMIN can visit it.
 */
export function canAccessManageUser(role: UserRole): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  return role === UserRole.SUPERADMIN;
}
