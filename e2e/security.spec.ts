import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { e2eDb } from "./db";
import { login, register, toast, uniqueEmail } from "./helpers";

test("security headers are set", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("role-protected pages redirect", async ({ page }) => {
  for (const path of ["/dashboard", "/admin", "/editor", "/author", "/accounting", "/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  await login(page, "reader@example.com");
  for (const path of ["/admin", "/editor", "/author", "/accounting"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard/);
  }
});

test("internal endpoints reject outsiders", async ({ request }) => {
  expect((await request.post("/api/cron")).status()).toBe(401);
  expect((await request.post("/api/cron", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
  expect((await request.get("/api/files/..%2F.env")).status()).toBe(404);
  expect((await request.get("/api/files/covers/../../package.json")).status()).toBe(404);
  expect((await request.post("/api/payments/stripe/webhook", { data: "{}" })).status()).toBe(400);
  expect((await request.post("/api/payments/paynow/result", { data: "reference=x&status=Paid" })).status()).toBe(400);
  const cron = await request.post("/api/cron", { headers: { Authorization: "Bearer e2e-cron-secret-1234567890" } });
  expect(cron.status()).toBe(200);
  expect(await cron.json()).toHaveProperty("expiredGiftCards");
});

test("paid media can't be fetched without buying", async ({ page, request }) => {
  const db = e2eDb();
  const media = await db.mediaItem.findFirstOrThrow({ where: { book: { code: "BKSEED0001" }, kind: "VIDEO" } });
  await db.$disconnect();
  expect((await request.get(`/api/media/${media.id}`, { maxRedirects: 0 })).status()).toBe(403);
  await login(page, "reader@example.com");
  expect((await page.request.get(`/api/media/${media.id}`, { maxRedirects: 0 })).status()).toBe(403);
});

test("login is rate limited and doesn't reveal which emails exist", async ({ page }) => {
  const email = uniqueEmail("ghost");
  await page.goto("/login");
  for (let i = 0; i < 10; i++) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("wrong-password");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.getByRole("button", { name: "Log in" }).click()]);
    await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
  }
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Too many attempts")).toBeVisible();
});

test("open redirects are blocked after login", async ({ page }) => {
  await page.goto("/login?next=//evil.example.com");
  await page.getByLabel("Email").fill("reader@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/localhost:3100\/dashboard/);
});

test("changing the password logs out other devices", async ({ browser }) => {
  const email = await register(await browser.newPage());
  const phone = await browser.newPage();
  await phone.goto("/login");
  await phone.getByLabel("Email").fill(email);
  await phone.getByLabel("Password").fill("a good passphrase");
  await phone.getByRole("button", { name: "Log in" }).click();
  await phone.waitForURL("**/dashboard");

  const laptop = await browser.newPage();
  await laptop.goto("/login");
  await laptop.getByLabel("Email").fill(email);
  await laptop.getByLabel("Password").fill("a good passphrase");
  await laptop.getByRole("button", { name: "Log in" }).click();
  await laptop.waitForURL("**/dashboard");
  await laptop.goto("/settings");
  await laptop.getByLabel("Current password").fill("a good passphrase");
  await laptop.getByLabel("New password", { exact: true }).fill("an even better passphrase");
  await laptop.getByLabel("Confirm new password").fill("an even better passphrase");
  await laptop.getByRole("button", { name: "Change password" }).click();
  await toast(laptop, "Password changed.");

  await phone.goto("/dashboard");
  await expect(phone).toHaveURL(/\/login/);
  await laptop.goto("/dashboard");
  await expect(laptop).toHaveURL(/\/dashboard/);
});

test("password reset with an emailed link", async ({ page }) => {
  const email = await register(page);
  await page.context().clearCookies();
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If an account exists for that email")).toBeVisible();

  // The email goes to the server log in development; create a known token the same way the app does.
  const token = randomBytes(32).toString("base64url");
  const db = e2eDb();
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } });
  await db.$disconnect();

  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel("New password").fill("my reset passphrase");
  await page.getByLabel("Confirm").fill("my reset passphrase");
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL("**/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("my reset passphrase");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel("New password").fill("another passphrase!");
  await page.getByLabel("Confirm").fill("another passphrase!");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText(/invalid|already been used/)).toBeVisible();
});

test("sign-up refuses under-13s and weak passwords", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Display name").fill("Kid");
  await page.getByLabel("Email").fill(uniqueEmail("kid"));
  await page.getByLabel("Password").fill("password123");
  await page.getByLabel("Date of birth").fill("1999-01-01");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("That password is too common")).toBeVisible();
  await page.getByLabel("Password").fill("a good passphrase");
  await page.getByLabel("Date of birth").fill(`${new Date().getFullYear() - 10}-01-01`);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("You must be at least 13")).toBeVisible();
});
