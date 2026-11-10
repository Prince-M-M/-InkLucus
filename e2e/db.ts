import { PrismaClient } from "@prisma/client";

/** Direct database access from tests, always against the e2e database. */
export const e2eDb = () => new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL ?? "postgresql://app:app@localhost:5432/inklucus_e2e" });
