// Actual unpacked extension + synthetic public school pages/account only.
// Native activeTab grants are not tested: the temporary manifest grants LHS.
import { createRequire } from 'node:module';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
if (!process.argv.includes('--run')) throw new Error('Pass --run; start Relay on localhost:3002 first.');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { DISTRICTS } = await import('../extensions/course-reader/districts.js');
const { readSchoolPage } = await import('../extensions/course-reader/school-capture.js');
const district = DISTRICTS.find(d => d.id === 'fuhsd');
const a = { user: { id: 'school-fixture-a', name: 'Synthetic A', email: 'synthetic-a@example.invalid' }, district, scope: 'a'.repeat(32), binding: 'a'.repeat(64), dataKey: 'c'.repeat(64), googleEnabled: false };
const b = { ...a, user: { ...a.user, id: 'school-fixture-b' }, scope: 'b'.repeat(32), binding: 'b'.repeat(64), dataKey: 'd'.repeat(64) };
const dir = mkdtempSync(join(tmpdir(), 'relay-school-reader-')), ext = join(dir, 'extension');
cpSync(resolve('extensions/course-reader'), ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json')));
manifest.host_permissions.push('https://lhs.fuhsd.org/*');
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest));
let context, active = a, aiCalls = 0, schoolRequests = 0;
const text = 'SYNTHETIC CAMPUS NOTICE: Students may attend the public arts showcase. This is a school announcement, not personal homework.';
try {
  context = await chromium.launchPersistentContext(join(dir, 'profile'), { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  await context.addInitScript(() => { if (location.origin === 'https://relay.aaronluo.com') for (const id of ['school-fixture-a', 'school-fixture-b']) { const key = `relay-school-choice-v1:${id}`; if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ id: 'lynbrook-high' })); } });
  await context.route('https://lhs.fuhsd.org/**', route => {
    schoolRequests++;
    const u = new URL(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: u.pathname === '/challenge' ? '<title>Just a moment...</title><main><form id="challenge-form">Verify your browser</form></main>' : `<title>SYNTHETIC Lynbrook school news</title><style>.secret{display:none}</style><nav>NEVER_CAPTURE_NAV</nav><main><article><header><h1>Public arts showcase</h1></header><p>${text}</p><p class="secret">NEVER_CAPTURE_HIDDEN</p><form><input value="NEVER_CAPTURE_INPUT"><p>NEVER_CAPTURE_FORM</p></form><script>window.fixtureSecret='NEVER_CAPTURE_SCRIPT';</script><a href="/about-us/calendar">School calendar</a><a href="/private/grades?token=NEVER_COPY">Restricted link</a><a href="https://evil.invalid/">Other site</a><iframe src="about:blank"></iframe></article></main><footer>NEVER_CAPTURE_FOOTER</footer>` });
  });
  await context.route('https://relay.aaronluo.com/**', async route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/student/profile') return route.fulfill({ json: active });
    if (u.pathname === '/api/student/dashboard') return route.fulfill({ json: { items: [], sources: [], fetchedAt: new Date().toISOString(), schoologyProfile: null } });
    if (u.pathname === '/api/student/analyze') {
      if (route.request().method() === 'POST') { aiCalls++; throw new Error('School text must never reach AI'); }
      return route.fulfill({ json: { authenticated: true, identity: active.binding, configured: true, email: active.user.email, remaining: 12, dailyLimit: 12, model: 'synthetic', provider: 'fixture.invalid' } });
    }
    const response = await route.fetch({ url: 'http://localhost:3002' + u.pathname + u.search }); return route.fulfill({ response });
  });
  const cdp = await context.browser().newBrowserCDPSession(), loaded = await cdp.send('Extensions.loadUnpacked', { path: ext });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(account => {
    globalThis.fixtureAccount = account;
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => String(input) === 'https://relay.aaronluo.com/api/student/profile' ? Promise.resolve(new Response(JSON.stringify(globalThis.fixtureAccount), { headers: { 'content-type': 'application/json' } })) : original(input, init);
    chrome.permissions.remove = async () => true;
  }, a);
  const dashboard = await context.newPage(); dashboard.on('pageerror', e => { throw e; });
  await dashboard.goto('https://relay.aaronluo.com/?view=updates');
  await dashboard.waitForFunction(() => document.documentElement.dataset.relaySchoolReaderReady === '1');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${loaded.id}/popup.html`); popup.on('dialog', d => d.accept());
  await popup.locator('#pair-account').click(); await popup.getByText(/Paired$/, { exact: false }).waitFor();
  const school = await context.newPage(); await school.goto('https://lhs.fuhsd.org/about-us/news');
  const read = await popup.evaluate(async binding => {
    const tab = (await chrome.tabs.query({ url: 'https://lhs.fuhsd.org/*' }))[0]; await chrome.tabs.update(tab.id, { active: true });
    return chrome.runtime.sendMessage({ type: 'read-school', binding });
  }, a.binding);
  assert.equal(read.ok, true, read.error); const capture = read.pages[0];
  assert.ok(capture.text.includes(text)); assert.ok(capture.text.includes('Public arts showcase'));
  assert.ok(!JSON.stringify(capture).includes('NEVER_')); assert.equal(capture.links.length, 1);
  assert.ok(capture.warnings.some(w => w.includes('not read')));
  assert.equal(await dashboard.getByText('SYNTHETIC Lynbrook school news', { exact: true }).count(), 0, 'Capture alone does not import');
  await popup.reload(); await popup.waitForFunction(() => document.querySelectorAll('.page').length === 1);
  await popup.locator('.manual').evaluate(el => el.open = true); await popup.locator('#send').click();
  await dashboard.getByRole('heading', { name: 'Review Lynbrook website import' }).waitFor();
  await dashboard.getByRole('button', { name: 'Save selected school snapshots' }).click();
  await dashboard.locator('h3').filter({ hasText: 'SYNTHETIC Lynbrook school news' }).waitFor();
  const requestsBefore = schoolRequests; await dashboard.reload();
  await dashboard.locator('h3').filter({ hasText: 'SYNTHETIC Lynbrook school news' }).waitFor();
  assert.equal(schoolRequests, requestsBefore, 'Website refresh is not a hidden campus crawl');
  assert.equal(aiCalls, 0);
  const encrypted = await dashboard.evaluate(scope => new Promise(resolve => { const req = indexedDB.open(`relay-school-reader-v1:${scope}`, 1); req.onsuccess = () => { const db = req.result; const get = db.transaction('snapshots').objectStore('snapshots').get('current'); get.onsuccess = () => { db.close(); resolve(get.result); }; }; }), a.scope);
  assert.ok(encrypted.ciphertext); assert.ok(!JSON.stringify(encrypted).includes('SYNTHETIC'));
  const stored = await worker.evaluate(() => chrome.storage.local.get(null)); assert.ok(!JSON.stringify(stored).includes(text));
  for (const path of ['/challenge', '/login', '/about-us/news?token=secret']) {
    await school.goto('https://lhs.fuhsd.org' + path); const result = await school.evaluate(readSchoolPage); assert.ok(result.error, path); assert.equal(result.text, undefined);
  }
  await school.goto('https://lhs.fuhsd.org/news');
  await school.setContent(`<title>School listing</title><main><a class="fsPostLink" href="/news/~board/lhs/post/showcase">Synthetic article</a><p>LISTING_NOT_ARTICLE</p></main><dialog open class="fsPostElement"><div class="fsTitle">Synthetic article</div><p>${text}</p></dialog>`);
  const article = await school.evaluate(readSchoolPage);
  assert.equal(article.url, 'https://lhs.fuhsd.org/news/~board/lhs/post/showcase'); assert.equal(article.title, 'Synthetic article'); assert.ok(article.text.includes(text)); assert.ok(!article.text.includes('LISTING_NOT_ARTICLE'));
  await school.evaluate(() => { const a = document.createElement('a'); a.className = 'fsPostLink'; a.href = '/news/~board/other/post/ambiguous'; a.innerText = 'Synthetic article'; document.querySelector('main').append(a); });
  assert.match((await school.evaluate(readSchoolPage)).error, /no article URL was guessed/);
  await dashboard.evaluate(() => localStorage.setItem('relay-school-choice-v1:school-fixture-a', JSON.stringify({ id: 'homestead-high' })));
  await dashboard.reload(); await dashboard.getByRole('heading', { name: 'Around your school.' }).waitFor();
  assert.equal(await dashboard.locator('h3').filter({ hasText: 'SYNTHETIC Lynbrook school news' }).count(), 0);
  await dashboard.evaluate(() => localStorage.setItem('relay-school-choice-v1:school-fixture-a', JSON.stringify({ id: 'lynbrook-high' })));
  await dashboard.reload(); await dashboard.locator('h3').filter({ hasText: 'SYNTHETIC Lynbrook school news' }).waitFor();
  for (const width of [375, 768, 1440]) { await dashboard.setViewportSize({ width, height: 900 }); assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px overflow`); }
  if (process.env.READER_SCREENSHOTS) await dashboard.screenshot({ path: join(process.env.READER_SCREENSHOTS, 'lynbrook-school-snapshots.png'), fullPage: true });
  active = b; await worker.evaluate(account => globalThis.fixtureAccount = account, b); await dashboard.reload();
  await dashboard.waitForFunction(() => document.documentElement.dataset.relaySchoolReaderReady === '1');
  assert.equal(await dashboard.locator('h3').filter({ hasText: 'SYNTHETIC Lynbrook school news' }).count(), 0);
  await dashboard.evaluate(({ capture, a }) => window.postMessage({ type: 'relay.school.capture', id: 'late-a', scope: a.scope, binding: a.binding, payload: { version: 1, kind: 'school', pages: [capture] } }, location.origin), { capture, a });
  await dashboard.waitForTimeout(150); assert.equal(await dashboard.locator('#school-import-title').isVisible(), false);
  const mismatch = await popup.evaluate(binding => chrome.runtime.sendMessage({ type: 'read-school', binding }), a.binding); assert.equal(mismatch.ok, false);
  active = a; await worker.evaluate(account => globalThis.fixtureAccount = account, a); await dashboard.reload();
  await dashboard.locator('h3').filter({ hasText: 'SYNTHETIC Lynbrook school news' }).waitFor();
  dashboard.on('dialog', d => d.accept()); await dashboard.getByRole('button', { name: 'Remove school snapshot SYNTHETIC Lynbrook school news' }).click();
  await dashboard.getByText('No Lynbrook website text imported yet.', { exact: false }).waitFor();
  await dashboard.reload(); await dashboard.waitForFunction(() => document.documentElement.dataset.relaySchoolReaderReady === '1');
  assert.equal(await dashboard.locator('h3').filter({ hasText: 'SYNTHETIC Lynbrook school news' }).count(), 0);
  assert.equal(aiCalls, 0);
  console.log('PASS: actual extension manual school capture/import; hidden/forms/scripts/tokens excluded; verification/login rejected; encrypted separate storage; no AI or crawl; campus/account isolation, late capture rejected, persistence/removal, 375–1440px; Finalsite news dialogs matched to unambiguous source links. Synthetic fixtures; native activeTab UI not tested. Public live DOM checks are separate.');
} finally { await context?.close(); rmSync(dir, { recursive: true, force: true }); }
