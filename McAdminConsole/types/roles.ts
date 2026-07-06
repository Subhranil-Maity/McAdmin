export enum UserRole {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  NORMUSER = "NORMUSER"
}

export type Permission = 
  | "view_dashboard"
  | "view_users"
  | "manage_roles";

// Role-to-permission mapping for production
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.OWNER]: ["view_dashboard", "view_users", "manage_roles"],
  [UserRole.ADMIN]: ["view_dashboard", "view_users"],
  [UserRole.NORMUSER]: ["view_dashboard"],
};

/**
 * Safely parse role from Clerk public metadata with a default fallback to NORMUSER.
 */
export function getUserRole(publicMetadata: any): UserRole {
  const role = publicMetadata?.role;
  if (role && Object.values(UserRole).includes(role as UserRole)) {
    return role as UserRole;
  }
  return UserRole.NORMUSER;
}

/**
 * Check if the user has permission based on role and environment.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  // If in development mode, we bypass restrictions for viewing/managing users
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  // In production:
  // - Only OWNER can manage roles
  // - OWNER and ADMIN can view users/dashboard
  if (permission === "manage_roles") {
    return role === UserRole.OWNER;
  }
  if (permission === "view_users") {
    return role === UserRole.OWNER || role === UserRole.ADMIN;
  }
  
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Check if a user can access the /manageuser route.
 * In development, anyone can visit it.
 * In production, only OWNER can visit it.
 */
export function canAccessManageUser(role: UserRole): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  return role === UserRole.OWNER;
}
