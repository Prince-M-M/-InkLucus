"use server";
import { redirect } from "next/navigation";
import type { HomepageList } from "@prisma/client";
import { proposeSlot, withdrawProposal } from "@/lib/homepage";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/guards";
import { claimFromPool, decide, putOnSale, returnToPool, unlist } from "@/lib/submissions";
import { addPenName, assertCanManageAuthor, promoteToAuthor } from "@/lib/authors";
import { DomainError } from "@/lib/errors";
import { dollarsToCents, flash, int, list, optStr, runAction, str, type FormState } from "@/lib/form";

export async function claimAction(form: FormData) {
  const { editor } = await requireEditor();
  const bookId = str(form, "bookId");
  try {
    await claimFromPool(bookId, editor.id);
  } catch (e) {
    if (e instanceof DomainError) redirect("/editor?error=claimed");
    throw e;
  }
  redirect(`/editor/books/${bookId}`);
}

export async function returnToPoolAction(_: FormState, form: FormData): Promise<FormState> {
  const { editor } = await requireEditor();
  const res = await runAction(() => returnToPool(str(form, "bookId"), editor.id, list(form, "genres")), "Returned to the pool.", "/editor");
  if (res?.error) return res;
  redirect("/editor");
}

export async function decideAction(_: FormState, form: FormData): Promise<FormState> {
  const { editor } = await requireEditor();
  const accept = str(form, "decision") === "accept";
  const bookId = str(form, "bookId");
  return runAction(() => decide(bookId, editor.id, accept, str(form, "message")), accept ? "Accepted. The submitter is now an author." : "Rejected and the submitter has been notified.", `/editor/books/${bookId}`);
}

export async function publishAction(_: FormState, form: FormData): Promise<FormState> {
  const { editor } = await requireEditor();
  const bookId = str(form, "bookId");
  const wholeBookPriceCents = dollarsToCents(str(form, "wholePrice"));
  const sectionPrice = str(form, "sectionPrice");
  const sectionPriceCents = sectionPrice ? dollarsToCents(sectionPrice) : undefined;
  const chaptersPerSection = str(form, "chaptersPerSection") ? int(form, "chaptersPerSection") : undefined;
  const signed = new Date(str(form, "signedAt"));
  if (Number.isNaN(wholeBookPriceCents) || Number.isNaN(sectionPriceCents ?? 0)) return { error: "Prices must look like 4.99" };
  if (Number.isNaN(chaptersPerSection ?? 0) || (chaptersPerSection !== undefined && chaptersPerSection < 1)) return { error: "Chapters per section must be a whole number" };
  if ((sectionPriceCents === undefined) !== (chaptersPerSection === undefined)) return { error: "Set both section size and section price, or neither" };
  if (Number.isNaN(signed.getTime())) return { error: "Enter the contract signing date" };
  return runAction(
    () => putOnSale({
      bookId, editorProfileId: editor.id, penNameId: str(form, "penNameId"), lockChapter: int(form, "lockChapter"),
      wholeBookPriceCents, chaptersPerSection, sectionPriceCents, editorReview: optStr(form, "editorReview"),
      isbn: optStr(form, "isbn"), royaltyPercent: int(form, "royaltyPercent"), contractSignedAt: signed,
    }),
    "Published! The book is now on sale and listed under New Books.",
    `/editor/books/${bookId}`,
  );
}

export async function unlistAction(_: FormState, form: FormData): Promise<FormState> {
  const { editor } = await requireEditor();
  const bookId = str(form, "bookId");
  return runAction(() => unlist(bookId, editor.id), "Book unlisted.", `/editor/books/${bookId}`);
}

/** Convert a reader account to an author account when a new author signs outside the submission flow. */
export async function promoteReaderAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, editor } = await requireEditor();
  const target = await db.user.findUnique({ where: { email: str(form, "email").toLowerCase() } });
  if (!target) return { error: "No account with that email." };
  const referralCode = optStr(form, "referralCode")?.toUpperCase();
  if (referralCode && !/^[A-Z]{2}\d{4}$/.test(referralCode)) return { error: "Referral codes look like AA1234" };
  let code = "";
  const res = await runAction(async () => {
    const p = await promoteToAuthor({ userId: target.id, actorUserId: user.id, editorId: editor.id, referralCode });
    code = p.internalCode;
  }, "", "/editor");
  if (res?.error) return res;
  const ok = `${target.displayName} is now an author (ID ${code}).`;
  await flash(ok);
  return { ok };
}

export async function addPenNameAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, editor } = await requireEditor();
  const authorId = str(form, "authorId");
  return runAction(async () => {
    await assertCanManageAuthor(user, authorId);
    await addPenName(authorId, str(form, "name"), optStr(form, "editorId") ?? editor.id, optStr(form, "bio"));
  }, "Pen name added.", "/editor");
}


export async function proposeSlotAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, editor } = await requireEditor();
  const periodStart = new Date(str(form, "period"));
  if (Number.isNaN(periodStart.getTime())) return { error: "Choose a period" };
  return runAction(
    () => proposeSlot({ editorProfileId: editor.id, isAdmin: user.role === "ADMIN" }, { bookId: str(form, "bookId"), list: str(form, "list") as HomepageList, periodStart }),
    "Proposed. An admin will review it.",
    "/editor",
  );
}

export async function withdrawProposalAction(form: FormData) {
  const { editor } = await requireEditor();
  await withdrawProposal(editor.id, str(form, "slotId")).catch(() => undefined);
  redirect("/editor?tab=homepage");
}
