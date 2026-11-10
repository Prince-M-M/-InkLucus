import type { LedgerType } from "@prisma/client";
import { db, type Tx } from "./db";
import { DomainError } from "./errors";
import { newGiftCardCode } from "./codes";
import { checkAge } from "./age";
import { config } from "./config";

export const MIN_TOP_UP_CENTS = 100;
export const MAX_TOP_UP_CENTS = 50_000;
export const MAX_TRANSFER_CENTS = 50_000;

function assertPositiveCents(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new DomainError("INVALID_AMOUNT", "Amount must be a positive whole number of cents");
}

async function walletFor(tx: Tx, userId: string) {
  return tx.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
}

async function credit(tx: Tx, userId: string, amount: number, type: LedgerType, reference?: string) {
  const w = await walletFor(tx, userId);
  await tx.wallet.update({ where: { id: w.id }, data: { balanceCents: { increment: amount } } });
  await tx.ledgerEntry.create({ data: { walletId: w.id, type, amountCents: amount, reference } });
}

/** Debits atomically; the conditional update prevents overdraft under concurrency. */
async function debit(tx: Tx, userId: string, amount: number, type: LedgerType, reference?: string) {
  const w = await walletFor(tx, userId);
  const res = await tx.wallet.updateMany({
    where: { id: w.id, balanceCents: { gte: amount } },
    data: { balanceCents: { decrement: amount } },
  });
  if (res.count !== 1) throw new DomainError("INSUFFICIENT_FUNDS", "Not enough funds in wallet");
  await tx.ledgerEntry.create({ data: { walletId: w.id, type, amountCents: -amount, reference } });
}

async function requireWalletUser(tx: Tx, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId } });
  if (!u) throw new DomainError("NOT_FOUND", "User not found");
  if (u.status === "BLOCKED") throw new DomainError("BLOCKED", "Account is blocked");
  if (u.role !== "READER" && u.role !== "AUTHOR") throw new DomainError("FORBIDDEN", "Only reader and author accounts have wallets");
  return u;
}

/** Called after a payment provider (Paynow/EcoCash, Stripe…) confirms a payment. */
export async function topUp(userId: string, amount: number, paymentReference: string, txArg?: Tx) {
  assertPositiveCents(amount);
  const work = async (tx: Tx) => {
    await requireWalletUser(tx, userId);
    const dup = await tx.ledgerEntry.findFirst({ where: { type: "TOP_UP", reference: paymentReference } });
    if (dup) return false; // idempotent: payment webhooks can be delivered more than once
    await credit(tx, userId, amount, "TOP_UP", paymentReference);
    return true;
  };
  return txArg ? work(txArg) : db.$transaction(work);
}

/** Wallet-to-wallet transfer. Funds stay in the system (only usable for books). */
export async function transfer(fromUserId: string, toEmail: string, amount: number) {
  assertPositiveCents(amount);
  if (amount > MAX_TRANSFER_CENTS) throw new DomainError("INVALID_AMOUNT", "That transfer is above the limit");
  return db.$transaction(async (tx) => {
    await requireWalletUser(tx, fromUserId);
    const to = await tx.user.findUnique({ where: { email: toEmail.toLowerCase() } });
    if (!to) throw new DomainError("NOT_FOUND", "Recipient not found");
    if (to.id === fromUserId) throw new DomainError("INVALID", "Cannot transfer to yourself");
    await requireWalletUser(tx, to.id);
    await debit(tx, fromUserId, amount, "TRANSFER_OUT", to.id);
    await credit(tx, to.id, amount, "TRANSFER_IN", fromUserId);
  });
}

export async function buyGiftCard(buyerId: string, amount: number, now = new Date()) {
  assertPositiveCents(amount);
  return db.$transaction(async (tx) => {
    await requireWalletUser(tx, buyerId);
    const expiresAt = new Date(now.getTime() + config().GIFT_CARD_VALIDITY_DAYS * 86_400_000);
    const card = await tx.giftCard.create({ data: { code: newGiftCardCode(), amountCents: amount, buyerId, expiresAt } });
    await debit(tx, buyerId, amount, "GIFT_CARD_BUY", card.id);
    return card;
  });
}

export async function redeemGiftCard(userId: string, code: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    await requireWalletUser(tx, userId);
    const card = await tx.giftCard.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!card) throw new DomainError("NOT_FOUND", "Gift card not found");
    if (card.expiresAt <= now) throw new DomainError("EXPIRED", "Gift card has expired");
    // Conditional update so a card can only ever be redeemed once.
    const res = await tx.giftCard.updateMany({
      where: { id: card.id, status: "ACTIVE" },
      data: { status: "REDEEMED", redeemedById: userId, redeemedAt: now },
    });
    if (res.count !== 1) throw new DomainError("ALREADY_REDEEMED", "Gift card already used");
    await credit(tx, userId, card.amountCents, "GIFT_CARD_REDEEM", card.id);
    return card.amountCents;
  });
}

