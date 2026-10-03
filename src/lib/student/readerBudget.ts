import { prisma } from "../db";
import { dayKey } from "./types";
export const READER_DAILY_LIMIT = 12;

/** One atomic reservation across all serverless instances; failed requests still count. */
export async function reserveReaderBudget(userId: string, now = new Date()): Promise<Date | null> {
  const day = dayKey(now);
  const leaseUntil = new Date(now.getTime() + 65000);
  const result = await prisma.$queryRaw<{ userId: string }[]>`
    INSERT INTO "ReaderAiBudget" ("userId", "day", "used", "leaseUntil", "updatedAt")
    VALUES (${userId}, ${day}, 1, ${leaseUntil}, ${now})
    ON CONFLICT ("userId") DO UPDATE SET
      "day" = EXCLUDED."day",
      "used" = CASE WHEN "ReaderAiBudget"."day" = EXCLUDED."day" THEN "ReaderAiBudget"."used" + 1 ELSE 1 END,
      "leaseUntil" = EXCLUDED."leaseUntil", "updatedAt" = EXCLUDED."updatedAt"
    WHERE ("ReaderAiBudget"."leaseUntil" IS NULL OR "ReaderAiBudget"."leaseUntil" <= ${now})
      AND ("ReaderAiBudget"."day" <> ${day} OR "ReaderAiBudget"."used" < ${READER_DAILY_LIMIT})
    RETURNING "userId"
  `;
  return result.length ? leaseUntil : null;
}
export async function releaseReaderBudget(userId: string, leaseUntil: Date) {
  await prisma.readerAiBudget.updateMany({ where: { userId, leaseUntil }, data: { leaseUntil: null } });
}
