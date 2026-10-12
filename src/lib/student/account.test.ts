import { test } from "node:test";
import assert from "node:assert/strict";
import { accountScope, localDataKey, sessionBinding } from "./account";
import { encryptLocal, decryptLocal } from "../../../extensions/course-reader/vault.js";
import { districtById } from "../../../extensions/course-reader/districts.js";
import { schoolUrl } from "../../../extensions/course-reader/sync-core.js";
import { assertDistrictPages } from "./readerSync";
import { safeReaderUrl } from "./reader";
import { validateCalendarUrl, parseSchoologyCalendar } from "./schoology";
import { submissionObservations } from "./readerPolicy";

test("PAUSD routes use the selected approved Schoology host, never a generic arbitrary school URL", () => {
  const school = districtById("pausd")!.schoology;
  assert.equal(school, "https://pausd.schoology.com");
  assert.equal(schoolUrl("/course/123/materials?f=4", school), school + "/course/123/materials?f=4");
  assert.equal(schoolUrl("https://fuhsd.schoology.com/course/123", school), null);
  assert.equal(schoolUrl("/courses", "https://evil.example"), null);
  assert.equal(safeReaderUrl(school + "/assignment/123"), school + "/assignment/123");
  assert.equal(safeReaderUrl("https://pausd.schoology.org/assignment/123"), null);
  assert.throws(() => assertDistrictPages([{ url: "https://fuhsd.schoology.com/assignment/1" }], school));
  assert.throws(() => assertDistrictPages([{ url: "https://docs.google.com/document/d/example/edit", descriptionSource: "https://fuhsd.schoology.com/course/1/materials" }], school));
  assert.equal(validateCalendarUrl(school + "/calendar/feed", "pausd").hostname, "pausd.schoology.com");
  assert.throws(() => validateCalendarUrl(school + "/calendar/feed", "fuhsd"));
  const calendar = parseSchoologyCalendar("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:test\nSUMMARY:Synthetic event\nDTSTART;VALUE=DATE:20261010\nEND:VEVENT\nEND:VCALENDAR", "pausd");
  assert.equal(calendar.items[0].url, school + "/calendar");
  assert.equal(submissionObservations({ id: "test", url: school + "/assignment/123", title: "Synthetic", text: "Submission status: Submitted", capturedAt: new Date().toISOString(), warnings: [], links: [] })[0].status, "submitted");
});
test("local course data is authenticated-encrypted per account AND district; session changes invalidate pairing", async () => {
  const old = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "synthetic-test-secret-".repeat(3);
  try {
    const a = accountScope("synthetic-a", "fuhsd"), b = accountScope("synthetic-b", "fuhsd"), p = accountScope("synthetic-a", "pausd");
    assert.notEqual(a, b); assert.notEqual(a, p);
    const encrypted = await encryptLocal({ text: "SYNTHETIC private instructions" }, localDataKey(a), a);
    assert.equal(JSON.stringify(encrypted).includes("private instructions"), false);
    assert.deepEqual(await decryptLocal(encrypted, localDataKey(a), a), { text: "SYNTHETIC private instructions" });
    await assert.rejects(decryptLocal(encrypted, localDataKey(b), b));
    await assert.rejects(decryptLocal(encrypted, localDataKey(a), p));
    await assert.rejects(decryptLocal({ text: "old unowned plaintext" }, localDataKey(a), a));
    assert.notEqual(sessionBinding("a", "fuhsd", "r1", "session1"), sessionBinding("a", "fuhsd", "r1", "session2"));
    assert.notEqual(sessionBinding("a", "fuhsd", "r1", "session1"), sessionBinding("a", "pausd", "r2", "session1"));
  } finally { if (old === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = old; }
});
