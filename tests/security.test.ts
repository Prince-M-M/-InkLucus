import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { passwordProblem } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { ageOn, checkAge } from "@/lib/age";
import { config, resetConfigCache } from "@/lib/config";
import { readUpload, sniffImage } from "@/lib/uploads";
import { toCsv } from "@/lib/reports";
import { validMediaUrl } from "@/lib/media";
import { signStripePayload, verifyStripeSignature } from "@/lib/payments/stripe";
import { paynowHash, parsePaynowMessage, verifyPaynowMessage } from "@/lib/payments/paynow";
import { resetDb, setEnv } from "./helpers";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("passwords", () => {
  it("enforces length, byte limit, common passwords and not-the-email", () => {
    expect(passwordProblem("short")).toMatch(/at least 8/);
    expect(passwordProblem("😀".repeat(19))).toMatch(/too long/); // 76 bytes
    expect(passwordProblem("Password123")).toMatch(/too common/);
    expect(passwordProblem("me@x.com", "ME@x.com")).toMatch(/email/);
    expect(passwordProblem("a perfectly fine passphrase")).toBeNull();
  });
});

describe("rate limiting", () => {
  it("allows up to the limit per window, then resets", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit("k", 3, 60, t0));
    expect(results).toEqual([true, true, true, false]);
    expect(await rateLimit("k", 3, 60, new Date(t0.getTime() + 61_000))).toBe(true);
    expect(await rateLimit("other", 3, 60, t0)).toBe(true);
  });

  it("is correct under concurrency", async () => {
    const t0 = new Date();
    const r = await Promise.all(Array.from({ length: 10 }, () => rateLimit("c", 5, 60, t0)));
    expect(r.filter(Boolean)).toHaveLength(5);
  });
});

describe("age rating", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  it("computes age with birthdays", () => {
    expect(ageOn(new Date("2010-06-15"), now)).toBe(16);
    expect(ageOn(new Date("2010-06-16"), now)).toBe(15);
  });
  it("gates 16+ and 18+ only", () => {
    expect(checkAge("TEEN_13", null, now).ok).toBe(true);
    expect(checkAge("MATURE_16", null, now)).toMatchObject({ ok: false, reason: "LOGIN_REQUIRED" });
    expect(checkAge("ADULT_18", { dateOfBirth: null }, now)).toMatchObject({ ok: false, reason: "DOB_REQUIRED" });
    expect(checkAge("ADULT_18", { dateOfBirth: new Date("2010-01-01") }, now)).toMatchObject({ ok: false, reason: "TOO_YOUNG", minAge: 18 });
    expect(checkAge("MATURE_16", { dateOfBirth: new Date("2010-01-01") }, now).ok).toBe(true);
  });
});

describe("production configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    resetConfigCache();
  });
  it("refuses unsafe production settings", () => {
    setEnv({ NODE_ENV: "production", SESSION_SECRET: "dev-only-change-me-0123456789abcdef0123456789", APP_URL: "http://x.com", PAYMENTS_DEV_MODE: "true", CRON_SECRET: undefined });
    resetConfigCache();
    expect(() => config()).toThrow(/SESSION_SECRET is still the development value[\s\S]*PAYMENTS_DEV_MODE[\s\S]*https[\s\S]*CRON_SECRET/);
  });
  it("accepts a proper production config", () => {
    setEnv({ NODE_ENV: "production", SESSION_SECRET: "a".repeat(48), APP_URL: "https://inklucus.com", PAYMENTS_DEV_MODE: "false", CRON_SECRET: "c".repeat(32) });
    resetConfigCache();
    expect(config().APP_URL).toBe("https://inklucus.com");
  });
  it("rejects a short session secret", () => {
    setEnv({ SESSION_SECRET: "short" });
    resetConfigCache();
    expect(() => config()).toThrow(/SESSION_SECRET/);
  });
});

describe("uploads", () => {
  it("identifies images by content, not name", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<?php echo 1; ?>"))).toBeNull();
  });
  it("only serves generated file names (no path traversal)", async () => {
    for (const bad of ["../.env", "covers/../../.env", "covers/x.svg", "/etc/passwd", "covers/abc-zz.jpg"]) expect(await readUpload(bad)).toBeNull();
  });
});

describe("misc hardening", () => {
  it("CSV export neutralises spreadsheet formulas", () => {
    const csv = toCsv([{ title: '=HYPERLINK("http://evil")', n: 1 }, { title: 'He said "hi"', n: -2 }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"He said ""hi"""`);
    expect(csv).toContain(`"'-2"`);
  });
  it("media links must be plain https", () => {
    expect(validMediaUrl("https://cdn.example.com/a.mp3")).toBe(true);
    expect(validMediaUrl("http://cdn.example.com/a.mp3")).toBe(false);
    expect(validMediaUrl("javascript:alert(1)")).toBe(false);
    expect(validMediaUrl("https://user:pw@cdn.example.com/a.mp3")).toBe(false);
  });
});

describe("payment signatures", () => {
  it("Stripe: accepts valid, rejects tampered, stale or wrongly signed payloads", () => {
    const body = '{"id":"evt_1"}';
    const now = Date.now();
    const header = signStripePayload(body, "whsec_test", Math.floor(now / 1000));
    expect(verifyStripeSignature(body, header, "whsec_test", 300, now)).toBe(true);
    expect(verifyStripeSignature(body + " ", header, "whsec_test", 300, now)).toBe(false);
    expect(verifyStripeSignature(body, header, "whsec_other", 300, now)).toBe(false);
    expect(verifyStripeSignature(body, header, "whsec_test", 300, now + 10 * 60_000)).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec_test")).toBe(false);
    expect(verifyStripeSignature(body, "garbage", "whsec_test")).toBe(false);
  });
  it("Paynow: hash covers all fields in order", () => {
    const fields: [string, string][] = [["reference", "p1"], ["amount", "10.00"], ["status", "Paid"]];
    const hash = paynowHash(fields, "key");
    const msg = new URLSearchParams([...fields, ["hash", hash]]).toString();
    expect(verifyPaynowMessage(parsePaynowMessage(msg), "key")).toBe(true);
    expect(verifyPaynowMessage(parsePaynowMessage(msg.replace("10.00", "99.00")), "key")).toBe(false);
    expect(verifyPaynowMessage(parsePaynowMessage(msg), "other")).toBe(false);
    expect(verifyPaynowMessage(parsePaynowMessage("reference=p1&status=Paid"), "key")).toBe(false);
  });
});
