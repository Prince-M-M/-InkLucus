import { expect, test } from "@playwright/test";
import { login, register, toast, topUp, uniqueEmail } from "./helpers";

test("visitor can read free chapters but not locked ones", async ({ page }) => {
  await page.goto("/books/BKSEED0001/1");
  await expect(page.getByText("This is chapter 1 of The River Queen")).toBeVisible();
  await page.goto("/books/BKSEED0001/7");
  await expect(page.getByText("This chapter is for members.")).toBeVisible();
  await expect(page.getByText("This is chapter 7")).toHaveCount(0);
});

test("home, browse, search, genre, language and new pages list books", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Editor's Picks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Featured Shona Books" })).toBeVisible();
  await page.getByPlaceholder("Search titles or pen names…").fill("river");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: /The River Queen/ }).first()).toBeVisible();
  await page.goto("/browse?language=sn");
  await expect(page.getByText("Rudo Rwemoyo").first()).toBeVisible();
  await expect(page.getByText("The River Queen")).toHaveCount(0);
  await page.goto("/browse?genre=Thriller");
  await expect(page.getByText("Midnight in Harare").first()).toBeVisible();
  await page.goto("/new");
  await expect(page.getByText("The River Queen").first()).toBeVisible();
  await page.goto("/pen/rudo-moyo");
  await expect(page.getByRole("heading", { name: "Rudo Moyo" })).toBeVisible();
});

test("reader journey: sign up, top up, buy a section, read, comment, reply, review, like, wishlist", async ({ page }) => {
  await register(page);
  await topUp(page, "10.00");
  await expect(page.getByText("$10.00").first()).toBeVisible();

  await page.goto("/books/BKSEED0001");
  await page.getByRole("button", { name: /Ch\. 6–55/ }).click();
  await expect(page.getByText("✓ Owned: ch. 6–55")).toBeVisible();
  await page.goto("/books/BKSEED0001/7");
  await expect(page.getByText("This is chapter 7 of The River Queen")).toBeVisible();
  await page.goto("/books/BKSEED0001/60");
  await expect(page.getByText("This chapter is locked.")).toBeVisible();

  await page.goto("/books/BKSEED0001/7");
  await page.getByPlaceholder("Write a comment…").fill("What a chapter!");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("What a chapter!")).toBeVisible();
  await page.locator("summary", { hasText: "Reply" }).first().click();
  await page.locator("details[open] textarea").fill("Replying to myself");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByText("Replying to myself")).toBeVisible();

  await page.goto("/books/BKSEED0001");
  await page.getByLabel("4★").check();
  await page.getByLabel("Review (optional)").fill("Lovely writing.");
  await page.getByRole("button", { name: "Post review" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "Lovely writing." })).toBeVisible();
  await page.getByRole("button", { name: "☆ Like" }).click();
  await expect(page.getByRole("button", { name: "★ Liked" })).toBeVisible();
  await page.getByRole("button", { name: "♡ Wishlist" }).click();
  await expect(page.getByRole("button", { name: "♥ On wishlist" })).toBeVisible();

  await page.goto("/dashboard?tab=library");
  await expect(page.getByText("Ch. 6–55")).toBeVisible();
  await page.goto("/dashboard?tab=stats");
  await expect(page.getByText("Books started")).toBeVisible();
  await expect(page.getByRole("link", { name: "The River Queen" }).first()).toBeVisible();
});

test("whole-book price is reduced by sections already bought", async ({ page }) => {
  await register(page);
  await topUp(page, "20.00");
  await page.goto("/books/BKSEED0001");
  await page.getByRole("button", { name: /Ch\. 6–55/ }).click();
  await expect(page.getByText("✓ Owned: ch. 6–55")).toBeVisible();
  await expect(page.getByRole("button", { name: /Whole book: \$5\.50 \(after sections you own\)/ })).toBeVisible();
  await page.getByRole("button", { name: /Whole book/ }).click();
  await expect(page.getByText("You own this book, including future chapters.")).toBeVisible();
  await page.goto("/books/BKSEED0001/120");
  await expect(page.getByText("This is chapter 120")).toBeVisible();
});

