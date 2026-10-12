// Additive account-routing metadata only; never resets or changes existing rows.
import nextEnv from "@next/env";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
nextEnv.loadEnvConfig(process.cwd());
if (!process.argv.includes("--apply")) throw new Error("Pass --apply to create StudentProfile in the configured database.");
const db = new PrismaClient();
try { await db.$executeRawUnsafe(await readFile(new URL("../prisma/changes/2026-10-10-student-profile.sql", import.meta.url), "utf8")); console.log("StudentProfile ready. No existing account or course records changed."); } finally { await db.$disconnect(); }
