import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { fileParallelism: false, env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://app:app@localhost:5432/bookplatform_test" } },
});
