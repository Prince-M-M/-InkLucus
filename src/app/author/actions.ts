"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/guards";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { addChapter, submitBook } from "@/lib/submissions";
import { parseManuscript } from "@/lib/manuscript";
import { DomainError } from "@/lib/errors";
import { GENRES, LANGUAGES } from "@/lib/catalog";
import { list, optStr, runAction, str, type FormState } from "@/lib/form";

const submission = z.object({
  title: z.string().min(1, "Title is required").max(150),
  synopsis: z.string().min(20, "Synopsis should be at least 20 characters").max(3000),
  language: z.enum(Object.keys(LANGUAGES) as [string, ...string[]]),
  genres: z.array(z.enum(GENRES as [string, ...string[]])).min(1, "Pick at least one genre").max(3, "Pick up to 3 genres"),
  ageRating: z.enum(["ALL", "TEEN_13", "MATURE_16", "ADULT_18"]),
  manuscript: z.string().min(1, "Paste at least one chapter"),
});

/** Used by both "I want to be an author" (readers → pool) and "Submit new book" (authors → their editor). */
export async function submitBookAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!can(user, "book:submit")) return { error: "Your account cannot submit books." };
  if (form.get("agree") !== "on") return { error: "Please confirm the requirements." };
  if (!(await rateLimit(`submit:${user.id}`, LIMITS.submit.limit, LIMITS.submit.window))) return { error: "You've submitted several books today. Try again tomorrow." };

  const parsed = submission.safeParse({
    title: str(form, "title"), synopsis: str(form, "synopsis"), language: str(form, "language"),
    genres: list(form, "genres"), ageRating: str(form, "ageRating") || "ALL", manuscript: str(form, "manuscript"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let book;
  try {
    book = await submitBook(user.id, {
      ...parsed.data,
      chapters: parseManuscript(parsed.data.manuscript),
      note: optStr(form, "note"),
      referralCode: optStr(form, "referralCode"),
      penNameId: optStr(form, "penNameId"),
    });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect(user.role === "AUTHOR" ? `/author/books/${book.id}?submitted=1` : "/dashboard?submitted=1");
}

export async function addChapterAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const bookId = str(form, "bookId");
  return runAction(() => addChapter(user.id, bookId, { title: str(form, "title"), content: str(form, "content") }), "Chapter posted.", `/author/books/${bookId}`);
}
