# Bookplatform

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
- `src/lib/submissions.ts`: the editor pool (claim / return / accept / reject) and publishing with lock chapter and sections.
- `src/lib/access.ts`: who can read which chapter.
- `src/lib/rbac.ts`: permissions per role, including restricted and blocked accounts.

## Roadmap

1. ✅ Data model, wallet, gift cards, sections, chapter access, reader pages, comments with Author badge
2. Author submission form and "I want to be an author" page; editor dashboard (pool, review, publish, pen names)
3. Admin: staff accounts, role changes, flags/restrict/block/appeals, homepage scheduling (2 weeks ahead)
4. Accounting: royalty statements, wallet and gift-card reserves reports
5. Statistics dashboards for readers, authors, editors and admins
6. Payment provider integration (Paynow, Stripe)
7. Recommendations, audiobook/video formats, mobile app with offline reading
