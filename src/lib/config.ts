import { z } from "zod";

/**
 * All runtime configuration, validated once. In production, missing or unsafe
 * values stop the server from starting rather than failing later at runtime.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  CRON_SECRET: z.string().min(16).optional(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  /** Scales per-IP limits (sign-up, login per IP). Raise it if many users share one IP; tests use a high value. */
  RATE_LIMIT_IP_MULTIPLIER: z.coerce.number().min(1).default(1),

  // Email (password resets). If SMTP_HOST is unset, emails are printed to the server log.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("InkLucus <no-reply@localhost>"),

  // Payments
  CURRENCY: z.string().length(3).default("USD"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYNOW_INTEGRATION_ID: z.string().optional(),
  PAYNOW_INTEGRATION_KEY: z.string().optional(),
  PAYNOW_AUTH_EMAIL: z.string().optional(),
  PAYMENTS_DEV_MODE: z.enum(["true", "false"]).default("false"),

  // Uploads (book covers)
  UPLOAD_DIR: z.string().default("./uploads"),

  // Business rules
  GIFT_CARD_VALIDITY_DAYS: z.coerce.number().int().min(30).default(365),
  /** Percentage of gross sales deducted (platform costs) before the author's royalty % is applied. */
  ROYALTY_COST_DEDUCTION_PERCENT: z.coerce.number().min(0).max(100).default(0),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Invalid configuration:\n" + parsed.error.issues.map((i) => ` - ${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production") {
    const problems: string[] = [];
    if (/dev-only|change-me/i.test(c.SESSION_SECRET)) problems.push("SESSION_SECRET is still the development value");
    if (c.PAYMENTS_DEV_MODE === "true") problems.push("PAYMENTS_DEV_MODE must be false in production");
    if (!c.APP_URL.startsWith("https://")) problems.push("APP_URL must use https:// in production");
    if (!c.CRON_SECRET) problems.push("CRON_SECRET is required in production");
    if (problems.length) throw new Error("Unsafe production configuration:\n - " + problems.join("\n - "));
  }
  cached = c;
  return c;
}

/** For tests. */
export function resetConfigCache() {
  cached = undefined;
}
