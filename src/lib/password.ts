import bcrypt from "bcryptjs";

export const MIN_PASSWORD = 8;
/** bcrypt only uses the first 72 bytes; longer passwords would be silently truncated. */
export const MAX_PASSWORD_BYTES = 72;

const COMMON = new Set(["password", "password1", "password123", "12345678", "123456789", "qwertyui", "11111111", "iloveyou", "abcdefgh"]);

export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (Buffer.byteLength(pw, "utf8") > MAX_PASSWORD_BYTES) return "Password is too long (max 72 bytes).";
  if (COMMON.has(pw.toLowerCase())) return "That password is too common. Choose another.";
  if (email && pw.toLowerCase() === email.toLowerCase()) return "Password can't be your email.";
  return null;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

/** A real bcrypt hash used to keep login timing the same when the email doesn't exist. */
export const DUMMY_HASH = "$2b$12$2L9ocmEnNuml/w1rTXTj8ua9KWC3FhXwDJ/RcibEY4m1FFOCFtKey";
