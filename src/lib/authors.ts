import { db } from "./db";
import { DomainError } from "./errors";
import { formatAuthorCode, slugify } from "./codes";

export const MAX_PEN_NAMES = 5;
export const DEFAULT_REFERRAL_CODE = "AA0000"; // "direct / no referral"

/**
 * Converts an account into an author account and assigns its internal identity code.
 * The per-referral counter is incremented atomically so two simultaneous sign-ups
 * under the same referral can never get the same author number.
 */
export async function promoteToAuthor(opts: { userId: string; actorUserId: string; referralCode?: string; editorId?: string }) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: opts.userId }, include: { authorProfile: true } });
    if (!user) throw new DomainError("NOT_FOUND", "User not found");
    if (user.authorProfile) return user.authorProfile;
    if (user.role !== "READER") throw new DomainError("INVALID", `Cannot convert a ${user.role} account to an author`);

    const referral = await tx.referral.upsert({
      where: { code: opts.referralCode ?? DEFAULT_REFERRAL_CODE },
      update: { authorCount: { increment: 1 } },
      create: { code: opts.referralCode ?? DEFAULT_REFERRAL_CODE, label: "Direct", authorCount: 1 },
    });

    const profile = await tx.authorProfile.create({
      data: {
        userId: user.id,
        referralId: referral.id,
        authorNumber: referral.authorCount,
        internalCode: formatAuthorCode(referral.code, referral.authorCount),
        editorId: opts.editorId,
      },
    });
    await tx.user.update({ where: { id: user.id }, data: { role: "AUTHOR" } });
    await tx.roleChange.create({ data: { userId: user.id, actorId: opts.actorUserId, fromRole: user.role, toRole: "AUTHOR" } });
    return profile;
  });
}

export async function addPenName(authorId: string, name: string, editorId?: string) {
  const count = await db.penName.count({ where: { authorId } });
  if (count >= MAX_PEN_NAMES) throw new DomainError("LIMIT", `Authors can have at most ${MAX_PEN_NAMES} pen names`);
  return db.penName.create({ data: { authorId, name: name.trim(), slug: slugify(name), editorId } });
}
