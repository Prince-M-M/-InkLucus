import { randomInt } from "node:crypto";

// Avoids look-alike characters (0/O, 1/I/L) so codes are easy to read aloud or type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Referral codes: 2 letters + 4 digits, e.g. "AA1234". */
export const REFERRAL_CODE_RE = /^[A-Z]{2}\d{4}$/;

/** Author internal identity code: "<ref>-<6-digit author number>", e.g. "AA1234-006109". */
export function formatAuthorCode(referralCode: string, authorNumber: number): string {
  if (!REFERRAL_CODE_RE.test(referralCode)) {
    throw new Error(`Invalid referral code "${referralCode}" (expected e.g. AA1234)`);
  }
  if (!Number.isInteger(authorNumber) || authorNumber < 1 || authorNumber > 999_999) {
    throw new Error(`Author number out of range: ${authorNumber}`);
  }
  return `${referralCode}-${String(authorNumber).padStart(6, "0")}`;
}

export function parseAuthorCode(code: string): { referralCode: string; authorNumber: number } | null {
  const m = /^([A-Z]{2}\d{4})-(\d{6})$/.exec(code);
  return m ? { referralCode: m[1], authorNumber: Number(m[2]) } : null;
}

/** Book code used in URLs instead of titles (titles may collide). */
export function newBookCode(): string {
  return "BK" + randomCode(8);
}

/** Gift card code, grouped for readability: XXXX-XXXX-XXXX-XXXX. */
export function newGiftCardCode(): string {
  return Array.from({ length: 4 }, () => randomCode(4)).join("-");
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
