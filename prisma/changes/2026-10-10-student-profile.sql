-- Additive metadata only. Existing team, user, and reader budget records remain.
CREATE TABLE IF NOT EXISTS "StudentProfile" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "districtId" TEXT NOT NULL CHECK ("districtId" IN ('fuhsd', 'pausd')),
  "revision" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
