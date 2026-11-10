import { db } from "@/lib/db";
import { requireAuthor } from "@/lib/guards";
import { SubmissionForm } from "@/components/SubmissionForm";
import { Card } from "@/components/ui";

export default async function SubmitNewBook() {
  const { author } = await requireAuthor();
  const penNames = await db.penName.findMany({ where: { authorId: author.id }, select: { id: true, name: true } });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Submit a new book</h1>
      <p className="text-sm text-stone-600 dark:text-stone-400">This goes straight to your editor. If it&apos;s outside their genre, they can pass it to the editors who handle that genre.</p>
      <Card><SubmissionForm penNames={penNames} showReferral={false} /></Card>
    </div>
  );
}
