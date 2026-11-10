import { expect, test } from "@playwright/test";
import { login } from "./helpers";

for (const path of ["/", "/browse", "/books/BKSEED0001", "/books/BKSEED0001/1", "/register"]) {
  test(`no horizontal scroll on phones: ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("dashboard works on a phone", async ({ page }) => {
  await login(page, "reader@example.com");
  await page.goto("/dashboard?tab=wallet");
  await expect(page.getByRole("heading", { name: "Top up" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
