# InkLucus

A multilingual web-novel platform for reading, buying and publishing books. It covers readers, authors, editors, accounting and admins, with wallets, gift cards and books sold by section.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web app | **Next.js 15 (App Router) + TypeScript** | Pages and API in one codebase. Server rendering helps SEO for book pages. |
| Styling | **Tailwind CSS** | Fast to build with and easy to keep consistent. |
| Database | **PostgreSQL + Prisma** | Money, roles and workflows need relational integrity and transactions. |
| Auth | Signed JWT session cookie (`jose`) + bcrypt | Simple and has no lock-in. Swap in Auth.js or Better Auth later for Google/Facebook login. |
| Payments (wallet top-ups) | **Paynow (EcoCash / OneMoney)** + **Stripe** for cards | Local mobile money plus international cards. Both credit the wallet through `topUp()`, which handles repeated webhook deliveries safely. |
| File storage | S3-compatible storage (Cloudflare R2) | Covers, audiobooks and video. |
| Search | Postgres `ILIKE` now, **Meilisearch** later | Typo-tolerant search when the catalogue grows. |
| Mobile app | **React Native (Expo)** sharing the same API | Offline downloads (SQLite) and device text-to-speech (`expo-speech`). |
| Scheduled jobs | Cron (e.g. Vercel Cron or a worker) | Gift card expiry, biweekly royalties, deleting blocked accounts. |
| Hosting | Vercel or Render + managed Postgres (Neon or Supabase) | |

## Getting started

```bash
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET
npm install
npx prisma migrate dev
npm run db:seed               # demo users, password: password123
npm run dev
```

Demo logins: `reader@`, `author@`, `editor@`, `admin@`, `accounts@` at `example.com`.

Tests use a separate database (`bookplatform_test`, or set `TEST_DATABASE_URL`):

```bash
DATABASE_URL=postgresql://app:app@localhost:5432/bookplatform_test npx prisma migrate deploy
npm test
```

## Code map

- `prisma/schema.prisma`: the full data model, including roles, pen names, the submission pool, sections, the wallet ledger, gift cards, homepage curation and moderation.
- `src/lib/wallet.ts`: top-ups, transfers, gift cards and purchases. Every balance change has an entry in an append-only ledger, and debits can't overdraw.
- `src/lib/authors.ts`: author identity codes (`AA1234-006109`) and the 5-pen-name limit.
- `src/lib/submissions.ts`: the submission → pool → review → publish workflow. New chapters on a published book are added to sections at a pro-rata price.
- `src/lib/manuscript.ts`: splits a pasted manuscript into chapters at each `# ` heading.
- `src/lib/guards.ts`: page and action access by role.
- `src/lib/staff.ts`: account-type changes and editor handover.
- `src/lib/moderation.ts`: flags, restrict/block, appeals, account deletion.
- `src/lib/homepage.ts`: two-week homepage periods, proposals and approvals.

## Scheduled jobs

Call `POST /api/cron` once a day with `Authorization: Bearer $CRON_SECRET`. It expires old gift cards and deletes blocked accounts whose grace period has ended (unless an appeal is pending). Deleted accounts lose their personal data and public content, but purchase and wallet records are kept, anonymised, for accounting.
- `src/lib/access.ts`: who can read which chapter.
- `src/lib/rbac.ts`: permissions per role, including restricted and blocked accounts.

## Roadmap

1. ✅ Data model, wallet, gift cards, sections, chapter access, reader pages, comments with Author badge
2. ✅ Author submissions and editor workflow:
   - "I want to be an author" page with requirements and a submission form (manuscript paste, referral code).
   - Author dashboard: books, stats, editor contact and pen names. Authors can submit new books and post chapters.
   - Editor dashboard: submission pool, claim, accept or reject with a message, return to pool with new genres, pen names, signing up authors, and publishing with contract, lock chapter, prices and sections.
3. ✅ Admin:
   - Accounts: search, create staff accounts, change account types (with safety rules) and hand an editor's work to another editor.
   - Moderation: "Report" on comments, a flagged-accounts list, restrict or block with a reason, appeals, and automatic deletion of blocked accounts after a grace period.
   - Homepage: editors propose books every two weeks and admins approve them for the current or next period (max 12 per list).
4. Accounting: royalty statements, wallet and gift-card reserves reports
5. Statistics dashboards for readers, authors, editors and admins
6. Payment provider integration (Paynow, Stripe)
7. Recommendations, audiobook/video formats, mobile app with offline reading
