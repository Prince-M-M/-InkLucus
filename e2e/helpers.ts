import { expect, type Page } from "@playwright/test";

export const PASSWORD = "password123";
export const uniqueEmail = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/dashboard|\/books|\/gift/);
}

export async function register(page: Page, opts: { name?: string; email?: string; dob?: string } = {}) {
  const email = opts.email ?? uniqueEmail("reader");
  await page.goto("/register");
  await page.getByLabel("Display name").fill(opts.name ?? "New Reader");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a good passphrase");
  await page.getByLabel("Date of birth").fill(opts.dob ?? "1998-04-01");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL("**/dashboard");
  return email;
}

export async function topUp(page: Page, amount: string) {
  await page.goto("/dashboard?tab=wallet");
  await page.getByLabel("Amount").first().fill(amount);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.waitForURL("**/wallet/dev-pay**");
  await page.getByRole("button", { name: "Pay" }).click();
  await page.waitForURL("**/wallet/return**");
  await expect(page.getByText("has been added to your wallet")).toBeVisible();
}

/** Success messages appear as a toast. */
export const toast = (page: Page, text: string | RegExp) => expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();
