"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, currentUser, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { buyGiftCard, purchaseBook, redeemGiftCard, transfer } from "@/lib/wallet";
import { can } from "@/lib/rbac";

export type FormState = { error?: string; ok?: string } | undefined;

const credentials = z.object({ email: z.string().email().transform((e) => e.toLowerCase()), password: z.string().min(8) });

export async function register(_: FormState, form: FormData): Promise<FormState> {
  const parsed = credentials.extend({ displayName: z.string().min(2).max(40) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter a name, a valid email and a password of at least 8 characters." };
  const { email, password, displayName } = parsed.data;
  if (await db.user.findUnique({ where: { email } })) return { error: "An account with that email already exists." };
  const user = await db.user.create({ data: { email, displayName, passwordHash: await hashPassword(password), wallet: { create: {} } } });
  await createSession(user.id);
  redirect("/dashboard");
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = credentials.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Invalid email or password." };
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return { error: "Invalid email or password." };
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/");
}

async function run(fn: () => Promise<unknown>, ok: string): Promise<FormState> {
  try {
    await fn();
    revalidatePath("/", "layout");
    return { ok };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function buyAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!can(user, "wallet:use")) return { error: "Your account cannot make purchases." };
  const sectionId = (form.get("sectionId") as string) || undefined;
  return run(() => purchaseBook(user.id, String(form.get("bookId")), sectionId), "Purchased! Enjoy reading.");
}

export async function toggleWishlist(form: FormData) {
  const user = await requireUser();
  const bookId = String(form.get("bookId"));
  const key = { userId_bookId: { userId: user.id, bookId } };
  if (await db.wishlistItem.findUnique({ where: key })) await db.wishlistItem.delete({ where: key });
  else await db.wishlistItem.create({ data: { userId: user.id, bookId } });
  revalidatePath(`/books/${form.get("code")}`);
}

export async function transferAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const cents = Math.round(Number(form.get("amount")) * 100);
  return run(() => transfer(user.id, String(form.get("email")), cents), "Transfer sent.");
}

export async function buyGiftCardAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const cents = Math.round(Number(form.get("amount")) * 100);
  try {
    const card = await buyGiftCard(user.id, cents);
    revalidatePath("/dashboard");
    return { ok: `Gift card created: ${card.code} (valid until ${card.expiresAt.toDateString()})` };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function redeemGiftCardAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => redeemGiftCard(user.id, String(form.get("code"))), "Gift card added to your wallet.");
}

export async function postComment(form: FormData) {
  const user = await requireUser();
  if (!can(user, "engage:comment")) return;
  const chapterId = String(form.get("chapterId"));
  const body = String(form.get("body") ?? "").trim().slice(0, 4000);
  if (!body) return;
  const chapter = await db.chapter.findUniqueOrThrow({ where: { id: chapterId }, include: { book: { include: { penName: true } } } });
  // The book's author automatically comments under their pen name with an "Author" badge.
  const isAuthor = !!chapter.book.penName && chapter.book.penName.authorId === user.authorProfile?.id;
  await db.comment.create({ data: { chapterId, userId: user.id, body, parentId: (form.get("parentId") as string) || null, asPenNameId: isAuthor ? chapter.book.penNameId : null } });
  revalidatePath(`/books/${chapter.book.code}/${chapter.number}`);
}
