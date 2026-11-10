"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { dollarsToCents, flash, runAction, str, type FormState } from "@/lib/form";
import { buyGiftCard, purchaseBook, purchaseMedia, redeemGiftCard, transfer } from "@/lib/wallet";
import { can } from "@/lib/rbac";
import { flagUser, submitAppeal } from "@/lib/moderation";
import { deleteComment, deleteReview, postComment, saveReview, toggleLike, toggleWishlist } from "@/lib/engagement";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

export type { FormState };

async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

async function walletUser() {
  const user = await requireUser();
  if (!can(user, "wallet:use")) throw new DomainError("FORBIDDEN", "Your account can't use a wallet.");
  return user;
}

const guard = async (fn: () => Promise<FormState>): Promise<FormState> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
};

export async function buyAction(_: FormState, form: FormData): Promise<FormState> {
  return guard(async () => {
    const user = await walletUser();
    const sectionId = str(form, "sectionId") || undefined;
    return runAction(() => purchaseBook(user.id, str(form, "bookId"), sectionId), "Purchased! Enjoy reading.");
  });
}

export async function buyMediaAction(_: FormState, form: FormData): Promise<FormState> {
  return guard(async () => {
    const user = await walletUser();
    const kind = str(form, "kind") === "VIDEO" ? "VIDEO" : "AUDIO";
    return runAction(() => purchaseMedia(user.id, str(form, "bookId"), kind), kind === "AUDIO" ? "Audiobook unlocked." : "Video unlocked.");
  });
}

export async function toggleWishlistAction(form: FormData) {
  const user = await requireUser();
  await toggleWishlist(user, str(form, "bookId")).catch(() => undefined);
  revalidatePath(`/books/${str(form, "code")}`);
}

export async function toggleLikeAction(form: FormData) {
  const user = await requireUser();
  await toggleLike(user, str(form, "bookId")).catch(() => undefined);
  revalidatePath(`/books/${str(form, "code")}`);
}

export async function reviewAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return runAction(() => saveReview(user, str(form, "bookId"), Number(str(form, "rating")), str(form, "body")), "Review saved. Thank you!", `/books/${str(form, "code")}`);
}

export async function deleteReviewAction(form: FormData) {
  const user = await requireUser();
  await deleteReview(user, str(form, "reviewId")).catch(() => undefined);
  await flash("Review deleted.");
  revalidatePath(`/books/${str(form, "code")}`);
}

export async function postCommentAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!(await rateLimit(`comment:${user.id}`, LIMITS.comment.limit, LIMITS.comment.window))) return { error: "You're commenting too fast. Wait a few minutes." };
  return runAction(
    () => postComment(user, str(form, "chapterId"), str(form, "body"), str(form, "parentId") || undefined),
    "Comment posted.",
    str(form, "path") || "/",
  );
}

export async function deleteCommentAction(form: FormData) {
  const user = await requireUser();
  await deleteComment(user, str(form, "commentId")).catch(() => undefined);
  await flash("Comment deleted.");
  revalidatePath(str(form, "path") || "/");
}

export async function transferAction(_: FormState, form: FormData): Promise<FormState> {
  return guard(async () => {
    const user = await walletUser();
    const cents = dollarsToCents(str(form, "amount"));
    if (Number.isNaN(cents)) return { error: "Enter an amount like 5.00" };
    return runAction(() => transfer(user.id, str(form, "email"), cents), "Transfer sent.", "/dashboard");
  });
}

export async function buyGiftCardAction(_: FormState, form: FormData): Promise<FormState> {
  return guard(async () => {
    const user = await walletUser();
    if (!can(user, "giftcard:use")) return { error: "Your account can't use gift cards." };
    const cents = dollarsToCents(str(form, "amount"));
    if (Number.isNaN(cents) || cents < 100) return { error: "Gift cards start at 1.00" };
    const card = await buyGiftCard(user.id, cents);
    revalidatePath("/dashboard");
    return { ok: `Gift card created: ${card.code} (valid until ${card.expiresAt.toDateString()}). Share the code or the link /gift/${card.code}` };
  });
}

export async function redeemGiftCardAction(_: FormState, form: FormData): Promise<FormState> {
  return guard(async () => {
    const user = await walletUser();
    if (!(await rateLimit(`redeem:${user.id}`, 10, 3600))) return { error: "Too many attempts. Try again later." };
    return runAction(() => redeemGiftCard(user.id, str(form, "code")), "Gift card added to your wallet.", "/dashboard");
  });
}

export async function flagAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!(await rateLimit(`flag:${user.id}`, LIMITS.flag.limit, LIMITS.flag.window))) return { error: "Too many reports. Try again later." };
  return runAction(() => flagUser(user.id, str(form, "targetId"), str(form, "reason"), str(form, "commentId") || undefined), "Thanks, our team will look into it.");
}

export async function appealAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return runAction(() => submitAppeal(user.id, str(form, "message")), "Appeal sent. An admin will review it.", "/dashboard");
}
