// Actual unpacked-extension integration using a fresh temporary Chrome profile.
// ALL Schoology/Docs pages and AI responses are synthetic fixtures. The test
// manifest pre-grants optional hosts; it does not test Chrome's native consent UI.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/verify-reader-extension.mjs --run
import { createRequire } from "node:module";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
if (!process.argv.includes("--run")) throw new Error("Pass --run to launch a temporary fixture-only Chrome session. Start Relay on localhost:3002 first.");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { DISTRICTS } = await import('../extensions/course-reader/districts.js');
const district = DISTRICTS.find(d => d.id === (process.argv.includes('--pausd') ? 'pausd' : 'fuhsd'));
const SCHOOL = district.schoology;
const accountA = { user: { id: 'fixture-a', name: 'Synthetic A', email: 'synthetic-a@example.invalid' }, district, scope: 'a'.repeat(32), binding: 'a'.repeat(64), dataKey: 'c'.repeat(64), googleEnabled: true };
const accountB = { ...accountA, user: { id: 'fixture-b', name: 'Synthetic B', email: 'synthetic-b@example.invalid' }, scope: 'b'.repeat(32), binding: 'b'.repeat(64), dataKey: 'd'.repeat(64) };
const requestAccount = r => (r.headers().cookie || '').includes('fixture-b') ? accountB : (r.headers().cookie || '').includes('fixture-a') ? accountA : null;
const dir = mkdtempSync(join(tmpdir(), "relay-daily-extension-"));
const ext = join(dir, "extension"); cpSync(resolve("extensions/course-reader"), ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
manifest.host_permissions.push(SCHOOL + '/*', "https://docs.google.com/*");
writeFileSync(join(ext, 'background.js'), `import { ownedGet as fixtureGet } from './owned-storage.js'; globalThis.__fixtureGet = fixtureGet;\n` + readFileSync(join(ext, 'background.js'), 'utf8'));
writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest));
let context;
let schoolIdentity = '424242';
let changed = false, loggedOut = false, aiCalls = 0, holdProfile = false, heldProfile = false, releaseProfile;
const schoolRequests = [], googleRequests = [];
const phrase = "Required homework: read chapter three and complete question one.";
function html(title, body) { return `<title>${title} | Schoology</title><nav id="profile"><a href="/user/${schoolIdentity}">Synthetic current profile</a></nav><main><h1>${title}</h1>${body}<input type="hidden" value="NEVER_CAPTURE_SECRET"><script>/* NEVER_CAPTURE_SCRIPT */</script></main>`; }
try {
  context = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging"] });
  await context.addCookies([{ name: 'relay_session', value: 'fixture-a', domain: 'relay.aaronluo.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  await context.route(SCHOOL + '/**', async route => {
    const request = route.request(); const u = new URL(request.url()); schoolRequests.push({ path: u.pathname + u.search, method: request.method() });
    if (loggedOut) return route.fulfill({ contentType: "text/html", body: html("Sign in", '<input type="password">') });
    let body;
    if (u.pathname === "/courses") body = '<a href="/course/11">SYNTHETIC Science</a><a href="/course/22">SYNTHETIC Math</a><a href="/course/11/members">NEVER FOLLOW roster</a>';
    else if (u.pathname === "/course/11/materials" && !u.search) body = '<p>Course instructions and teaching materials.</p><a href="/assignment/101">Chapter three homework</a><a href="/course/11/materials?f=99">Unit folder</a><a href="/course/11/materials/gp/88">Syllabus PDF wrapper</a><a href="/external_tool/123/launch">External tool</a>';
    else if (u.pathname === "/course/11/materials" && u.search) body = '<p>Nested unit folder contains course practice.</p><a href="/assignment/102">Optional practice</a><a href="/course/11/materials">Back to materials</a>';
    else if (u.pathname === "/course/22/materials") body = '<p>Math course materials and learning instructions.</p><a href="/assignment/202">Math homework</a><a href="https://docs.google.com/presentation/d/SYNTHETIC/edit">Daily slides</a><a href="https://docs.google.com/document/d/REFERENCE_ONLY/edit">Textbook reference</a>';
    else if (u.pathname.includes("/materials/gp/")) body = '<p>Syllabus PDF. The file itself is NOT this page.</p><iframe src="about:blank"></iframe>';
    else if (u.pathname.startsWith("/assignment/")) body = `<p>${phrase}${changed && u.pathname === "/assignment/101" ? " Updated by the synthetic teacher: question two is also required." : ""}</p><div>Submission status: Submitted</div><a href="https://www.turnitin.com/assignment?token=DO_NOT_COPY">Turnitin</a><a href="/assignment/101/submit">NEVER FOLLOW submit</a>`;
    else if (u.pathname.endsWith("/updates")) body = '<p>Course announcement: read the assignment instructions before class.</p>';
    else if (u.pathname === "/grades/grades") body = '<p>My synthetic grades: homework submitted, score not yet available. Submission cannot be inferred from a blank score.</p>';
    else return route.fulfill({ status: 404, body: "fixture path not supported" });
    return route.fulfill({ contentType: "text/html", body: html("SYNTHETIC COURSE FIXTURE", body) });
  });
  await context.route("https://docs.google.com/**", route => { googleRequests.push(route.request().url()); return route.fulfill({ contentType: route.request().url().includes("/export/") ? "text/plain" : "text/html", body: route.request().url().includes("/export/") ? phrase + " Recommended additional practice is optional." : html("SYNTHETIC Slides", "Course slides text is read using the text export.") }); });
  await context.route("https://relay.aaronluo.com/**", async route => {
    const url = new URL(route.request().url());
    const account = requestAccount(route.request());
    if (url.pathname === '/api/student/profile') {
      if (holdProfile && account?.user.id === accountA.user.id) { holdProfile = false; heldProfile = true; await new Promise(resolve => { releaseProfile = resolve; }); }
      return route.fulfill({ json: account || { user: null, googleEnabled: true } }).catch(() => {});
    }
    if (url.pathname.startsWith('/api/student/') && (!account || route.request().headers()['x-relay-student-binding'] !== account.binding)) return route.fulfill({ status: 409, json: { error: 'Account changed' } });
    if (url.pathname === "/api/student/analyze") {
      if (route.request().method() === "GET") return route.fulfill({ json: { identity: account.binding, authenticated: true, email: account.user.email, configured: true, provider: "fixture.invalid", model: "synthetic-test", googleEnabled: true, remaining: 12, dailyLimit: 12 } });
      aiCalls++;
      const body = route.request().postDataJSON(); assert.equal(body.consent, true); assert.equal(body.expectedAiIdentity, "a".repeat(64)); assert.ok(body.capture.pages.length <= 5); assert.ok(body.capture.pages.every(p => p.readDepth !== "description" && !p.url.includes("REFERENCE_ONLY") && !p.url.includes("/grades/grades")));
      const pages = body.capture.pages.filter(p => p.text.includes(phrase));
      return route.fulfill({ json: { cards: pages.map((p, i) => ({ id: "reader-" + String(i + aiCalls * 10).padStart(24, "0"), sourceId: p.id, sourceUrl: p.url, sourceTitle: p.title, sourceTextHash: "a".repeat(64), title: "SYNTHETIC — Read chapter three", course: "Synthetic course", kind: "assignment", requirement: "required", quote: phrase, due: null, dueQuote: null, status: "draft" })), rejected: 0, analyzedAt: new Date().toISOString() } });
    }
    if (url.pathname === "/api/student/dashboard") return route.fulfill({ json: { items: [], sources: [], fetchedAt: new Date().toISOString(), schoologyProfile: null } });
    const response = await route.fetch({ url: "http://localhost:3002" + url.pathname + url.search });
    return route.fulfill({ response });
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const loaded = await cdp.send("Extensions.loadUnpacked", { path: ext });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  // Extension-created tabs can navigate before Playwright attaches its routes.
  // Delay navigation (not the reader) until fixture interception is installed.
  await worker.evaluate(account => {
    // Extension service-worker requests are not consistently intercepted by
    // Playwright context routes. Mock only this account endpoint; real HTTP
    // authorization is covered separately by verify-student-accounts.ts.
    globalThis.__fixtureAccount = account;
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => String(input) === 'https://relay.aaronluo.com/api/student/profile' ? Promise.resolve(new Response(JSON.stringify(globalThis.__fixtureAccount), { headers: { 'content-type': 'application/json' } })) : nativeFetch(input, init);
    // Test manifest pre-grants hosts, so its required grants cannot be revoked.
    // Native optional permission prompts/removal are outside this fixture test.
    chrome.permissions.remove = async () => true;
    const create = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = async options => { const tab = await create({ ...options, url: "about:blank" }); await new Promise(r => setTimeout(r, 700)); return chrome.tabs.update(tab.id, { url: options.url }); };
  }, accountA);
  const getRun = () => worker.evaluate(async () => (await globalThis.__fixtureGet('syncRun')).syncRun);
  async function until(fn, timeout = 100000) { const end = Date.now() + timeout; while (Date.now() < end) { const x = await fn(); if (x) return x; await new Promise(r => setTimeout(r, 500)); } throw new Error("Fixture condition timed out"); }
  const dashboard = await context.newPage();
  dashboard.on("pageerror", e => console.error("Dashboard error:", e.message));
  dashboard.on("requestfailed", r => console.error("Request failed:", new URL(r.url()).pathname, r.failure()?.errorText));
  await dashboard.goto("https://relay.aaronluo.com/?reader=import");
  await dashboard.getByRole("checkbox", { name: "Automatically import daily snapshots", exact: false }).check();
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${loaded.id}/popup.html`);
  popup.on('dialog', d => void d.accept());
  await popup.locator('#pair-account').click();
  await popup.getByText(/Paired$/, { exact: false }).waitFor();
  await popup.locator("#daily-consent").check(); await popup.locator("#google-consent").check(); await popup.locator("#enable-sync").click();
  let run = await until(async () => { const r = await getRun(); return r?.finishedAt ? r : null; });
  if (!run.courses.length) console.error("Fixture sweep:", JSON.stringify(run), schoolRequests, context.pages().map(p=>p.url().split("?")[0]), await worker.evaluate(async () => ({permissions: await chrome.permissions.getAll(), tabs: (await chrome.tabs.query({})).map(t => ({id: t.id, url: (t.url || "").split("?")[0], status: t.status, pending: !!t.pendingUrl}))})));
  assert.equal(run.courses.length, 2); assert.ok(run.read >= 9); assert.equal(run.status, "partial"); assert.ok(run.unreadCount >= 2);
  const snapshots = await worker.evaluate(async () => (await globalThis.__fixtureGet('syncPages')).syncPages);
  assert.ok(snapshots.some(p => p.url.includes("?f=99"))); assert.ok(snapshots.some(p => p.url.includes("docs.google.com")));
  assert.ok(snapshots.every(p => !p.text.includes("NEVER_CAPTURE")));
  const stored = await worker.evaluate(async () => chrome.storage.local.get(null));
  assert.ok(stored.ownedVault?.ciphertext); assert.equal(stored.syncPages, undefined); assert.equal(JSON.stringify(stored).includes(phrase), false);
  assert.ok(snapshots.some(p => p.url.includes("REFERENCE_ONLY") && p.readDepth === "description"));
  assert.equal(googleRequests.some(url => url.includes("REFERENCE_ONLY")), false, "Reference documents must not be downloaded just to classify them");
  assert.equal(schoolRequests.some(r => r.method !== "GET" || /\/submit|\/members|\/external_tool/.test(r.path)), false);
  await dashboard.bringToFront();
  await until(async () => await dashboard.locator(".rr-page").count() >= 9);
  assert.equal(aiCalls, 0, "Reading/importing must not silently authorize AI");
  await dashboard.getByRole("checkbox", { name: "Automatically analyze new or changed excerpts", exact: false }).check();
  await until(() => aiCalls > 0);
  await dashboard.locator(".rr-draft").first().waitFor();
  await dashboard.getByRole("navigation").getByRole("button", { name: "Overview", exact: true }).click();
  await dashboard.getByRole("heading", { name: "What your courses need.", exact: true }).waitFor();
  await dashboard.getByText("Turnitin · Status unknown", { exact: true }).first().waitFor();
  if (process.env.READER_SCREENSHOTS) {
    await dashboard.setViewportSize({ width: 1440, height: 1000 });
    await dashboard.locator('.rr-auto-brief').screenshot({ path: join(process.env.READER_SCREENSHOTS, 'selective-reader-desktop.png') });
    await dashboard.setViewportSize({ width: 390, height: 844 });
    await dashboard.locator('.rr-auto-brief').screenshot({ path: join(process.env.READER_SCREENSHOTS, 'selective-reader-mobile.png') });
    assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await dashboard.setViewportSize({ width: 1280, height: 900 });
  }
  await dashboard.getByRole("navigation").getByRole("button", { name: "Connections", exact: true }).click();
  // Disable recurring AI after checking consent. The rest of this test exercises
  // changes and login failures without additional model-fixture requests.
  await dashboard.getByRole("checkbox", { name: "Automatically analyze new or changed excerpts", exact: false }).uncheck();
  const targetDraft = dashboard.locator(".rr-draft").filter({ has: dashboard.locator(`a[href="${SCHOOL}/assignment/101"]`) });
  await targetDraft.locator(".rr-check input").check();
  await targetDraft.getByRole("button", { name: "Add to my board", exact: true }).click();
  const oldId = run.id; changed = true;
  await popup.locator("#sync-now").click();
  run = await until(async () => { const r = await getRun(); return r?.id !== oldId && r?.finishedAt ? r : null; });
  assert.equal(run.changed, 1, "Only changed text should count as changed, not fresh capture times");
  await until(async () => await dashboard.getByText("Source changed · review again", { exact: true }).count() > 0);
  const before = schoolRequests.length;
  await popup.locator("#pause-sync").click();
  await worker.evaluate(async () => { await chrome.alarms.create("relay-daily-reader", { when: Date.now() + 100 }); });
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(schoolRequests.length, before, "Pause must stop new school reads");
  await dashboard.setViewportSize({ width: 390, height: 844 });
  assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  schoolIdentity = '999999';
  await popup.locator('#enable-sync').click(); await popup.locator('#sync-now').click();
  const switched = await until(async () => { const r = await getRun(); return r?.status === 'login-required' && r.message.includes('school login changed') ? r : null; });
  assert.ok(switched.message.includes('pair Relay again'));
  schoolIdentity = '424242'; loggedOut = true;
  await new Promise(r => setTimeout(r, 1000));
  await popup.locator("#sync-now").click();
  run = await until(async () => { const r = await getRun(); return r?.id !== switched.id && r?.status === "login-required" ? r : null; });
  assert.equal(run.status, "login-required");
  await dashboard.reload(); await dashboard.getByRole("checkbox", { name: "Automatically import daily snapshots", exact: false }).waitFor();
  assert.equal(await dashboard.getByRole("checkbox", { name: "Automatically import daily snapshots", exact: false }).isChecked(), true);
  holdProfile = true; await dashboard.evaluate(() => window.dispatchEvent(new Event('focus')));
  await until(() => heldProfile);
  await worker.evaluate(p => { globalThis.__fixtureAccount = p; }, accountB);
  await context.addCookies([{ name: 'relay_session', value: 'fixture-b', domain: 'relay.aaronluo.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  await dashboard.evaluate(() => window.dispatchEvent(new Event('focus')));
  await dashboard.locator('.sa-account-strip').filter({ hasText: accountB.user.email }).waitFor();
  releaseProfile(); await new Promise(r => setTimeout(r, 300));
  assert.ok((await dashboard.locator('.sa-account-strip').innerText()).includes(accountB.user.email));
  await dashboard.getByRole('checkbox', { name: 'Automatically import daily snapshots', exact: false }).waitFor();
  assert.equal(await dashboard.locator('.rr-page').count(), 0);
  assert.equal(await dashboard.getByRole('checkbox', { name: 'Automatically import daily snapshots', exact: false }).isChecked(), false);
  await dashboard.evaluate(({ scope, binding, pages, report }) => window.postMessage({ type: 'relay.reader.daily', id: 'late-account-a', scope, binding, capture: { version: 1, pages }, report }, location.origin), { scope: accountA.scope, binding: accountA.binding, pages: snapshots, report: run });
  await new Promise(r => setTimeout(r, 400)); assert.equal(await dashboard.locator('.rr-page').count(), 0);
  await popup.reload(); await popup.getByText(/Pairing needed/, { exact: false }).waitFor();
  assert.equal(await popup.locator('#sync-report').innerText(), '');
  await context.addCookies([{ name: 'relay_session', value: 'fixture-a', domain: 'relay.aaronluo.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  await worker.evaluate(p => { globalThis.__fixtureAccount = p; }, accountA);
  await dashboard.reload(); await until(async () => await dashboard.locator('.rr-page').count() >= 9);
  await worker.evaluate(() => { globalThis.__fixtureAccount = { user: null }; });
  await context.clearCookies(); await dashboard.reload(); await dashboard.getByRole('heading', { name: 'Your schoolwork stays yours.' }).waitFor();
  assert.equal(await dashboard.locator('.rr-page').count(), 0);
  if (process.env.READER_SCREENSHOTS) await dashboard.screenshot({ path: join(process.env.READER_SCREENSHOTS, 'student-account-entry.png'), fullPage: true });
  console.log(JSON.stringify({ district: district.id, encryptedExtensionCache: true, differentAccountCannotSeeSources: true, lateAccountCaptureRejected: true, lateAccountProfileRejected: true, accountPreferencesIsolated: true, ownLibraryRestored: true, logoutHidesReader: true, actualUnpackedExtension: true, syntheticSchoolAndAiOnly: true, accountEndpointMocked: true, nativeHostConsentNotTested: true, discoveredCourses: 2, folderTraversal: true, linkedGoogleText: true, unreadFilesReported: true, noSubmissionRequests: true, localAutomaticImport: true, aiRequiresSeparateConsent: true, referenceDescriptionsOnly: true, automaticBriefWithoutDocSelection: true, turnitinStatusNotInferredFromSchoology: true, incrementalChangeCount: 1, staleCardsRemoved: true, pauseStopsReading: true, expiredLoginPauses: true, changedSchoolIdentityPauses: true, mobileOverflow: false, preferencesPersist: true, aiFixtureCalls: aiCalls }, null, 2));
} finally { await context?.close(); rmSync(dir, { recursive: true, force: true }); }
