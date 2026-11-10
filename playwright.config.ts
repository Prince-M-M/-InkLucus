import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build on a separate database.
 *   npm run build && npm run test:e2e
 * The webServer command migrates + seeds the e2e database, then starts the app on port 3100.
 */
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://app:app@localhost:5432/inklucus_e2e";
const env = {
  DATABASE_URL: E2E_DB,
  SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-123456",
  APP_URL: "http://localhost:3100",
  PAYMENTS_DEV_MODE: "true",
  CRON_SECRET: "e2e-cron-secret-1234567890",
  UPLOAD_DIR: "./.e2e-uploads",
  NODE_ENV: "test",
  RATE_LIMIT_IP_MULTIPLIER: "100",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "off",
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: "npx prisma migrate deploy && npx tsx e2e/reset.ts && npx tsx prisma/seed.ts && npx next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 180_000,
    env,
  },
});
