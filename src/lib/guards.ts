import "server-only";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { currentUser } from "./auth";
import { db } from "./db";

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.status === "BLOCKED") redirect("/dashboard");
  return user;
}

export async function requireRole(...roles: Role[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

/** Editors, and admins acting as editors (an editor profile is created for admins on first use). */
export async function requireEditor() {
  const user = await requireRole("EDITOR", "ADMIN");
  let profile = user.editorProfile;
  if (!profile) {
    profile = await db.editorProfile.create({ data: { userId: user.id, contactEmail: user.email, genres: [], languages: [] } });
  }
  return { user, editor: profile };
}

export async function requireAuthor() {
  const user = await requireRole("AUTHOR");
  if (!user.authorProfile) redirect("/dashboard");
  return { user, author: user.authorProfile };
}
