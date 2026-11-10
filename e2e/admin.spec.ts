import { expect, test } from "@playwright/test";
import { login, register, toast, uniqueEmail } from "./helpers";

test("report → block → appeal → reinstate", async ({ browser }) => {
  const name = `Troll ${Date.now()}`;
  const troll = await browser.newPage();
  await register(troll, { name });
  await troll.goto("/books/BKSEED0001/2");
  await troll.getByPlaceholder("Write a comment…").fill("Spam spam buy followers");
  await troll.getByRole("button", { name: "Post", exact: true }).click();
  await expect(troll.getByText("Spam spam buy followers")).toBeVisible();

  const reader = await browser.newPage();
  await login(reader, "reader@example.com");
  await reader.goto("/books/BKSEED0001/2");
  const li = reader.locator("li", { hasText: "Spam spam buy followers" }).first();
  await li.locator("summary", { hasText: "Report" }).click();
  await li.getByPlaceholder("What's wrong?").fill("Spam advertising");
  await li.getByRole("button", { name: "Send report" }).click();
  await toast(reader, "Thanks, our team will look into it.");

  const admin = await browser.newPage();
  await login(admin, "admin@example.com");
  await admin.goto("/admin?tab=moderation");
  await admin.getByRole("link", { name }).click();
  await admin.getByLabel("Status").selectOption("BLOCKED");
  await admin.getByLabel(/Reason/).fill("Posting spam in comments");
  await admin.getByLabel(/Delete after/).fill("14");
  await admin.getByRole("button", { name: "Update status" }).click();
  await toast(admin, "Status updated.");

  await troll.goto("/dashboard");
  await expect(troll.getByText("Your account is blocked")).toBeVisible();
  await troll.getByPlaceholder("Explain why this should be reviewed").fill("Sorry, it won't happen again. Please restore my account.");
  await troll.getByRole("button", { name: "Send appeal" }).click();
  await expect(troll.getByText("is waiting for review")).toBeVisible();
  await troll.goto("/books/BKSEED0001/2");
  await expect(troll.getByPlaceholder("Write a comment…")).toHaveCount(0);

  await admin.goto("/admin?tab=moderation");
  const ap = admin.locator("li", { hasText: "Sorry, it won't happen again" });
  await ap.getByLabel("Reinstate account").check();
  await ap.getByPlaceholder("Reply to the user").fill("Last warning.");
  await ap.getByRole("button", { name: "Send decision" }).click();
  await toast(admin, "Account reinstated.");
  await troll.goto("/dashboard");
  await expect(troll.getByText("Your account is blocked")).toHaveCount(0);
});

test("admin creates staff, approves homepage books, manages community links, sees statistics", async ({ browser }) => {
  const admin = await browser.newPage();
  await login(admin, "admin@example.com");
  const staffEmail = uniqueEmail("acct");
  await admin.goto("/admin?tab=users");
  await admin.getByLabel("Name").fill("Nyasha Accounts");
  await admin.locator('form:has(button:has-text("Create account")) input[name="email"]').fill(staffEmail);
  await admin.getByLabel("Account type").selectOption("ACCOUNTING");
  await admin.getByLabel("Temporary password").fill("temporary-pass-1");
  await admin.getByRole("button", { name: "Create account" }).click();
  await toast(admin, "Staff account created.");
  const staff = await browser.newPage();
  await login(staff, staffEmail, "temporary-pass-1");
  await expect(staff.getByRole("link", { name: "Accounting", exact: true })).toBeVisible();

  await admin.goto("/admin?tab=homepage");
  await admin.getByLabel("Book code").fill("BKSEED0002");
  await admin.getByLabel("List").selectOption("BEST_SELLING");
  await admin.getByRole("button", { name: "Add proposal" }).click();
  await toast(admin, "Added as a proposal.");
  await admin.locator("section", { hasText: "Best Selling (" }).getByRole("button", { name: "Approve" }).click();
  await expect(admin.locator("section", { hasText: "Best Selling (1/12" })).toBeVisible();
  const home = await browser.newPage();
  await home.goto("/");
  await expect(home.locator("section", { hasText: "Best Selling" }).getByText("Rudo Rwemoyo").first()).toBeVisible();

  await admin.goto("/admin?tab=community");
  await admin.getByLabel("Label").fill("Shona readers WhatsApp");
  await admin.getByLabel("Platform").selectOption("whatsapp");
  await admin.getByLabel("Link").fill("https://chat.whatsapp.com/example");
  await admin.getByRole("button", { name: "Add link" }).click();
  await toast(admin, "Link added.");
  const r = await browser.newPage();
  await login(r, "reader@example.com");
  await expect(r.getByRole("link", { name: "Shona readers WhatsApp" })).toBeVisible();

  await admin.goto("/admin?tab=stats&range=all");
  await expect(admin.getByText(/Editor performance/)).toBeVisible();
  await expect(admin.getByRole("cell", { name: "Tariro (Editor)" })).toBeVisible();
});

test("admins can't demote a reader who holds wallet money", async ({ page }) => {
  await login(page, "admin@example.com");
  await page.goto("/admin?tab=users&q=reader@example.com");
  await page.getByRole("link", { name: "Reader", exact: true }).click();
  await page.getByLabel("New type").selectOption("EDITOR");
  await page.getByRole("button", { name: "Change type" }).click();
  await expect(page.getByText(/still has wallet funds/)).toBeVisible();
});
