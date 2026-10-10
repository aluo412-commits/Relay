import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHOOL, PAGE_LIMIT, schoolUrl, googleUrl, isDue, addJobs, putSnapshot } from "../../../extensions/course-reader/sync-core.js";
import { autoBatch, excerptFingerprint, mergeDailySnapshot, validateSyncReport } from "./readerSync";
import { EMPTY_READER, validateCapture, type ReaderCard } from "./reader";
const page = (id = "1") => ({ id: `page-${id}`, url: `${SCHOOL}/assignment/${id}`, title: "Synthetic course", text: "Required practice: read chapter three and complete question one.", capturedAt: "2026-01-01T12:00:00Z", warnings: [], links: [] });
const report = { id: "synthetic-sweep", status: "checked", startedAt: "2026-01-01T12:00:00Z", finishedAt: "2026-01-01T12:30:00Z", courses: [{ id: "123", title: "Synthetic science" }], read: 1, changed: 1, unread: [], unreadCount: 0, limited: false, checked: 1, queued: 0, message: "Text only." };

test("daily scheduler catches up after 8 Pacific, handles DST and does not spin on expired login", () => {
  const settings = { enabled: true };
  assert.equal(isDue(settings, null), true);
  assert.equal(isDue({ enabled: false }, null), false);
  assert.equal(isDue(settings, { ...report, status: "running" }), true);
  assert.equal(isDue(settings, { ...report, status: "login-required" }), false);
  assert.equal(isDue(settings, { ...report, startedAt: "2026-03-07T16:00:00Z" }, new Date("2026-03-08T14:59:00Z")), false);
  assert.equal(isDue(settings, { ...report, startedAt: "2026-03-07T16:00:00Z" }, new Date("2026-03-08T15:00:00Z")), true);
  assert.equal(isDue(settings, { ...report, startedAt: "2026-03-08T15:00:00Z" }, new Date("2026-03-08T23:00:00Z")), false);
});
test("daily traversal only admits read paths and normalizes pagination without secrets", () => {
  assert.equal(schoolUrl("/course/123"), `${SCHOOL}/course/123/materials`);
  assert.equal(schoolUrl("/course/123/materials?f=4&page=2&token=secret"), `${SCHOOL}/course/123/materials?f=4&page=2`);
  for (const path of ["/assignment/123/submit", "/course/123/members", "/user/123", "/logout", "/external_tool/123/launch", "https://fuhsd.schoology.org/courses", "https://user:pass@fuhsd.schoology.com/courses"]) assert.equal(schoolUrl(path), null);
  assert.equal(googleUrl("https://docs.google.com/presentation/d/synthetic/edit?token=secret"), "https://docs.google.com/presentation/d/synthetic/edit");
  assert.equal(googleUrl("https://evil.example/document/d/synthetic/edit"), null);
});
test("crawl queue deduplicates cyclic links and reports its hard coverage limit", () => {
  const run = { visited: [SCHOOL + "/courses"], queue: [] as { url: string }[], limited: false };
  addJobs(run, [{ url: SCHOOL + "/courses" }, ...Array.from({ length: 300 }, (_, i) => ({ url: `${SCHOOL}/assignment/${i}` }))]);
  assert.equal(run.queue.length, PAGE_LIMIT - 1); assert.equal(run.limited, true);
  addJobs(run, [...run.queue]); assert.equal(run.queue.length, PAGE_LIMIT - 1);
});
test("daily library accepts 300 pages without enlarging the AI endpoint's eight-page limit", () => {
  const pages = Array.from({ length: 20 }, (_, i) => page(String(i)));
  assert.throws(() => validateCapture({ version: 1, pages }));
  assert.equal(mergeDailySnapshot(EMPTY_READER, { version: 1, pages }, report).pages.length, 20);
  assert.throws(() => mergeDailySnapshot(EMPTY_READER, { version: 1, pages: Array.from({ length: 301 }, (_, i) => page(String(i))) }, report));
});
test("automatic imports preserve manual sources and stable IDs; changes invalidate approved cards", () => {
  const original = page(), manual = page("2"); original.id = "older-manual-identifier";
  const card = { id: "reader-" + "a".repeat(24), sourceId: original.id, sourceUrl: original.url, status: "accepted" } as ReaderCard;
  const initial = { ...EMPTY_READER, pages: [original, manual], cards: [card] };
  const first = mergeDailySnapshot(initial, { version: 1, pages: [page()] }, report);
  const unchanged = mergeDailySnapshot(first, { version: 1, pages: [page()] }, report);
  assert.equal(unchanged.pages.length, 2); assert.equal(unchanged.cards[0].status, "accepted"); assert.equal(unchanged.pages[0].id, original.id);
  const changed = mergeDailySnapshot(unchanged, { version: 1, pages: [{ ...page(), text: page().text + " The instructions changed." }] }, report);
  assert.equal(changed.cards[0].status, "stale");
  const evicted = mergeDailySnapshot(changed, { version: 1, pages: [] }, report);
  assert.deepEqual(evicted.pages, [manual]); assert.equal(evicted.cards.length, 0);
});
test("unread sources stay unverified; malformed reports cannot create external links", () => {
  const checked = validateSyncReport({ ...report, unread: [{ url: "javascript:alert(1)", title: "bad", reason: "bad" }] });
  assert.deepEqual(checked.unread, []);
  assert.throws(() => validateSyncReport({ ...report, status: "all-submitted" }));
  const p = page(); const c = { sourceUrl: p.url, sourceId: p.id, status: "accepted" } as ReaderCard;
  const next = mergeDailySnapshot({ ...EMPTY_READER, pages: [p], cards: [c] }, { version: 1, pages: [p] }, { ...report, status: "partial", unread: [{ url: p.url, title: "Source", reason: "Access unavailable" }] });
  assert.equal(next.cards[0].status, "stale");
});
test("incremental reading ignores timestamp-only changes and automatic AI skips successful text versions", async () => {
  assert.equal(putSnapshot([page()], { ...page(), capturedAt: "2026-01-02T12:00:00Z" }).changed, false);
  const pages = Array.from({ length: 8 }, (_, i) => page(String(i)));
  const pairs = await Promise.all(pages.map(async p => [p.id, await excerptFingerprint(p.url, p.text)] as const));
  const hashes = new Map(pairs), completed = new Set([pairs[0][1]]);
  const batch = autoBatch(pages, completed, hashes);
  assert.equal(batch.length, 5); assert.equal(batch.some(p => p.id === pages[0].id), false);
  assert.notEqual(await excerptFingerprint(page().url, page().text), await excerptFingerprint(page().url, page().text + " Changed."));
});
