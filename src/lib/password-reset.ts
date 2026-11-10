import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { config } from "./config";
import { sendMail } from "./mail";
import { DomainError } from "./errors";
import { hashPassword, passwordProblem } from "./password";

const TTL_MS = 60 * 60 * 1000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Always behaves the same whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(email: string, now = new Date()) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.email.endsWith("@deleted.invalid")) return;
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    db.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + TTL_MS) } }),
  ]);
  const link = `${config().APP_URL}/reset-password?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Reset your InkLucus password",
    text: `Hi ${user.displayName},\n\nUse this link to choose a new password (valid for 1 hour):\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
  });
}

export async function resetPassword(token: string, newPassword: string, now = new Date()) {
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt <= now) throw new DomainError("INVALID", "This reset link is invalid or has expired. Request a new one.");
  const problem = passwordProblem(newPassword, row.user.email);
  if (problem) throw new DomainError("INVALID", problem);
  const passwordHash = await hashPassword(newPassword);
  // Marking used with a conditional update makes the link single-use even under concurrent submits.
  const used = await db.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (used.count !== 1) throw new DomainError("INVALID", "This reset link has already been used.");
  await db.user.update({ where: { id: row.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
}
