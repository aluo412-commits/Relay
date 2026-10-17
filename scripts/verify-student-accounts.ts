// Explicit real HTTP/database checks using temporary synthetic accounts only.
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
async function main() {
  if (!process.argv.includes("--run")) throw new Error("Pass --run to create/delete two temporary accounts. No school credentials or model calls are used.");
  createRequire(`${process.cwd()}/package.json`)("@next/env").loadEnvConfig(process.cwd());
  const { prisma } = await import("../src/lib/db");
  const { seal, SCHOOL_COOKIE, GMAIL_COOKIE, OAUTH_COOKIE } = await import("../src/lib/student/security");
  const origin = process.argv.includes("--production") ? "https://relay.aaronluo.com" : "http://localhost:3002";
  const emails = [0, 1].map(i => `student-isolation-${i}-${randomUUID()}@example.invalid`);
  const password = randomUUID();
  async function request(path: string, cookie = "", binding = "", body?: unknown, extraCookie = "") {
    return fetch(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: [cookie, extraCookie].filter(Boolean).join("; "), "X-Relay-Student-Binding": binding, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  try {
    const cookies: string[] = [], profiles: any[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await request("/api/auth/signup", "", "", { email: emails[i], password, name: `Synthetic account ${i}` });
      assert.equal(r.status, 200);
      cookies.push(r.headers.getSetCookie().find(c => c.startsWith("relay_session="))!.split(";")[0]);
      const setup = await (await request("/api/student/profile", cookies[i])).json();
      assert.equal(setup.district, null);
      assert.equal((await request("/api/student/profile", cookies[i], "", { districtId: i ? "pausd" : "fuhsd", binding: setup.binding })).status, 200);
      profiles.push(await (await request("/api/student/profile", cookies[i])).json());
    }
    const [a, b] = profiles;
    assert.notEqual(a.scope, b.scope); assert.notEqual(a.dataKey, b.dataKey); assert.notEqual(a.binding, b.binding);
    assert.equal((await request("/api/student/dashboard")).status, 401);
    assert.equal((await request("/api/student/dashboard", cookies[1], a.binding)).status, 409);
    assert.equal((await request("/api/student/analyze", cookies[1], a.binding, { consent: true })).status, 409);
    assert.equal((await request("/api/student/profile", cookies[1], "", { districtId: "fuhsd", binding: a.binding })).status, 409);
    const disguised = await (await request(`/api/student/profile?userId=${a.user.id}&scope=${a.scope}`, cookies[1])).json();
    assert.equal(disguised.user.id, b.user.id); assert.equal(disguised.dataKey, b.dataKey);
    const revision = (await prisma.studentProfile.findUniqueOrThrow({ where: { userId: a.user.id } })).revision;
    const foreign = `${SCHOOL_COOKIE}_${a.scope}=${seal({ url: "https://fuhsd.schoology.com/SYNTHETIC-DO-NOT-FETCH" }, `${SCHOOL_COOKIE}:${a.scope}:${revision}`)}; ${GMAIL_COOKIE}_${a.scope}=${seal({ email: emails[0], accessToken: "SYNTHETIC-NOT-A-TOKEN", expires: Date.now() + 3600000 }, `${GMAIL_COOKIE}:${a.scope}:${revision}`)}`;
    const dashboard = await (await request("/api/student/dashboard", cookies[1], b.binding, undefined, foreign)).json();
    assert.equal(dashboard.items.length, 0);
    assert.equal(dashboard.sources.find((s: any) => s.id === "schoology").status, "disconnected");
    assert.equal(dashboard.sources.find((s: any) => s.id === "gmail").status, "disconnected");
    assert.equal(dashboard.sources.find((s: any) => s.id === "district").status, "setup_required");
    const pendingState = `study_${randomUUID().replaceAll("-", "")}`;
    const foreignOauth = seal({ state: pendingState, verifier: "synthetic-verifier", binding: a.binding }, OAUTH_COOKIE, 600);
    const callback = await fetch(`${origin}/api/auth/google/callback?state=${pendingState}&code=synthetic-do-not-redeem`, { redirect: "manual", headers: { Cookie: `${cookies[1]}; ${OAUTH_COOKIE}=${foreignOauth}` } });
    assert.ok(callback.headers.get("location")?.includes("connection=gmail_state"), "An OAuth callback for another account must fail before token exchange");
    assert.ok(!callback.headers.getSetCookie().some(c => c.startsWith(GMAIL_COOKIE)));
    assert.equal((await request("/api/student/schoology", cookies[1], b.binding, { url: "https://fuhsd.schoology.com/calendar/feed" })).status, 400);
    const capture = { version: 1, pages: [{ id: "fixture", url: "https://fuhsd.schoology.com/assignment/123", title: "Synthetic", text: "Synthetic instructions only. Read chapter three before the next class.", capturedAt: new Date().toISOString(), warnings: [], links: [] }] };
    assert.equal((await request("/api/student/analyze", cookies[1], b.binding, { capture, consent: true })).status, 400);
    assert.equal(await prisma.readerAiBudget.count({ where: { userId: { in: [a.user.id, b.user.id] } } }), 0);
    assert.equal((await request("/api/student/profile", cookies[0], "", { districtId: "pausd", binding: a.binding })).status, 200);
    const moved = await (await request("/api/student/profile", cookies[0])).json();
    assert.notEqual(moved.scope, a.scope); assert.notEqual(moved.binding, a.binding);
    assert.equal((await request("/api/student/dashboard", cookies[0], a.binding)).status, 409);
    assert.equal((await request("/api/student/profile", cookies[0], "", { districtId: "fuhsd", binding: moved.binding })).status, 200);
    const back = await (await request("/api/student/profile", cookies[0])).json();
    assert.equal(back.scope, a.scope); assert.equal(back.dataKey, a.dataKey); assert.notEqual(back.binding, a.binding);
    const stop = (cookie: string, binding: string) => fetch(origin + "/api/student/profile", { method: "DELETE", headers: { Origin: origin, Cookie: cookie, "X-Relay-Student-Binding": binding } });
    assert.equal((await stop(cookies[0], b.binding)).status, 409);
    assert.equal((await stop(cookies[0], back.binding)).status, 200);
    const unsupported = await (await request("/api/student/profile", cookies[0])).json();
    assert.equal(unsupported.scope, null); assert.equal(unsupported.dataKey, null);
    assert.equal((await request("/api/student/dashboard", cookies[0], back.binding)).status, 409);
    assert.equal((await request("/api/student/profile", cookies[0], "", { districtId: "fuhsd", binding: unsupported.binding })).status, 200);
    const restored = await (await request("/api/student/profile", cookies[0])).json();
    assert.equal(restored.scope, a.scope); assert.equal(restored.dataKey, a.dataKey); assert.notEqual(restored.binding, back.binding);
    assert.equal((await request("/api/student/schools?q=Palo+Alto")).status, 401);
    assert.equal((await request("/api/student/schools?q=%25", cookies[0])).status, 400);
    if (process.argv.includes("--directory")) {
      const lookup = await request("/api/student/schools?q=Fremont+High&state=CA", cookies[0]);
      assert.equal(lookup.status, 200); const directory = await lookup.json();
      assert.ok(directory.schools.some((s: any) => s.id === "fremont-high"));
      assert.ok(directory.schools.some((s: any) => s.id.startsWith("nces-") && s.districtId === null && s.website === ""));
      console.log("PASS: real NCES public-directory lookup, supported campus mapping, and explicit unavailable reader/website fields for other schools.");
    }
    const csrf = await fetch(origin + "/api/auth/logout", { method: "POST", headers: { Origin: "https://untrusted.example", Cookie: cookies[0] } });
    assert.equal(csrf.status, 403);
    if (process.argv.includes("--browser")) {
      const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
      const dir = mkdtempSync(join(tmpdir(), "relay-native-account-")); let context;
      try {
        writeFileSync(join(dir, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Synthetic account cookie probe", version: "1.0", host_permissions: [origin + "/*"], background: { service_worker: "background.js" } }));
        writeFileSync(join(dir, "background.js"), "chrome.runtime.onInstalled.addListener(() => {});");
        context = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging"] });
        const cdp = await context.browser().newBrowserCDPSession(); await cdp.send("Extensions.loadUnpacked", { path: dir });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
        for (let i = 0; i < 2; i++) {
          await context.addCookies([{ name: "relay_session", value: cookies[i].slice("relay_session=".length), domain: new URL(origin).hostname, path: "/", secure: origin.startsWith("https:"), httpOnly: true, sameSite: "Lax" }]);
          const identity = await worker.evaluate(async (url: string) => { const r = await fetch(url + "/api/student/profile", { credentials: "include", cache: "no-store" }); const p = await r.json(); return { uid: p.user?.id, scope: p.scope }; }, origin);
          assert.equal(identity.uid, profiles[i].user.id);
        }
        await context.clearCookies();
        assert.equal(await worker.evaluate(async (url: string) => (await (await fetch(url + "/api/student/profile", { credentials: "include", cache: "no-store" })).json()).user, origin), null);
        console.log("PASS: actual extension-origin fetch uses the active HttpOnly/SameSite Relay session and detects account switches/sign-out; no cookies API or mocked account endpoint.");
      } finally { await context?.close(); rmSync(dir, { recursive: true, force: true }); }
    }
    console.log("PASS: signup, district selection, account-bound API/connector isolation, stale-binding rejection, PAUSD no-FUHSD-data fallback, and stable per-account/district encryption keys. No AI/provider requests made.");
  } finally { await prisma.user.deleteMany({ where: { email: { in: emails } } }); await prisma.$disconnect(); console.log("Temporary accounts and profile metadata removed."); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
