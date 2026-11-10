import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { mediaAccess } from "@/lib/reading";

/** Gatekeeper for paid audio/video: checks access, then redirects to the media file. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await db.mediaItem.findUnique({ where: { id }, include: { book: true } });
  if (!item || item.book.status !== "ON_SALE") return new Response("Not found", { status: 404 });
  const user = await currentUser();
  if (!(await mediaAccess(user, item.bookId, item.kind))) return new Response("Purchase required", { status: 403 });
  return new Response(null, { status: 302, headers: { Location: item.url, "Cache-Control": "private, no-store" } });
}
