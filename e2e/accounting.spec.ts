import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("accounting sees reserves, recalculates royalties, exports purchases", async ({ page }) => {
  await login(page, "accounts@example.com");
  await page.goto("/accounting?tab=overview&period=all");
  await expect(page.getByText("Wallet reserves")).toBeVisible();
  await expect(page.getByText("Gift card reserves")).toBeVisible();

  await page.goto("/accounting?tab=royalties");
  await page.getByRole("link", { name: /^Current:/ }).click();
  await page.getByRole("button", { name: "Recalculate this period" }).click();
  await expect(page.getByRole("status")).toContainText("calculated");
  if (await page.getByRole("link", { name: "Open" }).count()) {
    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page.getByText(/Income: \$/)).toBeVisible();
    await page.getByRole("button", { name: "Finalise statement" }).click();
    await expect(page.getByText("The period hasn't ended yet")).toBeVisible();
  }

  await page.goto("/accounting?tab=purchases&period=all");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV" }).click()]);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  expect(csv.split("\r\n")[0]).toContain('"code","title","pen_name","isbn","copies"');

  await page.goto("/accounting?tab=editors&period=all");
  await expect(page.getByRole("cell", { name: "Tariro (Editor)" })).toBeVisible();
});

test("readers can't reach accounting or its export", async ({ page }) => {
  await login(page, "reader@example.com");
  await page.goto("/accounting");
  await expect(page).toHaveURL(/\/dashboard/);
  const res = await page.request.get("/accounting/export?period=all");
  expect(res.status()).toBe(403);
});
