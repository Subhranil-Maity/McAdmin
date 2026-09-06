"use server";

import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { UserRole, getUserRole, canAccessManageUser } from "@/types/roles";
import { revalidatePath } from "next/cache";

export interface UserSearchResult {
  id: string;
  fullName: string;
  email: string;
  imageUrl: string;
  role: UserRole;
}

export async function updateUserRole(targetUserId: string, newRole: UserRole) {
  const curUser = await currentUser();
  if (!curUser) {
    throw new Error("Unauthorized: You must be logged in to update roles.");
  }

  const curRole = getUserRole(curUser.publicMetadata);

  if (!canAccessManageUser(curRole)) {
    throw new Error("Forbidden: Only SUPERADMIN is authorized to change user roles in production.");
  }

  if (process.env.NODE_ENV === "production" && curUser.id === targetUserId && curRole !== UserRole.SUPERADMIN) {
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

export async function searchUsers(query: string = ""): Promise<UserSearchResult[]> {
  const user = await currentUser();
  if (!user) {
    return [];
  }

  const client = await clerkClient();
  const response = await client.users.getUserList({
    query: query.trim() || undefined,
    limit: 50,
  });

  return response.data.map((u) => {
    const email = u.emailAddresses[0]?.emailAddress || "No email";
    const name =
      u.fullName ||
      [u.firstName, u.lastName].filter(Boolean).join(" ") ||
      u.username ||
      "Anonymous User";

    return {
      id: u.id,
      fullName: name,
      email,
      imageUrl: u.imageUrl || "",
      role: getUserRole(u.publicMetadata),
    };
  });
}
