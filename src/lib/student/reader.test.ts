import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_READER, mergeReaderPages, quoteExists, safeReaderUrl, validateCapture, type ReaderCapture, type ReaderCard } from "./reader";
import { explicitDateInQuote, validateReaderAnalysis } from "./readerAnalysis";

const page = { id: "page-test", url: "https://fuhsd.schoology.com/assignment/123", title: "Synthetic test course", text: "Required homework: complete questions 1 and 2. Due October 6, 2026. Recommended extra practice is optional.", capturedAt: "2026-01-01T12:00:00Z", warnings: [], links: [] };
const capture: ReaderCapture = { version: 1, pages: [page] };
const draft = { sourceId: page.id, title: "Complete questions 1 and 2", course: "Synthetic test course", kind: "assignment", requirement: "required", quote: "Required homework: complete questions 1 and 2.", due: "2026-10-06", dueQuote: "Due October 6, 2026." };

test("reader permits only selected source page types and strips query credentials", () => {
  assert.equal(safeReaderUrl("https://fuhsd.schoology.com/assignment/123?access_token=secret#fragment"), page.url);
  assert.equal(safeReaderUrl("https://fuhsd.schoology.com/course/123/materials?f=456&token=secret"), "https://fuhsd.schoology.com/course/123/materials?f=456");
  assert.equal(safeReaderUrl("https://docs.google.com/presentation/d/abc123/edit?secret=123"), "https://docs.google.com/presentation/d/abc123/edit");
  for (const url of ["https://fuhsd.schoology.org/assignment/123", "https://fuhsd.schoology.com/login", "https://fuhsd.schoology.com/assignment/123/submit", "https://fuhsd.schoology.com/external_tool/123/launch", "https://fuhsd.schoology.com/course/123/grades", "https://docs.google.com/drive/u/0", "https://evil.example/doc", "https://fuhsd.schoology.com.evil.example/assignment/123", "https://user:password@fuhsd.schoology.com/home"]) assert.equal(safeReaderUrl(url), null);
});
test("capture validation bounds content and drops unknown fields and unsafe links", () => {
  const parsed = validateCapture({ ...capture, cookies: "never copy", pages: [{ ...page, cookies: "secret", links: [{ title: "bad", url: "javascript:alert(1)" }] }] });
  assert.equal("cookies" in parsed, false); assert.equal("cookies" in parsed.pages[0], false); assert.deepEqual(parsed.pages[0].links, []);
  assert.throws(() => validateCapture({ version: 1, pages: [{ ...page, text: "x".repeat(6001) }] }));
  assert.throws(() => validateCapture({ version: 1, pages: [page, page] }));
  assert.throws(() => validateCapture({ version: 1, pages: [] }));
  assert.throws(() => validateCapture({ version: 1, pages: [{ ...page, capturedAt: "not-a-date" }] }));
});
test("source evidence must be in captured text, not an unread link or model claim", () => {
  const result = validateReaderAnalysis({ cards: [draft, { ...draft, sourceId: "unknown" }, { ...draft, quote: "An invented task not found in this page" }] }, capture);
  assert.equal(result.cards.length, 1); assert.equal(result.rejected, 2);
  assert.equal(result.cards[0].status, "draft");
  assert.equal(result.cards[0].sourceUrl, page.url);
  assert.equal(result.cards[0].due, "2026-10-06");
  const duplicate = validateReaderAnalysis({ cards: [draft, { ...draft, title: "A different paraphrase of the same instruction" }] }, capture);
  assert.equal(duplicate.cards.length, 1, "the same source evidence must not create duplicate tasks");
  assert.equal(quoteExists("Required\n homework: complete questions", "Required homework: complete questions"), true);
  assert.throws(() => validateReaderAnalysis({ cards: "not an array" }, capture));
});
test("date grounding refuses inferred years, ambiguous numeric dates and wrong days", () => {
  assert.equal(explicitDateInQuote("2026-10-06", "Due October 6, 2026."), true);
  assert.equal(explicitDateInQuote("2026-10-06", "Due Oct. 6th, 2026."), true);
  assert.equal(explicitDateInQuote("2026-10-06", "Due 6 October 2026."), true);
  assert.equal(explicitDateInQuote("2026-10-06", "Due 2026-10-06."), true);
  assert.equal(explicitDateInQuote("2026-10-06", "Due 10/06/2026."), false);
  assert.equal(explicitDateInQuote("2026-10-07", "Due October 6, 2026."), false);
  assert.equal(explicitDateInQuote("2026-10-06", "Due next class."), false);
  assert.equal(explicitDateInQuote("2026-02-30", "Due February 30, 2026."), false);
  const bad = validateReaderAnalysis({ cards: [{ ...draft, due: "2026-10-07" }] }, capture);
  assert.equal(bad.cards[0].due, null); assert.equal(bad.cards[0].dueQuote, null);
});
test("optional work is preserved and AI cards never publish automatically", () => {
  const { cards } = validateReaderAnalysis({ cards: [{ ...draft, title: "Extra practice", requirement: "optional", quote: "Recommended extra practice is optional.", due: null, dueQuote: null }] }, capture);
  assert.equal(cards[0].requirement, "optional"); assert.equal(cards[0].status, "draft");
});
test("recapturing a changed source invalidates old cards without duplicating sources", () => {
  const card = { ...validateReaderAnalysis({ cards: [draft] }, capture).cards[0], status: "accepted" } as ReaderCard;
  const initial = { ...EMPTY_READER, pages: [page], cards: [card] };
  assert.equal(mergeReaderPages(initial, capture).cards[0].status, "accepted");
  const next = mergeReaderPages(initial, { version: 1, pages: [{ ...page, id: "replacement", text: page.text + " Teacher changed this task." }] });
  assert.equal(next.pages.length, 1); assert.equal(next.pages[0].id, page.id);
  assert.equal(next.cards[0].status, "stale");
  assert.throws(() => mergeReaderPages(initial, { version: 1, pages: [{ ...page, url: "https://fuhsd.schoology.com/assignment/456" }] }), /identifier/);
});
test("extension has no cookie/history/webRequest/all-site or persistent Schoology permissions", () => {
  const manifest = JSON.parse(readFileSync("extensions/course-reader/manifest.json", "utf8"));
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://relay.aaronluo.com/*"]);
  assert.equal(manifest.content_scripts, undefined);
  assert.ok(manifest.content_security_policy.extension_pages.includes("script-src 'self'"));
});
