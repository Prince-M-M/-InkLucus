import type { Role } from "@prisma/client";
import { db } from "./db";
import { DomainError } from "./errors";

const PLATFORMS = ["discord", "facebook", "whatsapp", "telegram", "instagram", "x", "other"] as const;

async function requireAdmin(actorId: string) {
  const a = await db.user.findUnique({ where: { id: actorId } });
  if (!a || a.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Admins only");
}

export async function addSocialLink(actorId: string, data: { audience: Role; platform: string; label: string; url: string }) {
  await requireAdmin(actorId);
  let u: URL;
  try {
    u = new URL(data.url);
  } catch {
    throw new DomainError("INVALID", "Enter a full link starting with https://");
  }
  if (u.protocol !== "https:") throw new DomainError("INVALID", "Links must start with https://");
  if (!PLATFORMS.includes(data.platform as (typeof PLATFORMS)[number])) throw new DomainError("INVALID", "Choose a platform");
  if (!data.label.trim()) throw new DomainError("INVALID", "Give the link a label");
  return db.socialLink.create({ data: { audience: data.audience, platform: data.platform, label: data.label.trim().slice(0, 80), url: u.toString() } });
}

export async function removeSocialLink(actorId: string, id: string) {
  await requireAdmin(actorId);
  await db.socialLink.deleteMany({ where: { id } });
}

export { PLATFORMS };
