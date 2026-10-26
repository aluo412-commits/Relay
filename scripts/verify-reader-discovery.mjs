// Synthetic structure fixtures. Does not log in to, or request, a real school.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readSyncPage } from '../extensions/course-reader/sync-read.js';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
if (!process.argv.includes('--run')) throw new Error('Pass --run. Synthetic structures only.');
const school = 'https://pausd.schoology.com', source = school + '/course/22/materials/gp/221';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  const requests = []; let mode = 'viewer';
  const html = body => `<html><head><title>Synthetic packet</title></head><body><main id="main-content-wrapper">${body}<p>This is a synthetic resource page; it is not actual student work.</p></main></body></html>`;
  await context.route('**/*', route => {
    const u = new URL(route.request().url()); requests.push(u.href);
    if (u.origin !== school) return route.abort();
    if (u.pathname === '/courses') return route.fulfill({ contentType: 'text/html', body: html('Synthetic school session') });
    if (u.pathname === '/course/22/materials/gp/221') {
      const body = mode === 'partial-viewer' ? '<iframe class="docviewer-iframe" src="/docviewer/221"></iframe><iframe class="docviewer-iframe" src="/docviewer/missing"></iframe>' : mode === 'multiple' ? '<a href="/attachment/a.pdf">A</a><a href="/attachment/b.pdf">B</a>' : mode === 'external-viewer' ? '<iframe class="docviewer-iframe" src="https://evil.invalid/docviewer/221"></iframe>' : mode === 'embedded' ? '<div class="material-row-folder"><span class="folder-title">Closed folder without a navigable link</span></div><iframe title="Homework calendar" src="https://docs.google.com/document/d/SYNTHETIC/preview"></iframe>' : '<iframe class="docviewer-iframe" src="/docviewer/221"></iframe>';
      return route.fulfill({ contentType: 'text/html', body: html(body) });
    }
    if (u.pathname === '/docviewer/221') {
      const downloadLink = mode === 'unsafe-file' ? 'https://evil.invalid/private.pdf?secret=SYNTHETIC' : school + '/attachment/work.pdf?secret=SYNTHETIC_SIGNED_CAPABILITY';
      return route.fulfill({ contentType: 'text/html', body: html(`<script>globalThis.__shouldNeverRun = true; const config = ${JSON.stringify({ custom: JSON.stringify({ downloadLink }) })};</script>`) });
    }
    if (u.pathname === '/attachment/work.pdf') return mode === 'redirect' ? route.fulfill({ status: 302, headers: { location: 'https://evil.invalid/private.pdf' } }) : route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.7\nSYNTHETIC fixture bytes only; full parsing is covered by the unpacked-extension test.' });
    return route.fulfill({ status: 404, body: 'Unexpected fixture URL' });
  });
  await page.goto(school + '/courses');
  await page.evaluate(`globalThis.__readFixture = ${readSyncPage.toString()}`);
  const read = (enabled = true, pin = null) => page.evaluate(args => globalThis.__readFixture(...args), [source, school, enabled, 'Selected homework source', pin]);
  requests.length = 0;
  const off = await read(false); assert.equal(off.pdfFiles.length, 0); assert.equal(requests.length, 1, 'No viewer/file reads without selected-PDF permission');
  requests.length = 0;
  const result = await read(); assert.equal(result.pdfFiles.length, 1); assert.ok(requests.some(u => u.includes('/docviewer/221'))); assert.ok(requests.some(u => u.includes('/attachment/work.pdf')));
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_SIGNED_CAPABILITY'), false, 'Signed capability stays inside source reader');
  assert.equal(await page.evaluate(() => globalThis.__shouldNeverRun), undefined, 'Viewer scripts are parsed as data, never executed');
  for (const test of ['unsafe-file','external-viewer','multiple','partial-viewer','redirect']) {
    mode = test; requests.length = 0; const r = await read();
    assert.equal(r.pdfFiles.length, 0, test); assert.ok(r.attachments.length, test);
    assert.equal(requests.some(u => !u.startsWith(school)), false, `${test}: no external/redirect target fetch`);
    if (test === 'multiple') assert.equal(requests.some(u => u.includes('/attachment/')), false, 'Never guess between multiple files');
  }
  mode = 'viewer'; requests.length = 0; const wrongIdentity = await read(true, 'known-school-identity');
  assert.equal(wrongIdentity.identityChanged, true); assert.equal(requests.length, 1, 'Changed/lost known school identity blocks deeper reads');
  mode = 'embedded'; const embedded = await read(false);
  assert.ok(embedded.links.some(l => l.url.includes('docs.google.com') && l.title === 'Homework calendar'));
  assert.ok(embedded.attachments.some(s => s.includes('folder rows')));
  console.log('PASS: explicit-source-only viewer resolution, JSON data not scripts, signed URL containment, blocked foreign URLs/redirects, ambiguous files not guessed, identity guard, embedded Docs discovery and collapsed-folder gaps. Synthetic only.');
} finally { await browser.close(); }
