-- Additive only: no modification or deletion of existing team/student data.
-- Run once against the configured Relay database before deploying the AI route.
CREATE TABLE IF NOT EXISTS "ReaderAiBudget" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "day" TEXT NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "leaseUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReaderAiBudget_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