test("gift card: buy, share link, friend redeems once", async ({ browser }) => {
  const a = await browser.newPage();
  await register(a, { name: "Gifter" });
  await topUp(a, "10.00");
  await a.goto("/dashboard?tab=wallet");
  await a.getByLabel("Amount").nth(2).fill("4.00");
  await a.getByRole("button", { name: "Buy gift card" }).click();
  const msg = await a.getByText(/Gift card created: /).textContent();
  const code = /([A-Z2-9]{4}(?:-[A-Z2-9]{4}){3})/.exec(msg!)![1];

  const b = await browser.newPage();
  await register(b, { name: "Friend" });
  await b.goto(`/gift/${code}`);
  await expect(b.getByText("$4.00")).toBeVisible();
  await b.getByRole("button", { name: "Add to my wallet" }).click();
  await toast(b, "Gift card added to your wallet.");
  await b.goto(`/gift/${code}`);
  await expect(b.getByText("already been used or has expired")).toBeVisible();
  await b.goto("/dashboard?tab=wallet");
  await expect(b.getByText("$4.00").first()).toBeVisible();
});

test("wallet transfer between friends", async ({ browser }) => {
  const friendEmail = uniqueEmail("friend");
  const f = await browser.newPage();
  await register(f, { email: friendEmail });
  const a = await browser.newPage();
  await register(a);
  await topUp(a, "5.00");
  await a.goto("/dashboard?tab=wallet");
  await a.getByLabel("Friend's email").fill(friendEmail);
  await a.getByLabel("Amount").nth(1).fill("2.50");
  await a.getByRole("button", { name: "Send" }).click();
  await toast(a, "Transfer sent.");
  await f.goto("/dashboard?tab=wallet");
  await expect(f.getByText("$2.50").first()).toBeVisible();
});

test("failed test payment adds nothing", async ({ page }) => {
  await register(page);
  await page.goto("/dashboard?tab=wallet");
  await page.getByLabel("Amount").first().fill("3.00");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: "Fail" }).click();
  await expect(page.getByText("The payment didn't go through")).toBeVisible();
});

test("18+ books: visitors must log in, teens are refused, adults can read", async ({ page }) => {
  await page.goto("/books/BKSEED0004/1");
  await expect(page.getByText("This book is for readers aged 18+.")).toBeVisible();
  await login(page, "teen@example.com");
  await page.goto("/books/BKSEED0004/1");
  await expect(page.getByText("This book is for readers aged 18+.")).toBeVisible();
  await expect(page.getByText("This is chapter 1 of Midnight in Harare")).toHaveCount(0);
  await page.goto("/books/BKSEED0004");
  await expect(page.getByRole("button", { name: /Whole book/ })).toHaveCount(0);

  const adult = await page.context().browser()!.newPage();
  await login(adult, "reader@example.com");
  await adult.goto("/books/BKSEED0004/1");
  await expect(adult.getByText("This is chapter 1 of Midnight in Harare")).toBeVisible();
});

test("language editions link to each other", async ({ page }) => {
  await page.goto("/books/BKSEED0001");
  await page.getByRole("link", { name: "Shona" }).click();
  await expect(page.getByRole("heading", { name: "Mambokadzi weRwizi" })).toBeVisible();
});

test("audiobook: buy and play, video has owner discount", async ({ page }) => {
  await register(page);
  await topUp(page, "50.00");
  await page.goto("/books/BKSEED0001/listen");
  await expect(page.getByText("🔒 Locked")).toBeVisible();
  await page.getByRole("button", { name: "Buy audiobook: $5.99" }).click();
  await expect(page.locator("audio")).toHaveCount(1);
  await page.goto("/books/BKSEED0001");
  await page.getByRole("button", { name: /Whole book/ }).click();
  await expect(page.getByText("You own this book")).toBeVisible();
  await page.goto("/books/BKSEED0001/watch");
  await expect(page.getByText("Your 30% book-owner discount is applied.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy video: $10.49" })).toBeVisible();
});

test("offline reading: saved chapters open without a connection", async ({ page, context }) => {
  await login(page, "reader@example.com");
  await page.goto("/books/BKSEED0002");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  // The seeded reader owns this book, so every chapter can be saved.
  await page.getByRole("button", { name: /Save 30 chapters for offline/ }).click();
  await expect(page.getByText("30 chapters saved on this device")).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await page.goto("/books/BKSEED0002/2");
  await expect(page.getByText("This is chapter 2 of Rudo Rwemoyo")).toBeVisible();
  await page.goto("/books/BKSEED0002/25");
  await expect(page.getByText("This is chapter 25 of Rudo Rwemoyo")).toBeVisible();
  await page.goto("/books/BKSEED0003/2");
  await expect(page.getByText("You're offline")).toBeVisible();
  await context.setOffline(false);
});
