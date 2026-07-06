"use server";

import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { UserRole, getUserRole, canAccessManageUser } from "@/types/roles";
import { revalidatePath } from "next/cache";

export async function updateUserRole(targetUserId: string, newRole: UserRole) {
  const curUser = await currentUser();
  if (!curUser) {
    throw new Error("Unauthorized: You must be logged in to update roles.");
  }

  const curRole = getUserRole(curUser.publicMetadata);

  // Check access permissions based on production vs development rules
  if (!canAccessManageUser(curRole)) {
    throw new Error("Forbidden: Only the OWNER is authorized to change user roles in production.");
  }

  // Prevent self-demotion or self-modification in production
  if (process.env.NODE_ENV === "production" && curUser.id === targetUserId) {
    throw new Error("Forbidden: You cannot change your own role in production.");
  }

  const client = await clerkClient();
  await client.users.updateUserMetadata(targetUserId, {
    publicMetadata: {
      role: newRole,
    },
  });

  revalidatePath("/manageuser");
  revalidatePath("/dashboard");
  return { success: true };
}
