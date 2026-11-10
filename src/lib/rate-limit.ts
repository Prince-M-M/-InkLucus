import { db } from "./db";

/**
 * Fixed-window rate limiter stored in Postgres (works across restarts and multiple app processes).
 * Returns true if the action is allowed.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, now = new Date()): Promise<boolean> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" <= ${new Date(now.getTime() - windowSeconds * 1000)} THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" <= ${new Date(now.getTime() - windowSeconds * 1000)} THEN ${now} ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  return rows[0].count <= limit;
}

export async function clearRateLimit(key: string) {
  await db.rateLimit.deleteMany({ where: { key } });
}

/** Housekeeping (cron): drop windows older than a day. */
export async function pruneRateLimits(now = new Date()) {
  const res = await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 86_400_000) } } });
  return res.count;
}

export const LIMITS = {
  login: { limit: 10, window: 15 * 60 },
  // Per-IP limits are generous: mobile networks put many people behind one IP address.
  loginIp: { limit: 100, window: 15 * 60 },
  register: { limit: 20, window: 60 * 60 },
  reset: { limit: 3, window: 60 * 60 },
  comment: { limit: 20, window: 10 * 60 },
  flag: { limit: 20, window: 60 * 60 },
  submit: { limit: 5, window: 24 * 60 * 60 },
  payment: { limit: 10, window: 60 * 60 },
  upload: { limit: 30, window: 60 * 60 },
} as const;