/** Buy a whole book (sectionId omitted) or one section of it, paying from the wallet. */
function assertAge(rating: Parameters<typeof checkAge>[0], buyer: { dateOfBirth: Date | null }) {
  const age = checkAge(rating, buyer);
  if (!age.ok) {
    throw new DomainError("AGE", age.reason === "DOB_REQUIRED" ? "Add your date of birth in Settings to buy age-rated books" : `This book is for readers aged ${age.minAge}+`);
  }
}

export async function purchaseBook(userId: string, bookId: string, sectionId?: string) {
  return db.$transaction(async (tx) => {
    const buyer = await requireWalletUser(tx, userId);
    const book = await tx.book.findUnique({ where: { id: bookId }, include: { sections: true } });
    if (!book || book.status !== "ON_SALE") throw new DomainError("NOT_FOUND", "Book not available");
    assertAge(book.ageRating, buyer);

    const existing = await tx.purchase.findMany({ where: { userId, bookId, format: "TEXT" } });
    if (existing.some((p) => p.sectionId === null)) throw new DomainError("ALREADY_OWNED", "You already own this book");

    let price: number;
    if (sectionId) {
      const section = book.sections.find((s) => s.id === sectionId);
      if (!section) throw new DomainError("NOT_FOUND", "Section not found");
      if (existing.some((p) => p.sectionId === sectionId)) throw new DomainError("ALREADY_OWNED", "You already own this section");
      price = section.priceCents;
    } else {
      if (book.wholeBookPriceCents == null) throw new DomainError("NOT_FOR_SALE", "Whole-book purchase not offered");
      // Credit sections already bought so readers never pay twice for the same chapters.
      const paid = existing.reduce((sum, p) => sum + p.amountCents, 0);
      price = Math.max(0, book.wholeBookPriceCents - paid);
    }

    const purchase = await tx.purchase.create({ data: { userId, bookId, sectionId: sectionId ?? null, amountCents: price } });
    if (price > 0) await debit(tx, userId, price, "PURCHASE", purchase.id);
    return purchase;
  });
}

/** Scheduled job: mark unredeemed cards past expiry. Their value stays in "gift card reserves" reporting. */
export async function expireGiftCards(now = new Date()) {
  const res = await db.giftCard.updateMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  return res.count;
}

/**
 * Audiobook / video access, bought as a whole. Readers who own the whole text book get the
 * book's owner discount on video.
 */
export async function purchaseMedia(userId: string, bookId: string, kind: "AUDIO" | "VIDEO") {
  return db.$transaction(async (tx) => {
    const buyer = await requireWalletUser(tx, userId);
    const book = await tx.book.findUnique({ where: { id: bookId }, include: { _count: { select: { media: { where: { kind } } } } } });
    if (!book || book.status !== "ON_SALE") throw new DomainError("NOT_FOUND", "Book not available");
    assertAge(book.ageRating, buyer);
    const base = kind === "AUDIO" ? book.audioPriceCents : book.videoPriceCents;
    if (base == null || book._count.media === 0) throw new DomainError("NOT_FOR_SALE", `No ${kind === "AUDIO" ? "audiobook" : "video"} for this book yet`);
    if (await tx.purchase.findFirst({ where: { userId, bookId, format: kind } })) throw new DomainError("ALREADY_OWNED", "You already own this");
    let price = base;
    if (kind === "VIDEO" && book.videoDiscountPercentForOwners > 0) {
      const ownsBook = await tx.purchase.findFirst({ where: { userId, bookId, format: "TEXT", sectionId: null } });
      if (ownsBook) price = Math.round((base * (100 - book.videoDiscountPercentForOwners)) / 100);
    }
    const purchase = await tx.purchase.create({ data: { userId, bookId, format: kind, amountCents: price } });
    if (price > 0) await debit(tx, userId, price, "PURCHASE", purchase.id);
    return purchase;
  });
}

/** Accounting correction (e.g. a refunded payment). Positive credits, negative debits. Always noted. */
export async function adjustWallet(actorId: string, userId: string, amount: number, note: string) {
  if (!Number.isInteger(amount) || amount === 0) throw new DomainError("INVALID_AMOUNT", "Enter a non-zero amount");
  if (!note.trim()) throw new DomainError("INVALID", "A note is required for adjustments");
  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (!actor || actor.role !== "ACCOUNTING" || actor.status !== "ACTIVE") throw new DomainError("FORBIDDEN", "Accounting only");
    await requireWalletUser(tx, userId);
    const w = await walletFor(tx, userId);
    if (amount < 0) {
      const res = await tx.wallet.updateMany({ where: { id: w.id, balanceCents: { gte: -amount } }, data: { balanceCents: { increment: amount } } });
      if (res.count !== 1) throw new DomainError("INSUFFICIENT_FUNDS", "Wallet balance is lower than the adjustment");
    } else {
      await tx.wallet.update({ where: { id: w.id }, data: { balanceCents: { increment: amount } } });
    }
    await tx.ledgerEntry.create({ data: { walletId: w.id, type: "ADJUSTMENT", amountCents: amount, note: note.trim(), createdById: actorId } });
  });
}
