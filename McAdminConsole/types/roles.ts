export enum InstanceRole {
  SUPERUSER = "SUPERUSER",
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  USER = "USER",
}

// Alias for backwards compatibility
export const UserRole = InstanceRole;
export type UserRole = InstanceRole;

export function parseInstanceRole(roleStr?: string | null): InstanceRole {
  if (!roleStr) return InstanceRole.USER;
  const upper = roleStr.toUpperCase();
  if (upper === "SUPERUSER" || upper === "SUPERADMIN") return InstanceRole.SUPERUSER;
  if (upper === "OWNER") return InstanceRole.OWNER;
  if (upper === "ADMIN") return InstanceRole.ADMIN;
  return InstanceRole.USER;
}
