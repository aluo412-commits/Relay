// Website-only planner regression. All accounts, assignments and API responses are synthetic.
// Start Relay on localhost:3002. No production mutation or actual provider call.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { encryptLocal, decryptLocal } from '../extensions/course-reader/vault.js';
import { DISTRICTS } from '../extensions/course-reader/districts.js';
if (!process.argv.includes('--run')) throw new Error('Pass --run with localhost:3002 running.');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const a = { user: { id: 'planner-a', name: 'Synthetic A', email: 'planner-a@example.invalid' }, district: DISTRICTS[0], scope: 'a'.repeat(32), binding: 'a'.repeat(64), dataKey: 'c'.repeat(64), googleEnabled: false };
const b = { ...a, user: { ...a.user, id: 'planner-b' }, scope: 'b'.repeat(32), binding: 'b'.repeat(64), dataKey: 'd'.repeat(64) };
const tasks = [ ['SYNTHETIC Math review', 'required', 'accepted', '2026-10-27'], ['SYNTHETIC Optional reading', 'optional', 'accepted', '2026-10-27'], ['SYNTHETIC Unknown date', 'required', 'accepted', null], ['SYNTHETIC Unreviewed', 'required', 'draft', '2026-10-27'] ];
const pages = tasks.map((t, i) => ({ id: 'page-' + i, url: `https://fuhsd.schoology.com/assignment/${i + 1}`, title: t[0], text: `${t[0]}: read the assigned chapter before class.`, capturedAt: '2026-10-26T19:00:00Z', links: [], warnings: [] }));
const cards = tasks.map((t, i) => ({ id: 'reader-' + String(i + 1).padStart(24, '0'), sourceId: pages[i].id, sourceUrl: pages[i].url, sourceTitle: pages[i].title, sourceTextHash: 'a'.repeat(64), title: t[0], course: 'Synthetic course', kind: 'assignment', requirement: t[1], quote: pages[i].text, due: t[3], dueQuote: null, status: t[2] }));
const readerState = { version: 1, pages, cards, analyzedAt: null, completionMigrated: true, setupFinished: 'local' };
const readerEncrypted = await encryptLocal(readerState, a.dataKey, a.scope);
let active = a, posts = 0;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext();
try {
  if (process.env.READER_SCREENSHOTS) mkdirSync(process.env.READER_SCREENSHOTS, { recursive: true });
  await context.addInitScript(({ scope, encrypted }) => {
    if (location.origin !== 'https://relay.aaronluo.com') return;
    for (const uid of ['planner-a', 'planner-b']) if (!localStorage.getItem(`relay-school-choice-v1:${uid}`)) localStorage.setItem(`relay-school-choice-v1:${uid}`, JSON.stringify({ id: 'lynbrook-high' }));
    const req = indexedDB.open(`relay-course-reader-owned-v2:${scope}`, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('workspace');
    req.onsuccess = () => { const db = req.result, tx = db.transaction('workspace', 'readwrite'), s = tx.objectStore('workspace'), get = s.get('current'); get.onsuccess = () => { if (!get.result) s.put(encrypted, 'current'); }; tx.oncomplete = () => db.close(); };
  }, { scope: a.scope, encrypted: readerEncrypted });
  await context.route('https://relay.aaronluo.com/**', async route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/student/profile') return route.fulfill({ json: active });
    if (u.pathname === '/api/student/dashboard') return route.fulfill({ json: { items: [], sources: [], fetchedAt: '2026-10-26T21:00:00Z', schoologyProfile: null } });
    if (u.pathname === '/api/student/analyze') {
      if (route.request().method() === 'POST') { posts++; return route.fulfill({ status: 500, json: { error: 'Planner must not call AI' } }); }
      return route.fulfill({ json: { authenticated: true, configured: true, identity: active.binding, email: active.user.email, remaining: 12, dailyLimit: 12, model: 'synthetic', provider: 'fixture.invalid' } });
    }
    if (route.request().method() !== 'GET') { posts++; throw new Error('Unexpected external mutation'); }
    const response = await route.fetch({ url: 'http://localhost:3002' + u.pathname + u.search }); return route.fulfill({ response });
  });
  const errors = [];
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.clock.install({ time: new Date('2026-10-26T21:00:00Z') });
  await page.goto('https://relay.aaronluo.com/?view=planner');
  const ui = page.getByRole('region', { name: 'After-school planner', exact: true });
  await ui.locator('[data-planner-step="1"]').waitFor(); assert.equal(await ui.locator('[data-planner-step]').count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'After school, on your terms.' }).count(), 1);
  for (const width of [375, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); if (process.env.READER_SCREENSHOTS) await page.screenshot({ path: join(process.env.READER_SCREENSHOTS, `after-school-setup-${width}.png`), fullPage: true }); }
  await ui.locator('.ap-pace > summary').click();
  await ui.getByLabel('Maximum study · minutes', { exact: true }).fill('180');
  await ui.getByRole('button', { name: 'Continue', exact: true }).click();
  await ui.locator('[data-planner-step="2"]').waitFor(); assert.equal(await ui.locator('[data-planner-step]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Protect the plans you already have.');
  await ui.getByRole('button', { name: 'Add dinner', exact: true }).click();
  await ui.getByRole('button', { name: 'Add fixed activity', exact: true }).click();
  const activity = ui.locator('.ap-commitment').nth(1);
  await activity.getByLabel('Activity name', { exact: true }).fill('SYNTHETIC Robotics');
  await activity.getByLabel('Starts', { exact: true }).fill('17:30'); await activity.getByLabel('Ends', { exact: true }).fill('18:30');
  await ui.getByRole('button', { name: 'Confirm fixed plans & continue' }).click();
  await ui.locator('[data-planner-step="3"]').waitFor();
  assert.equal(await ui.getByRole('checkbox', { name: 'SYNTHETIC Math review', exact: true }).isChecked(), true);
  assert.equal(await ui.getByRole('checkbox', { name: 'SYNTHETIC Optional reading', exact: true }).isChecked(), false);
  assert.equal(await ui.getByRole('checkbox', { name: 'SYNTHETIC Unknown date', exact: true }).isChecked(), false);
  assert.equal(await ui.getByRole('checkbox', { name: 'SYNTHETIC Unreviewed', exact: true }).count(), 0);
  await ui.getByLabel('Minutes for SYNTHETIC Math review', { exact: true }).fill('90');
  await ui.getByRole('button', { name: 'Add personal task' }).click();
  await ui.getByLabel('Task name', { exact: true }).fill('SYNTHETIC Sketchbook time');
  await ui.getByLabel('Minutes for SYNTHETIC Sketchbook time', { exact: true }).fill('45');
  // Navigate away and return: the unsaved form remains mounted, not reset.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Assignments', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'After school', exact: true }).click();
  assert.equal(await ui.getByLabel('Minutes for SYNTHETIC Math review').inputValue(), '90');
  await ui.getByRole('button', { name: 'Generate evening draft' }).click(); await ui.getByRole('list', { name: 'Evening timeline' }).waitFor();
  assert.ok(await ui.getByText('135m study / 180m limit', { exact: false }).count());
  assert.equal(await ui.locator('.ap-fixed h3').filter({ hasText: 'SYNTHETIC Robotics' }).count(), 1);
  assert.equal(posts, 0);
  const dbKey = `relay-after-school-v1:${a.scope}:lynbrook-high`;
  const readRecord = async (p, dbName, storeName = 'planner') => p.evaluate(({ dbName, storeName }) => new Promise(resolve => { const req = indexedDB.open(dbName); req.onsuccess = () => { const db = req.result; const r = db.transaction(storeName).objectStore(storeName).get('current'); r.onsuccess = () => { db.close(); resolve(r.result); }; }; }), { dbName, storeName });
  assert.equal(await readRecord(page, dbKey), undefined, 'Generating does not save');
  await ui.locator('.ap-study').nth(2).getByLabel('Keep this time').check();
  await ui.getByRole('button', { name: 'Save this plan', exact: true }).click(); await ui.getByText('Plan and routine saved', { exact: false }).waitFor();
  const encrypted = await readRecord(page, dbKey); assert.ok(encrypted.ciphertext); assert.ok(!JSON.stringify(encrypted).includes('SYNTHETIC'));
  let saved = await decryptLocal(encrypted, a.dataKey, `planner:${a.scope}:lynbrook-high`); assert.equal(saved.plans.length, 1);
  const pinned = saved.plans[0].blocks.find(b => b.kind === 'study' && b.pinned);
  await page.reload(); await ui.getByRole('list', { name: 'Evening timeline' }).waitFor(); assert.equal(await ui.locator('[data-planner-step]').count(), 0);
  const other = await context.newPage(); await other.clock.install({ time: new Date('2026-10-26T21:00:00Z') });
  await other.goto('https://relay.aaronluo.com/?view=planner'); const ui2 = other.getByRole('region', { name: 'After-school planner', exact: true }); await ui2.getByRole('list', { name: 'Evening timeline' }).waitFor();
  await page.clock.setFixedTime(new Date('2026-10-27T00:05:00Z'));
  await ui.locator('.ap-study').first().getByLabel('Session done').check();
  assert.equal(await ui.locator('.ap-session-done').count(), 1);
  await ui.getByRole('button', { name: 'Replan remaining from now', exact: true }).click();
  assert.equal(await ui.locator('.ap-session-done').count(), 1);
  await ui.getByRole('button', { name: 'Save this plan', exact: true }).click(); await ui.getByText('Plan and routine saved', { exact: false }).waitFor();
  saved = await decryptLocal(await readRecord(page, dbKey), a.dataKey, `planner:${a.scope}:lynbrook-high`);
  assert.equal(saved.plans[0].blocks.find(b => b.id === pinned.id).start, pinned.start);
  const course = await decryptLocal(await readRecord(page, `relay-course-reader-owned-v2:${a.scope}`, 'workspace'), a.dataKey, a.scope);
  assert.ok(course.cards.every(c => !c.doneAt && c.status === cards.find(x => x.id === c.id).status), 'Planner never marks the source assignments done');
  await ui2.locator('.ap-study').first().getByLabel('Keep this time').check();
  await ui2.getByRole('button', { name: 'Save this plan', exact: true }).click(); await ui2.getByText('Plans changed in another tab.', { exact: false }).waitFor();
  await other.close();
  await ui.getByRole('button', { name: 'Customize', exact: true }).click(); await ui.locator('.ap-pace > summary').click(); await ui.getByLabel('Maximum study · minutes', { exact: true }).fill('90');
  await ui.getByRole('button', { name: 'Continue', exact: true }).click(); await ui.getByRole('button', { name: 'Confirm fixed plans & continue' }).click(); await ui.getByRole('button', { name: 'Generate evening draft' }).click();
  await ui.getByText('45 minutes still need a place', { exact: true }).waitFor();
  const movable = ui.locator('.ap-study:not(.ap-session-done)').first(); await movable.locator('summary').click();
  await movable.getByLabel('New start for SYNTHETIC Math review').fill('18:40'); await movable.getByRole('button', { name: 'Apply time' }).click();
  await ui.getByRole('alert').filter({ hasText: 'overlaps' }).waitFor();
  await ui.getByRole('button', { name: 'Save this plan', exact: true }).click(); await ui.getByText('Plan and routine saved', { exact: false }).waitFor();
  // Reload removes the rejected-edit notice, not the saved checks or overflow.
  await page.reload(); await ui.getByText('45 minutes still need a place', { exact: true }).waitFor(); assert.equal(await ui.locator('.ap-session-done').count(), 1);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px overflow`);
    if (process.env.READER_SCREENSHOTS) { mkdirSync(process.env.READER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.READER_SCREENSHOTS, `after-school-${width}.png`), fullPage: true }); }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A changed source warns, keeps the saved plan, and blocks blind saving.
  const changed = await encryptLocal({ ...readerState, cards: cards.map((c, i) => i ? c : { ...c, sourceTextHash: 'b'.repeat(64) }) }, a.dataKey, a.scope);
  await page.evaluate(({ scope, changed }) => new Promise(resolve => { const r = indexedDB.open(`relay-course-reader-owned-v2:${scope}`); r.onsuccess = () => { const db = r.result, tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put(changed, 'current'); tx.oncomplete = () => { db.close(); resolve(true); }; }; }), { scope: a.scope, changed });
  await page.reload(); await ui.getByText('Source review needed', { exact: true }).waitFor(); assert.equal(await ui.getByRole('button', { name: 'Save this plan', exact: true }).isDisabled(), true);
  await page.evaluate(() => localStorage.setItem('relay-school-choice-v1:planner-a', JSON.stringify({ id: 'homestead-high' })));
  await page.reload(); await ui.locator('[data-planner-step="1"]').waitFor();
  assert.equal(await ui.getByText('SYNTHETIC Sketchbook time', { exact: true }).count(), 0);
  await page.evaluate(() => localStorage.setItem('relay-school-choice-v1:planner-a', JSON.stringify({ id: 'lynbrook-high' })));
  await page.reload(); await ui.getByRole('list', { name: 'Evening timeline' }).waitFor();
  active = b; await page.reload(); await ui.locator('[data-planner-step="1"]').waitFor(); assert.equal(await ui.getByText('SYNTHETIC Sketchbook time', { exact: true }).count(), 0);
  active = a; await page.reload(); await ui.getByRole('list', { name: 'Evening timeline' }).waitFor();
  assert.equal(await ui.locator('.ap-session-done').count(), 1);
  assert.equal(posts, 0); assert.deepEqual(errors, []);
  console.log('PASS: sequential planner customization, reviewed-source filtering, manual estimates, fixed plans, overflow, pin/replan/completion without source mutations, preview-before-save, encryption, reload, cross-tab conflict, account separation, stale-source warnings, keyboard focus and 375–1440px. Synthetic only; no AI or external writes.');
} finally { await context.close(); await browser.close(); }
