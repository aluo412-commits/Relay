// Visual/auth-shell fixtures only. No production API, DB, auth, or school requests.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
if (!process.argv.includes('--run')) throw new Error('Pass --run; start localhost:3002 first.');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const context = await browser.newContext();
  const unexpected = [], errors = []; let submits = 0;
  await context.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/student/profile') return route.fulfill({ json: { user: null, googleEnabled: true } });
    if (path === '/api/auth/login') { submits++; return route.fulfill({ status: 401, json: { error: 'Synthetic test: sign-in failed. Check your Relay email and password.' } }); }
    unexpected.push(path); return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3002');
  await page.getByRole('heading', { name: 'Your schoolwork stays yours.' }).waitFor();
  for (const [width, height] of [[1440,1000],[768,1024],[375,844],[844,390]]) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}x${height}`);
    assert.equal(await page.getByLabel('Email', { exact: true }).getAttribute('autocomplete'), 'email');
    assert.equal(await page.getByLabel('Relay password').getAttribute('autocomplete'), 'current-password');
    if (process.env.READER_SCREENSHOTS) await page.screenshot({ path: join(process.env.READER_SCREENSHOTS, `relay-redesign-login-${width}.png`), fullPage: true });
  }
  await page.getByLabel('Email', { exact: true }).fill('synthetic@example.invalid');
  await page.getByLabel('Relay password').fill('synthetic-not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic test' }).waitFor();
  assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'synthetic@example.invalid');
  assert.equal(await page.getByLabel('Relay password').inputValue(), 'synthetic-not-a-real-password');
  assert.equal(submits, 1);
  await page.getByRole('button', { name: 'New to Relay? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Relay password').getAttribute('autocomplete'), 'new-password');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log('PASS: responsive auth shell at 375/768/844/1440, retained failed-form input, password-manager attributes, signup state, reduced motion; synthetic requests only.');
} finally { await browser.close(); }
