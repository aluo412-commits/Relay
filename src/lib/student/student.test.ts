import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCalendarUrl, parseSchoologyCalendar } from "./schoology";
import { parseDistrict, plainText } from "./district";
import { seal, unseal, sameOrigin, limitedText } from "./security";
import { dayKey, offsetDay } from "./types";

const calendar = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`;
const event = (body: string) => `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT`;

test("Schoology URLs fail closed: no .org, credentials, ports, subdomain tricks or local hosts", () => {
  assert.equal(validateCalendarUrl("webcal://fuhsd.schoology.com/calendar/feed/ical/private").protocol, "https:");
  for (const url of ["https://fuhsd.schoology.org/calendar", "http://fuhsd.schoology.com/calendar", "https://fuhsd.schoology.com.evil.test/a", "https://localhost/a", "https://169.254.169.254/a", "https://fuhsd.schoology.com:8080/a", "https://secret@fuhsd.schoology.com/a", "file:///etc/passwd"]) {
    assert.throws(() => validateCalendarUrl(url));
  }
});
test("iCal preserves date-only deadlines and correctly converts Pacific DST", () => {
  const { items } = parseSchoologyCalendar(calendar([
    event("UID:summer\r\nSUMMARY:Example assignment\r\nDTSTART;TZID=America/Los_Angeles:20261002T235900\r\nURL:https://fuhsd.schoology.com/assignment/123"),
    event("UID:winter\r\nSUMMARY:Winter meeting\r\nDTSTART;TZID=America/Los_Angeles:20261202T160000"),
    event("UID:holiday\r\nSUMMARY:No school\r\nDTSTART;VALUE=DATE:20261012"),
  ].join("\r\n")));
  assert.equal(items[0].date, "2026-10-03T06:59:00.000Z");
  assert.equal(items[0].kind, "assignment");
  assert.equal(items[1].date, "2026-12-03T00:00:00.000Z");
  assert.equal(items[1].kind, "event");
  assert.equal(items[2].date, "2026-10-12");
  assert.equal(items[2].allDay, true);
});
test("iCal unfolds lines, deduplicates UIDs, handles cancellation and rejects login HTML", () => {
  const { items } = parseSchoologyCalendar(calendar([
    event("UID:one\r\nSUMMARY:Old title\r\nDTSTART:20261002T180000Z"),
    event("UID:one\r\nSUMMARY:Long title that\r\n continues\r\nDESCRIPTION:Line 1\\nLine 2\\, details\r\nDTSTART:20261002T180000Z"),
    event("UID:cancelled\r\nSUMMARY:Canceled\r\nDTSTART:20261002T180000Z"),
    event("UID:cancelled\r\nSTATUS:CANCELLED"),
  ].join("\r\n")));
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Long title thatcontinues");
  assert.equal(items[0].description, "Line 1\nLine 2, details");
  assert.throws(() => parseSchoologyCalendar("<html>Login</html>"), /login page/);
});
test("unknown timezone, invalid dates and unsupported recurrence never invent dates", () => {
  const parsed = parseSchoologyCalendar(calendar([
    event("UID:bad\r\nSUMMARY:Unknown date\r\nDTSTART;TZID=Not_A_Zone:20261002T180000"),
    event("UID:invalid\r\nSUMMARY:Invalid date\r\nDTSTART:20260230T120000Z"),
    event("UID:weekly\r\nSUMMARY:Weekly event\r\nDTSTART:20261002T180000Z\r\nRRULE:FREQ=WEEKLY\r\nURL:javascript:alert(1)"),
  ].join("\r\n")));
  assert.equal(parsed.items[0].date, null);
  assert.equal(parsed.items[1].date, null);
  assert.equal(parsed.warnings.length, 2);
  assert.equal(parsed.items[2].url, "https://fuhsd.schoology.com/calendar");
});
test("district adapter extracts official article records, not navigation or synthetic dates", () => {
  const news = parseDistrict('<section class="fsPostElement"><article data-post-id="123"><div class="fsTitle"><a data-slug="district/post/test">School &amp; community</a></div></article></section>', "news");
  assert.equal(news[0].title, "School & community");
  assert.equal(news[0].date, null);
  assert.equal(news[0].url, "https://www.fuhsd.org/newsroom/~board/district/post/test");
  const events = parseDistrict('<section class="fsCalendar"><article><time datetime="2026-10-12T00:00:00-07:00"></time><a class="fsCalendarEventLink" data-occur-id="45">No classes</a><div class="fsAllDay">All day</div></article></section>', "calendar");
  assert.equal(events[0].date, "2026-10-12");
  assert.equal(events[0].allDay, true);
  assert.throws(() => parseDistrict("Login or unexpected page", "news"), /format changed/);
  assert.equal(plainText('<script>alert(1)</script><b>Title</b> &#38; &#x27;'), "Title & '");
});
test("credentials are encrypted, tamper-evident, purpose-bound and expiring", () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-only-private-secret-32-characters-long";
  try {
    const secret = { url: "https://fuhsd.schoology.com/calendar/private-token" };
    const encrypted = seal(secret, "schoology");
    assert.ok(!encrypted.includes("private-token"));
    assert.deepEqual(unseal(encrypted, "schoology"), secret);
    assert.equal(unseal(encrypted, "gmail"), null);
    const tampered = Buffer.from(encrypted, "base64url"); tampered[30] ^= 1;
    assert.equal(unseal(tampered.toString("base64url"), "schoology"), null);
    assert.equal(unseal(seal(secret, "schoology", -1), "schoology"), null);
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});
test("connection mutations require the same origin and source payloads are bounded", async () => {
  assert.equal(sameOrigin(new Request("https://relay.aaronluo.com/api/student/schoology", { headers: { origin: "https://evil.example" } })), false);
  assert.equal(sameOrigin(new Request("https://relay.aaronluo.com/api/student/schoology", { headers: { origin: "https://relay.aaronluo.com" } })), true);
  assert.equal(await limitedText(new Response("hello"), 10), "hello");
  await assert.rejects(limitedText(new Response("too long"), 2), /size limit/);
});
test("school dates are Pacific, not UTC, and date-only values never shift", () => {
  assert.equal(dayKey("2026-10-03T01:00:00Z"), "2026-10-02");
  assert.equal(dayKey("2026-10-03"), "2026-10-03");
  assert.equal(offsetDay("2026-12-31", 1), "2027-01-01");
});
