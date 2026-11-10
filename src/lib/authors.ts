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

export async function addPenName(authorId: string, name: string, editorId?: string, bio?: string) {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 60) throw new DomainError("INVALID", "Pen names must be 2–60 characters");
  const count = await db.penName.count({ where: { authorId } });
  if (count >= MAX_PEN_NAMES) throw new DomainError("LIMIT", `Authors can have at most ${MAX_PEN_NAMES} pen names`);
  const slug = slugify(clean);
  if (!slug) throw new DomainError("INVALID", "Pen name needs letters or numbers");
  if (await db.penName.findFirst({ where: { OR: [{ slug }, { name: { equals: clean, mode: "insensitive" } }] } })) {
    throw new DomainError("CONFLICT", "That pen name is already taken");
  }
  return db.penName.create({ data: { authorId, name: clean, slug, editorId, bio: bio?.trim() || null } });
}

/** Pen names are managed by editors. An editor may manage pen names of their own authors; admins of anyone. */
export async function assertCanManageAuthor(actor: { role: string; editorProfile: { id: string } | null }, authorId: string) {
  if (actor.role === "ADMIN") return;
  const author = await db.authorProfile.findUnique({ where: { id: authorId } });
  if (!author || !actor.editorProfile || author.editorId !== actor.editorProfile.id) {
    throw new DomainError("FORBIDDEN", "This author is not assigned to you");
  }
}
