import type { AccountStatus, Role } from "@prisma/client";

export type Permission =
  | "book:submit"
  | "book:review-pool"
  | "book:manage"
  | "user:promote-author"
  | "user:manage-staff"
  | "user:moderate"
  | "homepage:propose"
  | "homepage:approve"
  | "finance:view"
  | "finance:adjust"
  | "wallet:use"
  | "giftcard:use"
  | "engage:comment";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  READER: ["book:submit", "wallet:use", "giftcard:use", "engage:comment"],
  AUTHOR: ["book:submit", "wallet:use", "giftcard:use", "engage:comment"],
  EDITOR: ["book:review-pool", "book:manage", "user:promote-author", "homepage:propose", "engage:comment"],
  ACCOUNTING: ["finance:view", "finance:adjust"],
  // Admins hold editor privileges too (emergencies / testing).
  ADMIN: [
    "book:review-pool", "book:manage", "user:promote-author", "user:manage-staff", "user:moderate",
    "homepage:propose", "homepage:approve", "finance:view", "engage:comment",
  ],
};

export function can(user: { role: Role; status: AccountStatus } | null, perm: Permission): boolean {
  if (!user || user.status === "BLOCKED") return false;
  if (user.status === "RESTRICTED" && (perm === "engage:comment" || perm === "book:submit")) return false;
  return ROLE_PERMISSIONS[user.role].includes(perm);
}
