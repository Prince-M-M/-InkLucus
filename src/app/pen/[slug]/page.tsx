import { notFound } from "next/navigation";
import { BookCard } from "@/components/BookCard";
import { db } from "@/lib/db";
import { bookCardSelect } from "@/lib/catalog";

export default async function PenNamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pen = await db.penName.findUnique({ where: { slug }, include: { books: { where: { status: "ON_SALE" }, select: bookCardSelect } } });
  if (!pen) notFound();
  return (
    <>
      <h1 className="text-2xl font-bold">{pen.name}</h1>
      {pen.bio && <p className="mt-2 max-w-2xl text-stone-600 dark:text-stone-400">{pen.bio}</p>}
      <div className="mt-8 flex flex-wrap gap-6">{pen.books.map((b) => <BookCard key={b.code} book={b} />)}</div>
    </>
  );
}
