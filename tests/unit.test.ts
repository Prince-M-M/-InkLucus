import { describe, expect, it } from "vitest";
import { formatAuthorCode, parseAuthorCode, newGiftCardCode } from "@/lib/codes";
import { planSections } from "@/lib/sections";
import { canReadChapter } from "@/lib/access";
import { can } from "@/lib/rbac";

describe("author identity code", () => {
  it("formats ref + zero-padded author number", () => {
    expect(formatAuthorCode("AA1234", 6109)).toBe("AA1234-006109");
    expect(parseAuthorCode("AA1234-006109")).toEqual({ referralCode: "AA1234", authorNumber: 6109 });
  });
  it("rejects bad input", () => {
    expect(() => formatAuthorCode("A1234", 1)).toThrow();
    expect(() => formatAuthorCode("AA1234", 1_000_000)).toThrow();
  });
  it("gift card codes look like XXXX-XXXX-XXXX-XXXX", () => {
    expect(newGiftCardCode()).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  });
});

describe("sections", () => {
  it("splits a 300 chapter book (lock at 6) into 50-chapter sections", () => {
    const s = planSections(300, 6, 50);
    expect(s[0]).toEqual({ index: 1, firstChapter: 6, lastChapter: 55 });
    expect(s.at(-1)!.lastChapter).toBe(300);
    expect(s).toHaveLength(6);
  });
});

describe("chapter access", () => {
  const base = { lockChapter: 6, authorUserId: "author", editorUserId: "ed", ownsWholeBook: false, ownedSections: [] };
  const reader = { id: "r", role: "READER" as const };
  it("free chapters are open to visitors", () => expect(canReadChapter({ ...base, chapterNumber: 5, viewer: null }).allowed).toBe(true));
  it("locked chapters need login, then purchase", () => {
    expect(canReadChapter({ ...base, chapterNumber: 6, viewer: null })).toEqual({ allowed: false, reason: "LOGIN_REQUIRED" });
    expect(canReadChapter({ ...base, chapterNumber: 6, viewer: reader })).toEqual({ allowed: false, reason: "PURCHASE_REQUIRED" });
  });
  it("section ownership unlocks only that range", () => {
    const i = { ...base, viewer: reader, ownedSections: [{ firstChapter: 6, lastChapter: 55 }] };
    expect(canReadChapter({ ...i, chapterNumber: 55 }).allowed).toBe(true);
    expect(canReadChapter({ ...i, chapterNumber: 56 }).allowed).toBe(false);
  });
  it("authors read their own book in full; other authors must pay", () => {
    expect(canReadChapter({ ...base, chapterNumber: 99, viewer: { id: "author", role: "AUTHOR" } }).allowed).toBe(true);
    expect(canReadChapter({ ...base, chapterNumber: 99, viewer: { id: "other", role: "AUTHOR" } }).allowed).toBe(false);
  });
});

describe("rbac", () => {
  it("restricted accounts cannot comment but can still use their wallet library", () => {
    expect(can({ role: "READER", status: "RESTRICTED" }, "engage:comment")).toBe(false);
    expect(can({ role: "READER", status: "RESTRICTED" }, "wallet:use")).toBe(true);
  });
  it("only readers/authors use gift cards; admins hold editor rights", () => {
    expect(can({ role: "EDITOR", status: "ACTIVE" }, "giftcard:use")).toBe(false);
    expect(can({ role: "ADMIN", status: "ACTIVE" }, "book:manage")).toBe(true);
  });
});
