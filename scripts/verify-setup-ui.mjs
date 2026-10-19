// Synthetic account/directory fixtures only; no real school login or AI calls.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { DISTRICTS } = await import('../extensions/course-reader/districts.js');
if (!process.argv.includes('--run')) throw new Error('Pass --run; start Relay on localhost:3002 first.');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const user = { id: 'setup-fixture', email: 'synthetic-setup@example.invalid', name: 'Synthetic student' };
let selected = null, rev = 0, stopped = 0, aiCalls = 0;
const profile = () => ({ user, district: selected, scope: selected ? 'a'.repeat(32) : null, binding: String(rev + 1).repeat(64), dataKey: selected ? 'c'.repeat(64) : null, googleEnabled: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('https://relay.aaronluo.com/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/api/student/profile') {
      if (req.method() === 'POST') { const b = req.postDataJSON(); assert.equal(b.binding, profile().binding); selected = DISTRICTS.find(d => d.id === b.districtId); rev++; return route.fulfill({ json: { ok: true } }); }
      if (req.method() === 'DELETE') { assert.equal(req.headers()['x-relay-student-binding'], profile().binding); selected = null; rev++; stopped++; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: profile() });
    }
    if (url.pathname === '/api/student/schools') return route.fulfill({ json: { limited: false, schools: [{ id: 'nces-062805013062', ncesId: '062805013062', name: 'SYNTHETIC Fremont High', city: 'Oakland, CA', website: '', portal: null, districtId: null }] } });
    if (url.pathname === '/api/student/analyze') { if (req.method() === 'POST') aiCalls++; return route.fulfill({ json: { identity: profile().binding, authenticated: true, email: user.email, configured: true, provider: 'fixture.invalid', model: 'synthetic', remaining: 12, dailyLimit: 12 } }); }
    if (url.pathname === '/api/student/dashboard') return route.fulfill({ json: { items: [], sources: [], fetchedAt: new Date().toISOString(), schoologyProfile: null } });
    const response = await route.fetch({ url: 'http://localhost:3002' + url.pathname + url.search }); return route.fulfill({ response });
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => void d.accept());
  await page.goto('https://relay.aaronluo.com');
  await page.getByLabel('Find your school').fill('Palo Alto');
  await page.getByRole('button', { name: /Palo Alto High School.*Choose/ }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Setup & connections', exact: true }).click();
  assert.equal(await page.locator('[data-setup-step]').count(), 1);
  await page.locator('.sg-help > summary').click();
  assert.equal(await page.getByRole('link', { name: /Palo Alto High School/ }).getAttribute('href'), 'https://www.paly.net');
  assert.equal(await page.getByRole('link', { name: 'Open PAUSD Schoology', exact: false }).getAttribute('href'), 'https://pausd.schoology.com');
  await page.locator('.sg-help > summary').click();
  assert.equal(await page.getByRole('checkbox', { name: 'Automatically analyze new or changed excerpts', exact: false }).count(), 0);
  assert.equal(await page.locator('.sg-wizard-actions').getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true);
  if (process.env.READER_SCREENSHOTS) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(process.env.READER_SCREENSHOTS, 'guided-setup-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(process.env.READER_SCREENSHOTS, 'guided-setup-mobile.png'), fullPage: true });
  }
  await page.getByRole('checkbox', { name: 'Automatically import daily snapshots', exact: false }).check();
  await page.locator('.sg-wizard-actions').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Get the Chrome extension.', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sg-setup-title');
  assert.equal(await page.locator('[data-setup-step]').count(), 1);
  assert.equal(await page.getByRole('checkbox').count(), 0);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download extension', exact: false }).click(); await download;
  await page.getByRole('heading', { name: 'Open Chrome’s extension page.', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Chrome page is open', exact: false }).click();
  await page.getByRole('heading', { name: 'Load the extension folder.', exact: true }).waitFor();
  assert.equal(await page.locator('[data-setup-step]').count(), 1);
  assert.equal(await page.locator('.sg-wizard-actions').getByRole('button', { name: 'Continue', exact: true }).count(), 0, 'Cannot claim installation without detection/pairing');
  await page.reload(); await page.locator('[data-setup-step="2"]').waitFor();
  await page.locator('.sg-wizard-actions').getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: 'Automatically import daily snapshots', exact: false }).isChecked(), true);
  assert.equal(aiCalls, 0, 'Tutorial navigation never grants AI consent');
  await page.getByRole('navigation').getByRole('button', { name: 'Assignments', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'assignments');
  await page.getByRole('navigation').getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.goBack();
  await page.locator('.rs-page-heading h1').filter({ hasText: 'Assignments' }).waitFor();
  assert.equal(await page.locator('.rs-page-heading h1').evaluate(el => document.activeElement === el), true);
  await page.reload();
  await page.locator('.rs-page-heading h1').filter({ hasText: 'Assignments' }).waitFor();
  await page.locator('.sa-account-strip').getByRole('button', { name: 'Change school' }).click();
  await page.getByLabel('Find your school').fill('Fremont');
  await page.getByRole('button', { name: 'Search NCES for this name or city' }).click();
  await page.getByRole('button', { name: /SYNTHETIC Fremont High.*Choose/ }).click();
  await page.locator('.sg-unsupported').waitFor();
  assert.equal(stopped, 1); assert.equal(selected, null);
  assert.equal(await page.locator('.rs-app').count(), 0);
  assert.ok((await page.locator('.sg-unsupported').innerText()).includes('does not supply school website'));
  assert.equal(await page.locator('.sg-unsupported a').getAttribute('href'), 'https://nces.ed.gov/ccd/schoolsearch/school_detail.asp?ID=062805013062');
  await page.locator('.sg-other summary').click();
  await page.getByLabel('School website', { exact: true }).fill('https://other-school.edu');
  await page.getByLabel('Course portal · optional').fill('https://other-school.instructure.com');
  await page.getByRole('button', { name: 'Save school links' }).click();
  await page.locator('.sg-unsupported a').filter({ hasText: 'Open course portal' }).waitFor();
  assert.equal(await page.locator('.sg-unsupported a').filter({ hasText: 'Open course portal' }).getAttribute('href'), 'https://other-school.instructure.com/');
  assert.equal(aiCalls, 0); assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (process.env.READER_SCREENSHOTS) await page.screenshot({ path: join(process.env.READER_SCREENSHOTS, 'school-directory-mobile.png'), fullPage: true });
  console.log('PASS: exactly one setup step at a time, gated progression, staged installation, keyboard focus, reload/back navigation without lost consent, school selection/links, unsupported portal reset, and mobile layout. Synthetic fixtures only.');
} finally { await browser.close(); }
