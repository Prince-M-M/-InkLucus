import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SubmissionForm } from "@/components/SubmissionForm";
import { Card, Notice } from "@/components/ui";

const REQUIREMENTS = [
  "The work is your own original writing and you hold the rights to it.",
  "Submit at least the first 3 chapters (up to 30) so an editor can judge the story.",
  "The book is in one of our languages (English, Shona or Ndebele) and is clearly tagged with it.",
  "Content suits the age rating you choose. Books with explicit content must be rated 18+.",
  "If accepted, you'll sign a contract with your editor before the book goes on sale. Profit is shared according to that contract.",
];

export default async function BecomeAnAuthor() {
  const user = await currentUser();
  if (user?.role === "AUTHOR") redirect("/author/submit");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">I want to be an author</h1>
      <Card title="Requirements">
        <ul className="list-disc space-y-1 pl-5 text-sm">{REQUIREMENTS.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          Your submission goes to our editors. The first editor who takes it on reviews it and leaves you a message on your account.
          If it&apos;s accepted, your account becomes an author account straight away.
        </p>
      </Card>
      {!user ? (
        <Notice>To submit, <Link href="/register" className="underline">create a free account</Link> or <Link href="/login" className="underline">log in</Link>.</Notice>
      ) : user.role !== "READER" ? (
        <Notice tone="warn">Staff accounts can&apos;t submit books.</Notice>
      ) : user.status !== "ACTIVE" ? (
        <Notice tone="warn">Your account is {user.status.toLowerCase()} and can&apos;t submit books.</Notice>
      ) : (
        <Card title="Submission form"><SubmissionForm showReferral /></Card>
      )}
    </div>
  );
}
