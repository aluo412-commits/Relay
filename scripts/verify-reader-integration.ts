// Explicit integration check: temporary test identity, usage metadata only, and
// (with --ai) one provider request using synthetic course text. Never real school data.
import { createRequire } from "node:module";
const nextEnv = createRequire(`${process.cwd()}/package.json`)("@next/env");
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

async function main() {
  if (!process.argv.includes("--run")) throw new Error("Pass --run to create/delete a temporary test user. Add --ai for one synthetic AI request.");
  nextEnv.loadEnvConfig(process.cwd());
  const { prisma } = await import("../src/lib/db");
  const { reserveReaderBudget, releaseReaderBudget, READER_DAILY_LIMIT } = await import("../src/lib/student/readerBudget");
  const { signSession } = await import("../src/lib/auth");
  const { dayKey } = await import("../src/lib/student/types");
  const user = await prisma.user.create({ data: { email: `reader-test-${randomUUID()}@example.invalid`, name: "Temporary reader integration test" } });
  try {
    const leases = await Promise.all(Array.from({ length: 5 }, () => reserveReaderBudget(user.id)));
    const accepted = leases.filter((l): l is Date => !!l);
    assert.equal(accepted.length, 1, "exactly one concurrent reservation must succeed");
    await releaseReaderBudget(user.id, accepted[0]);
    await prisma.readerAiBudget.update({ where: { userId: user.id }, data: { used: READER_DAILY_LIMIT } });
    assert.equal(await reserveReaderBudget(user.id), null, "daily limit must hold");
    await prisma.readerAiBudget.update({ where: { userId: user.id }, data: { day: "2000-01-01" } });
    const reset = await reserveReaderBudget(user.id); assert.ok(reset);
    const budget = await prisma.readerAiBudget.findUniqueOrThrow({ where: { userId: user.id } });
    assert.equal(budget.used, 1); assert.equal(budget.day, dayKey(new Date()));
    await releaseReaderBudget(user.id, reset);
    console.log("PASS: atomic concurrency limit, daily cap, next-day reset.");
    if (process.argv.includes("--ai")) {
      const origin = process.argv.includes("--production") ? "https://relay.aaronluo.com" : "http://localhost:3002";
      const token = await signSession(user.id);
      const response = await fetch(`${origin}/api/student/analyze`, { method: "POST", headers: { Origin: origin, Cookie: `relay_session=${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ consent: true, capture: { version: 1, pages: [{ id: "synthetic-page", url: "https://fuhsd.schoology.com/assignment/991337", title: "SYNTHETIC integration fixture — not real schoolwork", capturedAt: new Date().toISOString(), text: "This is synthetic test data, not a real student assignment. Course: Example Science. Required homework: read chapter 3 and answer questions 1 and 2. Due October 15, 2026. Recommended extra practice: questions 3 and 4 are optional. Submit the paper at the beginning of class.", warnings: [], links: [] }] } }), signal: AbortSignal.timeout(55000) });
      const result = await response.json();
      assert.equal(response.status, 200, result.error || "analysis endpoint failed");
      assert.ok(result.cards.length > 0);
      assert.ok(result.cards.every((c: { status: string; quote: string }) => c.status === "draft" && c.quote.length >= 8));
      console.log(`PASS: real AI returned ${result.cards.length} evidence-linked drafts from synthetic text; none published.`);
    }
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
    console.log("Temporary identity and its usage records removed.");
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
