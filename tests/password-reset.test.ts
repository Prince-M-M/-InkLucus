import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { devOutbox } from "@/lib/mail";
import { requestPasswordReset, resetPassword } from "@/lib/password-reset";
import { verifyPassword } from "@/lib/password";
import { makeUser, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  devOutbox.length = 0;
});
afterAll(() => db.$disconnect());

const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)![1];

describe("password reset", () => {
  it("emails a single-use link that changes the password and logs out other sessions", async () => {
    const u = await makeUser("READER", { email: "r@x.com" });
    await requestPasswordReset("R@X.com");
    expect(devOutbox).toHaveLength(1);
    expect(devOutbox[0].to).toBe("r@x.com");
    const token = tokenFrom(devOutbox[0].text);
    await expect(resetPassword(token, "short")).rejects.toThrow(/at least 8/);
    await resetPassword(token, "a brand new passphrase");
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await verifyPassword("a brand new passphrase", after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(u.sessionVersion + 1);
    await expect(resetPassword(token, "another passphrase")).rejects.toThrow(/invalid|used/);
  });

  it("reveals nothing for unknown emails and stores only a hash of the token", async () => {
    await requestPasswordReset("nobody@x.com");
    expect(devOutbox).toHaveLength(0);
    await makeUser("READER", { email: "r@x.com" });
    await requestPasswordReset("r@x.com");
    const token = tokenFrom(devOutbox[0].text);
    const row = await db.passwordResetToken.findFirstOrThrow();
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toHaveLength(64);
  });

  it("expires after an hour and only the newest link works", async () => {
    await makeUser("READER", { email: "r@x.com" });
    const t0 = new Date();
    await requestPasswordReset("r@x.com", t0);
    const first = tokenFrom(devOutbox[0].text);
    await requestPasswordReset("r@x.com", t0);
    const second = tokenFrom(devOutbox[1].text);
    await expect(resetPassword(first, "a brand new passphrase")).rejects.toThrow(/invalid/);
    await expect(resetPassword(second, "a brand new passphrase", new Date(t0.getTime() + 61 * 60_000))).rejects.toThrow(/expired/);
  });
});
