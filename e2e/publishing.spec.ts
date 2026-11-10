import path from "node:path";
import { expect, test } from "@playwright/test";
import { login, register, toast, uniqueEmail } from "./helpers";

test("submission → editor review → accept → pen name → publish → author posts a chapter", async ({ browser }) => {
  const title = `Mvura ${Date.now()}`;
  const writerEmail = uniqueEmail("writer");
  const w = await browser.newPage();
  await register(w, { email: writerEmail, name: "Chipo Writer" });
  await w.goto("/become-an-author");
  await w.getByLabel("Book title").fill(title);
  await w.getByLabel("Synopsis").fill("A story about a village waiting for rain and a girl who finds it.");
  await w.getByLabel("Language").selectOption("sn");
  await w.getByLabel("Drama").check();
  await w.getByLabel("Manuscript").fill("# Chapter 1: Kuoma\nThe fields were dry.\n\n# Chapter 2: Makore\nClouds gathered.\n\n# Chapter 3: Mvura\nIt rained.");
  await w.getByLabel("Referral code (optional)").fill("aa1234");
  await w.getByLabel(/This is my original work/).check();
  await w.getByRole("button", { name: "Submit book" }).click();
  await w.waitForURL("**/dashboard?submitted=1");
  await expect(w.getByText("Waiting for an editor")).toBeVisible();

  const e = await browser.newPage();
  await login(e, "editor@example.com");
  await e.goto("/editor");
  await e.locator("li", { hasText: title }).getByRole("button", { name: "Start reviewing" }).click();
  await e.waitForURL("**/editor/books/**");
  const bookUrl = e.url();
  await e.locator("summary", { hasText: "Chapter 2: Makore" }).click();
  await expect(e.getByText("Clouds gathered.")).toBeVisible();
  await e.getByRole("radio", { name: "Accept" }).check();
  await e.getByLabel(/Message to the submitter/).fill("Welcome! Let's talk contracts.");
  await e.getByRole("button", { name: "Send decision" }).click();
  await expect(e.getByText("Accepted. Next:")).toBeVisible();

  const pen = `Chipo M ${Date.now()}`;
  await e.getByLabel("New pen name").fill(pen);
  await e.getByRole("button", { name: "Add pen name" }).click();
  await toast(e, "Pen name added.");
  await e.goto(bookUrl);
  await e.locator('select[name="penNameId"]').selectOption({ label: pen });
  await e.getByLabel("Lock chapter").fill("3");
  await e.getByLabel("Whole book ($)").fill("2.99");
  await e.getByLabel("Author royalty (%)").fill("45");
  await e.getByLabel("ISBN (internal, optional)").fill(`978-0-${Date.now() % 1000000}`);
  await e.getByLabel(/Editor's review/).fill("A quiet, beautiful debut.");
  await e.getByRole("button", { name: "Publish" }).click();
  await expect(e.getByText("Published and on sale.")).toBeVisible();

  await e.locator('input[name="cover"]').setInputFiles(path.join(__dirname, "cover.jpg"));
  await e.getByRole("button", { name: "Upload cover" }).click();
  await toast(e, "Cover updated.");
  const coverSrc = await e.locator('img[alt^="Cover of"]').getAttribute("src");
  expect(coverSrc).toMatch(/^\/api\/files\/covers\//);
  const res = await e.request.get(coverSrc!);
  expect(res.headers()["content-type"]).toBe("image/jpeg");

  // Public page: new book listed, editor review shown, ISBN never exposed
  const v = await browser.newPage();
  await v.goto("/new");
  await v.getByRole("link", { name: title }).first().click();
  await expect(v.getByText("A quiet, beautiful debut.")).toBeVisible();
  expect(await v.content()).not.toContain("978-0-");

  // The writer is now an author with an ID from the referral code
  await w.goto("/author");
  await expect(w.getByText(/Author ID AA1234-\d{6}/)).toBeVisible();
  await w.getByRole("link", { name: title }).click();
  await expect(w.getByText("Welcome! Let's talk contracts.")).toBeVisible();
  await w.getByLabel("Chapter title").fill("Chapter 4: Kukohwa");
  await w.getByLabel("Text").fill("The harvest came.");
  await w.getByRole("button", { name: "Post chapter" }).click();
  await expect(w.getByText("4. Chapter 4: Kukohwa")).toBeVisible();
  await w.goto("/author?tab=stats");
  await expect(w.getByText("Copies sold per month")).toBeVisible();
  await w.goto("/author?tab=income");
  await expect(w.getByText("Total income")).toBeVisible();
});

test("editor can pass a submission back to the pool with new genres", async ({ browser }) => {
  const title = `Thriller ${Date.now()}`;
  const w = await browser.newPage();
  await register(w);
  await w.goto("/become-an-author");
  await w.getByLabel("Book title").fill(title);
  await w.getByLabel("Synopsis").fill("A detective story set in Bulawayo with plenty of twists.");
  await w.getByLabel("Romance").check();
  await w.getByLabel("Manuscript").fill("# One\nA body by the river.");
  await w.getByLabel(/This is my original work/).check();
  await w.getByRole("button", { name: "Submit book" }).click();
  await w.waitForURL("**/dashboard?submitted=1");

  const e = await browser.newPage();
  await login(e, "editor@example.com");
  await e.goto("/editor");
  await e.locator("li", { hasText: title }).getByRole("button", { name: "Start reviewing" }).click();
  await e.waitForURL("**/editor/books/**");
  await e.getByLabel("Romance").uncheck();
  await e.getByLabel("Thriller").check();
  await e.getByRole("button", { name: "Return to pool" }).click();
  await e.waitForURL(/\/editor$/);
  await e.goto("/editor?tab=pool&genre=Thriller");
  await expect(e.locator("li", { hasText: title })).toBeVisible();
});

test("editor statistics and homepage proposals", async ({ page }) => {
  await login(page, "editor@example.com");
  await page.goto("/editor?tab=stats&period=all");
  await expect(page.getByText("New vs older books")).toBeVisible();
  await expect(page.getByText("Best-selling authors")).toBeVisible();
  await page.goto("/editor?tab=homepage");
  await page.getByLabel("Book").selectOption({ label: "Rudo Rwemoyo" });
  await page.getByLabel("List").selectOption("POPULAR");
  await page.getByRole("button", { name: "Propose" }).click();
  await toast(page, "Proposed.");
  await expect(page.locator("li", { hasText: "Rudo Rwemoyo" }).getByText("proposed")).toBeVisible();
});
