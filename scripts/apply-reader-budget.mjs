// Explicit, additive setup. Does not run during build and never alters existing tables.
import nextEnv from "@next/env";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
nextEnv.loadEnvConfig(process.cwd());
if (!process.argv.includes("--apply")) {
  console.error("Usage: node scripts/apply-reader-budget.mjs --apply (uses this project's configured DATABASE_URL)");
  process.exit(1);
}
const db = new PrismaClient();
try {
  const sql = await readFile(new URL("../prisma/changes/2026-10-03-reader-ai-budget.sql", import.meta.url), "utf8");
  await db.$executeRawUnsafe(sql);
  console.log("ReaderAiBudget is ready. Existing tables were not changed; no course text is stored in this table.");
} finally { await db.$disconnect(); }
