# InkLucus

A multilingual book platform for reading, listening to and publishing books. It's built for English, Shona and Ndebele readers to begin with, and more languages can be added.

Readers buy books (whole or in sections) from a wallet, comment, review and read offline. Authors publish under pen names and see their statistics and income. Editors review submissions and run their catalogue. Admins moderate and curate the home page. Accounting tracks sales, reserves and biweekly royalties.

---

## Contents

1. [Features](#features)
2. [Technology](#technology)
3. [Run it on your computer](#run-it-on-your-computer)
4. [Tests](#tests)
5. [Put it online: VPS + domain](#put-it-online-vps--domain)
6. [Payments setup (Paynow, Stripe)](#payments-setup)
7. [Day-to-day operations](#day-to-day-operations)
8. [Configuration reference](#configuration-reference)
9. [How the business rules work](#how-the-business-rules-work)
10. [Security](#security)
11. [Code map](#code-map)
12. [Known limitations and next steps](#known-limitations-and-next-steps)

---

## Features

| Account | What they can do |
|---|---|
| **Visitor** (not signed in) | Browse, search by genre and language, read free chapters, see book pages and reviews |
| **Reader** | Wallet (top up, send to friends, gift cards with shareable links), buy whole books, sections, audiobooks and video, library, wishlist, likes, star reviews, chapter comments with replies, reading statistics, recommendations, offline reading, text-to-speech, "I want to be an author" submissions, appeals |
| **Author** | Everything a reader can do, plus: read own books in full, submit new books straight to their editor, post chapters, statistics (copies sold per month, likes, wishlists, reads, reviews, comments), income from biweekly royalty statements, editor contact details, pen names (up to 5) |
| **Editor** | Submission pool (claiming a book hides it from other editors), accept or reject with a message (the reader becomes an author automatically), send a book back to the pool with new genres, sign new authors, manage pen names, publish (lock chapter, prices, sections, contract, ISBN, editor's review), covers, audio/video tracks, language editions, homepage proposals every two weeks, statistics |
| **Accounting** | Wallet reserves, gift card reserves, top-ups, sales by format, book purchase tracking with CSV export, each editor's gross income, biweekly author royalty statements (recalculate, adjust, finalise), wallet adjustments with an audit trail |
| **Admin** | Everything an editor can do, plus: staff accounts, account type changes with safety rules, editor handover, flagged accounts, restrict or block with a reason, appeals, automatic deletion of blocked accounts, homepage approval (up to 2 weeks ahead), community links (Discord, Facebook, WhatsApp…), statistics including each editor's performance |

Other features:

- Authors are identified by codes like `AA1234-006109`: the referral code followed by the author's number under that referral.
- Books use internal codes in their URLs, because titles can repeat.
- The ISBN is never shown publicly.
- Age ratings (All, 13+, 16+, 18+) are enforced using each reader's date of birth.
- Every book shows a clear language tag.
- The site installs as an app on phones (PWA), and readers can save chapters for offline reading.

## Technology

| Layer | Choice | Why |
|---|---|---|
| Web app | **Next.js 15** (App Router, Server Actions) + **TypeScript** + React 19 | One codebase for pages and server logic. Pages are rendered on the server, which is good for SEO and slow phones. |
| Styling | **Tailwind CSS 4** | Fast to build with and consistent. Dark mode is included. |
| Database | **PostgreSQL 16** + **Prisma 6** | Money, roles and workflows need transactions and relational integrity. |
| Auth | Signed session cookies (`jose`), bcrypt passwords | No third-party lock-in. Sessions can be revoked ("log out everywhere"). |
| Payments | **Paynow** (EcoCash, OneMoney, local cards) and **Stripe** (international cards) | Both top up the wallet, and every top-up is credited exactly once. |
| Email | Any SMTP provider (via Nodemailer) | Used for password resets. |
| Hosting | **Docker Compose**: app + PostgreSQL + **Caddy** | One command to deploy. Caddy gets and renews HTTPS certificates automatically. |
| Tests | **Vitest** (89 unit/integration tests against a real database) and **Playwright** (40 browser tests, desktop and mobile) | Run automatically on GitHub for every push. |

---

## Run it on your computer

### 1. Install the prerequisites

- **Node.js 22**: https://nodejs.org (choose the LTS installer). Check it with `node -v`.
- **Git**: https://git-scm.com
- **PostgreSQL 16**, either option:
  - **Option A (easiest): Docker Desktop**, https://www.docker.com/products/docker-desktop. Then you don't install Postgres yourself.
  - **Option B: install PostgreSQL directly.** On Windows/macOS use https://www.postgresql.org/download. On Ubuntu: `sudo apt install postgresql`.

### 2. Get the code

```bash
git clone https://github.com/Prince-M-M/-InkLucus.git inklucus
cd inklucus
npm install
```

### 3. Start a database

**Option A: Docker** (one command, keeps running in the background):

```bash
docker run -d --name inklucus-db -p 5432:5432 \
  -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=inklucus \
  -v inklucus-db:/var/lib/postgresql/data postgres:16-alpine
```

Next time, start it again with `docker start inklucus-db`.

**Option B: local PostgreSQL.** Open `psql` as the postgres user and run:

```sql
CREATE USER app WITH PASSWORD 'app' CREATEDB;
CREATE DATABASE inklucus OWNER app;
```

### 4. Configure

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

The defaults work with the database above.

### 5. Create the tables and the demo data

```bash
npx prisma migrate deploy
npm run db:seed
```

### 6. Start the app

```bash
npm run dev
```

Open **http://localhost:3000**.

**Demo accounts** (all use the password `password123`):

| Email | Account |
|---|---|
| `reader@example.com` | Reader with $16.01 in the wallet; owns *Rudo Rwemoyo* |
| `teen@example.com` | 14-year-old reader (can't open the 18+ book) |
| `author@example.com` | Author `AA1234-000001`, pen name *Rudo Moyo* |
| `editor@example.com` | Editor |
| `admin@example.com` | Admin |
| `accounts@example.com` | Accounting |

**Things that behave differently on your computer:**

- **Payments:** `PAYMENTS_DEV_MODE=true` adds a *Test payment* option to the wallet top-up. It simulates a successful or failed payment, and no real money moves. This is refused in production.
- **Emails:** with `SMTP_HOST` empty, password-reset emails are printed in the terminal where `npm run dev` is running. Copy the link from there.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server with live reload |
| `npm run build && npm start` | Run a production build locally |
| `npm run db:seed` | Add the demo data (safe to run again) |
| `npx prisma studio` | Browse and edit the database in your browser |
| `npm run create-admin -- --email you@example.com --name "You"` | Create or promote an admin (asks for the password) |
| `npm run lint` / `npm run typecheck` | Code checks |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Browser tests (needs `npm run build` first) |

---

## Tests

There are two suites, and both run against real PostgreSQL databases, separate from your development one.

**One-time setup:** create the test databases.

```bash
# Docker database:
docker exec -it inklucus-db psql -U app -d inklucus -c "CREATE DATABASE inklucus_test" -c "CREATE DATABASE inklucus_e2e"
# or local PostgreSQL:
psql -U app -d inklucus -c "CREATE DATABASE inklucus_test" -c "CREATE DATABASE inklucus_e2e"

DATABASE_URL=postgresql://app:app@localhost:5432/inklucus_test npx prisma migrate deploy
npx playwright install chromium
```

**Run them:**

```bash
npm test                          # 89 unit/integration tests (about 15 s)
npm run build && npm run test:e2e # 40 browser tests on desktop and mobile (about 1 min)
```

What's covered:

- **Money:** the wallet never overdraws, even with simultaneous purchases. Gift cards can be used once and expire. Payment notifications are credited exactly once, and forged or mismatched ones are rejected.
- **Content:** sections and whole-book pricing, chapter access rules, age gating, audio/video access, and the offline cache.
- **Workflows:** the submission → review → publish flow, pen names, editions, comments, reviews, likes, moderation, appeals, account deletion, homepage scheduling, royalties and reports.
- **Security:** rate limits, session revocation, password reset, open redirects, path traversal, security headers, CSV formula injection, file-type checks, and role-protected pages.

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, both test suites and a Docker build on every push and pull request.

---

## Put it online: VPS + domain

This guide uses **Ubuntu 24.04** on any VPS provider (Hetzner, DigitalOcean, Vultr, Linode, Contabo, AWS Lightsail…). You'll end up with `https://yourdomain.com`, with HTTPS certificates that renew automatically.

### What you need

- A VPS with **2 GB RAM minimum** (4 GB recommended), 1–2 vCPU and 25 GB+ disk
- A domain name (from Namecheap, Cloudflare, GoDaddy, or a `.co.zw` registrar)
- About 30 minutes

### Step 1: Point your domain at the server

Find your VPS's **public IPv4 address** in the provider's dashboard (e.g. `203.0.113.10`). Then, in your domain registrar's **DNS settings**, create:

| Type | Name / Host | Value | TTL |
|---|---|---|---|
| `A` | `@` | `203.0.113.10` | Auto / 300 |
| `A` | `www` | `203.0.113.10` | Auto / 300 |

If your VPS also has an IPv6 address, add matching `AAAA` records. Otherwise don't add any.

> **Using Cloudflare?** Set both records to **DNS only** (grey cloud) until the site is working. Caddy needs to reach Let's Encrypt directly to get the certificate. You can turn the proxy (orange cloud) on afterwards, with SSL mode set to **Full (strict)**.

DNS changes usually take 5–30 minutes, and occasionally a few hours. Check from your computer:

```bash
nslookup yourdomain.com        # should show your VPS IP
```

### Step 2: Log in and secure the server

From your computer (Windows: use PowerShell or Windows Terminal):

```bash
ssh root@203.0.113.10
```

On the server:

```bash
# Updates and automatic security patches
apt update && apt upgrade -y
apt install -y git ufw unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# A normal user for day-to-day work (replace "deploy" if you like)
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copies your SSH key, if you used one

# Firewall: only SSH and web traffic
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Swap, so the build doesn't run out of memory on small servers
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Step 3: Install Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

Log out, then log back in as the new user:

```bash
exit
ssh deploy@203.0.113.10
docker --version && docker compose version   # both should print a version
```

### Step 4: Get the code

```bash
cd ~
git clone https://github.com/Prince-M-M/-InkLucus.git inklucus
cd inklucus
```

> The repository is private? Create a **personal access token** on GitHub (Settings → Developer settings → Fine-grained tokens, with read access to this repo). Use it as the password when `git clone` asks.

### Step 5: Configure

```bash
cp .env.production.example .env
nano .env
```

Fill in at least:

- `DOMAIN=yourdomain.com`: no `https://` and no `www`
- `APP_URL=https://yourdomain.com`
- `POSTGRES_PASSWORD`, `SESSION_SECRET` and `CRON_SECRET`: generate each with `openssl rand -base64 48` and paste the result
- the SMTP settings, so password resets can be emailed (see [Email](#email))
- the Paynow and/or Stripe keys (see [Payments setup](#payments-setup)). You can add them later.

Save with **Ctrl+O, Enter** and exit with **Ctrl+X**. Then make the file readable only by you:

```bash
chmod 600 .env
```

### Step 6: Start everything

```bash
docker compose up -d --build
```

The first build takes 3–8 minutes. Then check:

```bash
docker compose ps                   # db, app and caddy should be "Up" (app: "healthy")
docker compose logs -f app          # "All migrations have been successfully applied" then "Ready". Ctrl+C to stop watching.
docker compose logs caddy | grep -i certificate   # "certificate obtained successfully"
```

Open **https://yourdomain.com**. You should see the padlock, and `http://` and `www.` both redirect to it.

### Step 7: Create your admin account

```bash
docker compose exec app node scripts/create-admin.cjs --email you@yourdomain.com --name "Your Name"
```

It asks for a password (at least 10 characters). Log in at `https://yourdomain.com/login`. From **Admin → Accounts → Create a staff account** you can then add editors and accounting staff.

> Demo data is **not** loaded in production. Your site starts empty.

### Step 8: Schedule the daily jobs and backups

```bash
crontab -e     # choose nano if asked
```

Add these lines, replacing `yourdomain.com` and the path if yours differ:

```cron
# Daily maintenance at 02:15: expire gift cards, delete blocked accounts past their grace period, recalculate royalty drafts
15 2 * * * cd /home/deploy/inklucus && curl -fsS -X POST -H "Authorization: Bearer $(grep ^CRON_SECRET= .env | cut -d= -f2-)" https://yourdomain.com/api/cron > /dev/null
# Database + uploads backup at 03:30, keeping 14 days
30 3 * * * /home/deploy/inklucus/scripts/backup.sh >> /home/deploy/inklucus/backups/backup.log 2>&1
```

Backups go to `~/inklucus/backups/`. **Copy them off the server too**, for example to Google Drive, Backblaze or S3 with [rclone](https://rclone.org): `rclone copy ~/inklucus/backups remote:inklucus-backups`.

**Restore** a backup:

```bash
docker compose stop app
docker compose exec -T db pg_restore -U inklucus -d inklucus --clean --if-exists < backups/db-YYYY-MM-DD_HHMM.dump
docker compose exec -T app tar -xzf - -C /app < backups/uploads-YYYY-MM-DD_HHMM.tar.gz   # covers (run after the app starts)
docker compose start app
```

### Updating to a new version

```bash
cd ~/inklucus
git pull
docker compose up -d --build     # database migrations run automatically on start
```

### Troubleshooting

| Problem | Fix |
|---|---|
| Browser says the certificate is invalid, or the site won't load | Check DNS (`nslookup yourdomain.com` must show your server IP). Ports 80 and 443 must be open (`sudo ufw status`). Run `docker compose logs caddy`. With Cloudflare, use "DNS only" first. |
| `502 Bad Gateway` | The app is still starting or has crashed. Run `docker compose logs app`. |
| App logs show `Unsafe production configuration` | Fix the listed settings in `.env` (e.g. a secret is still the example value, or `APP_URL` isn't `https://`), then run `docker compose up -d`. |
| Build fails with "killed" or out of memory | Add swap (Step 2) or use a bigger VPS. |
| Forms fail with an "origin" error | `APP_URL` and `DOMAIN` must match the address you use in the browser exactly. |
| Password reset emails don't arrive | Check the SMTP settings and run `docker compose logs app \| grep mail`. Your domain also needs SPF/DKIM records from your email provider. |

---

## Payments setup

Wallet top-ups go through a payment provider, and purchases are then paid from the wallet. Only the providers you configure appear on the wallet page.

### Paynow (EcoCash, OneMoney, ZimSwitch, Visa/Mastercard in Zimbabwe)

1. Create a merchant account at https://www.paynow.co.zw and add an **integration**: *Other Integrations → Create Shop*.
2. Copy the **Integration ID** and **Integration Key** into `.env`:
   ```
   PAYNOW_INTEGRATION_ID=12345
   PAYNOW_INTEGRATION_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   PAYNOW_AUTH_EMAIL=payments@yourdomain.com
   ```
3. You don't need to register callback URLs. The app sends Paynow the result URL (`https://yourdomain.com/api/payments/paynow/result`) and the return URL with each payment.
4. Run `docker compose up -d`, then make a small real test payment.

Every Paynow message is checked with its SHA-512 hash. When a reader returns from Paynow, the app also asks Paynow directly for the payment status.

### Stripe (international cards)

1. At https://dashboard.stripe.com → **Developers → API keys**, copy the **Secret key** into `STRIPE_SECRET_KEY`.
2. **Developers → Webhooks → Add endpoint**:
   - URL: `https://yourdomain.com/api/payments/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
3. Copy the endpoint's **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`, then run `docker compose up -d`.

Test first with Stripe's **test mode** keys and the card `4242 4242 4242 4242`, then switch to live keys.

### Email

Any SMTP service works: Brevo, Mailgun, Postmark, Amazon SES, Zoho Mail, or Google Workspace. Put its host, port, username and password in `SMTP_*`, and set `MAIL_FROM` to an address on your domain. Add the SPF/DKIM DNS records your email provider gives you, so emails don't land in spam.

---

## Day-to-day operations

- **Logs:** `docker compose logs -f app` (app), `docker compose logs caddy` (web server and certificates)
- **Restart:** `docker compose restart app`
- **Database console:** `docker compose exec db psql -U inklucus -d inklucus`
- **Disk space:** `df -h`. Old Docker images can be removed with `docker image prune -f`.
- **Royalties:** the daily job keeps draft statements up to date. After each two-week period ends, accounting reviews **Accounting → Author royalties**, adds any adjustments, and clicks **Finalise**. Authors then see the statement as income.
- **Home page:** editors propose books every two weeks under **Editor → Homepage**. Admins approve them under **Admin → Homepage**, for the current or the next period.

---

## Configuration reference

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | yes | (set by Docker Compose) | PostgreSQL connection string |
| `SESSION_SECRET` | yes | (none) | 32+ random characters for signing sessions |
| `APP_URL` | yes | `http://localhost:3000` | Public address; must be `https://` in production |
| `DOMAIN` | Docker only | (none) | Domain for Caddy's certificate, e.g. `inklucus.com` |
| `POSTGRES_PASSWORD` | Docker only | (none) | Database password |
| `CRON_SECRET` | production | (none) | Protects `POST /api/cron` |
| `TRUST_PROXY` | no | `false` (`true` in Docker) | Trust `X-Forwarded-For` from Caddy for client IPs |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | for email | (none) | Outgoing email |
| `CURRENCY` | no | `USD` | Currency code for payments |
| `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY`, `PAYNOW_AUTH_EMAIL` | for Paynow | (none) | Paynow integration |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for Stripe | (none) | Stripe integration |
| `PAYMENTS_DEV_MODE` | no | `false` | Test payments; local development only |
| `UPLOAD_DIR` | no | `./uploads` | Where book covers are stored |
| `GIFT_CARD_VALIDITY_DAYS` | no | `365` | How long gift cards stay valid |
| `ROYALTY_COST_DEDUCTION_PERCENT` | no | `0` | Platform costs deducted from gross sales before royalties |
| `RATE_LIMIT_IP_MULTIPLIER` | no | `1` | Raise if many users share one IP address |

---

## How the business rules work

- **Money** is stored as whole cents. Every wallet change is written to an append-only ledger, and the balance always equals the ledger total. Wallet money can't be withdrawn. It can be spent on books, sent to another reader or author, or turned into a gift card. Staff accounts have no wallet.
- **Gift cards** are a 16-character code plus a link (`/gift/CODE`). Each can be redeemed once and is valid for `GIFT_CARD_VALIDITY_DAYS`. Only reader and author accounts can use them. Accounting sees unredeemed cards as *gift card reserves*.
- **Selling books:**
  - Chapters before the **lock chapter** are free.
  - Long books can be split into **sections** (e.g. 50 chapters each). A shorter last section is priced in proportion to its length.
  - The whole-book price is reduced by what the reader has already paid for sections.
  - Whole-book owners get new chapters free. Section buyers keep exactly the chapters they paid for, and new chapters go into a new section.
- **Audiobooks and video** are sold separately. Video has an optional discount for whole-book owners. Media files are hosted on your storage (e.g. a private Cloudflare R2 bucket), and readers only receive the link after their access is checked.
- **Royalties** are calculated per book and per two-week period (periods start on Mondays):
  `author income = gross sales × (100% − ROYALTY_COST_DEDUCTION_PERCENT) × contract royalty %`
  Gross sales include text, sections, audio and video. Statements stay in draft and are recalculated until accounting finalises them.
- **Submissions:**
  - New writers submit through *I want to be an author*. The book goes to the pool, and the first editor to claim it reviews it.
  - On acceptance, the reader becomes an author. Their author ID uses the referral code given on the form, or `AA0000` if none.
  - Existing authors' new books go straight to their editor, or to their pen name's editor if they chose a pen name.
- **Age ratings:** 16+ and 18+ books need a signed-in reader whose date of birth shows they're old enough. Accounts require age 13+.
- **Moderation:**
  - Restricted accounts can read what they bought, but can't comment, review, like or submit.
  - Blocked accounts see the reason and can appeal. They are deleted after the grace period unless an appeal is pending.
  - Deletion removes personal data, comments and reviews. Purchase records are kept, anonymised, for accounting.
- **Account type changes:**
  - Admins can't change their own account.
  - Author accounts keep their type.
  - Readers with wallet money can't become staff.
  - Editors must hand over their authors and books before losing editor rights. Use *Hand over an editor's work* for that.

---

## Security

What is in place:

- **Passwords:** bcrypt (cost 12), at least 8 characters, a list of common passwords is rejected, and login takes the same time whether or not the email exists.
- **Sessions:** HttpOnly, SameSite=Lax cookies, marked Secure over HTTPS. Sessions are versioned, so changing the password or choosing *log out everywhere* logs out every other device.
- **Password reset:** single-use links that expire after 1 hour. Only a SHA-256 hash of the token is stored, and the response is identical whether or not the email exists.
- **Rate limits** (stored in the database) on login (per email and per IP), sign-up, password reset, comments, reports, gift card redemption, top-ups, submissions and uploads.
- **Authorization** is checked on the server for every action and page, not just hidden in the interface. Tests confirm that other users' data and paid content can't be reached.
- **Payments:**
  - Stripe webhooks are verified by signature, with a timestamp tolerance.
  - Paynow messages are verified by hash.
  - The paid amount must match what was requested.
  - Each payment is credited exactly once.
- **Money operations** use database transactions with conditional updates, so there is no double-spending under concurrency.
- **Uploads:** the image type is detected from the file contents (only JPEG, PNG or WebP are accepted), files are limited to 2 MB, file names are random, and only generated names can be served (no path traversal).
- **Headers:**
  - Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy and Permissions-Policy on every response.
  - HSTS from Caddy.
  - No `X-Powered-By` header.
- **Other:**
  - Login redirects can only go to pages on this site.
  - CSV exports are protected against spreadsheet formula injection.
  - The ISBN is never sent to the public site.
  - The production config refuses to start with unsafe settings.
  - The container runs as a non-root user.
  - Only ports 80 and 443 are exposed (the database isn't reachable from the internet).

Remaining dependency advisories:

- PostCSS inside Next.js is used only at build time, on our own CSS.
- The Prisma CLI's config loader is used only by migrations, with our own trusted config.

Neither can be exploited by visitors. They're fixed by the Next.js 16 and Prisma 7 major upgrades (see below).

Please report security problems privately to the repository owner rather than in public issues.

---

## Code map

```
prisma/schema.prisma            Data model (users, books, chapters, sections, wallet ledger, gift cards, payments, royalties…)
prisma/migrations/              Database migrations (applied automatically on deploy)
prisma/seed.ts                  Demo data for development and tests
src/lib/                        Business logic (no UI)
  wallet.ts                     Top-ups, transfers, gift cards, purchases, media purchases, adjustments
  payments/                     Paynow + Stripe integrations and webhook handlers
  submissions.ts                Submission → pool → review → publish; adding chapters
  authors.ts, staff.ts          Author IDs and pen names; account types and editor handover
  reading.ts, access.ts, age.ts Who can read or play what
  engagement.ts                 Comments, replies, reviews, likes, wishlists
  moderation.ts                 Flags, restrict/block, appeals, account deletion
  homepage.ts                   Two-week homepage periods, proposals and approvals
  royalties.ts, reports.ts      Royalty statements; finance reports and CSV
  stats.ts                      Reader, author, editor and admin statistics
  auth.ts, password*.ts, rate-limit.ts, config.ts   Security foundations
src/app/                        Pages and server actions (one folder per URL)
public/sw.js                    Service worker for offline reading
tests/                          Vitest unit/integration tests
e2e/                            Playwright browser tests
Dockerfile, docker-compose.yml, deploy/   Production deployment
scripts/                        create-admin, backup
```

---

## Known limitations and next steps

- **Payments:** the Paynow and Stripe integrations follow the providers' documented formats and are covered by tests with signed and hashed messages, but they haven't been run against the live services yet. Do one small real payment with each before launch (Stripe test mode first).
- **Media protection:** paid audio and video links are only given out after an access check. Someone who has bought them could still share the link. For stronger protection, use short-lived signed URLs from your storage provider (e.g. R2/S3 presigned links). The redirect in `src/app/api/media/[id]/route.ts` is the single place to change.
- **Native mobile app:** the website installs as an app (PWA), with offline reading and device text-to-speech. A store app (React Native/Expo) can reuse the same server.
- **Framework upgrades:** move to Next.js 16 and Prisma 7 when convenient, to clear the build-time-only advisories above.
- **Legal pages:** `/terms` and `/privacy` are templates. Have them reviewed before launch.
- **Recommendations** use genre and language overlap. They can be made smarter as reading data grows.
