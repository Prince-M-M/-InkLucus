import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { DomainError } from "./errors";

export const MAX_COVER_BYTES = 2 * 1024 * 1024;
const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
export type ImageExt = keyof typeof TYPES;

/** Detects the real image type from magic bytes (never trust the browser's MIME type or filename). */
export function sniffImage(buf: Uint8Array): ImageExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)) return "png";
  if (buf.length >= 12 && Buffer.from(buf.subarray(0, 4)).toString() === "RIFF" && Buffer.from(buf.subarray(8, 12)).toString() === "WEBP") return "webp";
  return null;
}

const NAME_RE = /^covers\/[a-z0-9]+-[a-f0-9]{16}\.(jpg|png|webp)$/;

export function uploadRoot() {
  return path.resolve(config().UPLOAD_DIR);
}

export async function saveCover(bookId: string, file: File): Promise<string> {
  if (file.size === 0) throw new DomainError("INVALID", "Choose an image");
  if (file.size > MAX_COVER_BYTES) throw new DomainError("INVALID", "Cover must be 2 MB or smaller");
  const buf = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) throw new DomainError("INVALID", "Cover must be a JPEG, PNG or WebP image");
  const safeId = bookId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const rel = `covers/${safeId}-${randomBytes(8).toString("hex")}.${ext}`;
  await mkdir(path.join(uploadRoot(), "covers"), { recursive: true });
  await writeFile(path.join(uploadRoot(), rel), buf);
  return `/api/files/${rel}`;
}

export async function deleteUpload(publicUrl: string | null) {
  if (!publicUrl?.startsWith("/api/files/")) return;
  const rel = publicUrl.slice("/api/files/".length);
  if (NAME_RE.test(rel)) await unlink(path.join(uploadRoot(), rel)).catch(() => undefined);
}

/** Reads an uploaded file by its public path. Only names we generated are accepted (no path traversal). */
export async function readUpload(rel: string): Promise<{ data: Buffer; type: string } | null> {
  if (!NAME_RE.test(rel)) return null;
  try {
    const data = await readFile(path.join(uploadRoot(), rel));
    return { data, type: TYPES[rel.split(".").pop() as ImageExt] };
  } catch {
    return null;
  }
}
