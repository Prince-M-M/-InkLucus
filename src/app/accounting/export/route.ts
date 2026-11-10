import { currentUser } from "@/lib/auth";
import { purchasesByBook, toCsv } from "@/lib/reports";
import { reportPeriod } from "@/lib/periods";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "ACCOUNTING" && user.role !== "ADMIN") || user.status !== "ACTIVE") return new Response("Forbidden", { status: 403 });
  const p = reportPeriod(new URL(req.url).searchParams.get("period") ?? undefined);
  const rows = await purchasesByBook(p);
  const csv = toCsv(rows.map((r) => ({
    code: r.code, title: r.title, pen_name: r.penName, isbn: r.isbn, copies: r.copies,
    text: (r.textCents / 100).toFixed(2), audio: (r.audioCents / 100).toFixed(2), video: (r.videoCents / 100).toFixed(2), total: (r.totalCents / 100).toFixed(2),
  })), ["code", "title", "pen_name", "isbn", "copies", "text", "audio", "video", "total"]);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="purchases-${p.key}.csv"`, "Cache-Control": "no-store" },
  });
}
