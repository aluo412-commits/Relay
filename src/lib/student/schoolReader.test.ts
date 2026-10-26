import test from 'node:test';
import assert from 'node:assert/strict';
import { isLynbrookWorkspace, mergeSchoolPages, schoolPageUrl, validateSchoolCapture } from './schoolReader';
import { validateCapture } from './reader';
const page = { id: 'school-' + 'a'.repeat(24), url: 'https://lhs.fuhsd.org/about-us/news', title: 'Synthetic campus news', text: 'SYNTHETIC public school bulletin, not a personal assignment.', capturedAt: '2026-01-01T12:00:00Z', warnings: [], links: [] };
const capture = { version: 1, kind: 'school', pages: [page] };
test('public school URLs fail closed and do not enter the course / AI capture validator', () => {
  assert.equal(schoolPageUrl(page.url + '#news'), page.url);
  for (const url of ['http://lhs.fuhsd.org/', 'https://lhs.fuhsd.org.evil.com/', 'https://lhs.fuhsd.org:8443/', 'https://user:secret@lhs.fuhsd.org/', 'https://lhs.fuhsd.org/login', 'https://lhs.fuhsd.org/%70rivate/a', 'https://lhs.fuhsd.org/news?token=secret', 'https://lhs.fuhsd.org/a.pdf', 'https://gunn.pausd.org/']) assert.equal(schoolPageUrl(url), null, url);
  assert.equal(validateSchoolCapture(capture).pages.length, 1);
  assert.throws(() => validateCapture(capture));
  assert.throws(() => validateCapture({ version: 1, pages: [page] }));
  assert.throws(() => validateSchoolCapture({ ...capture, pages: [{ ...page, url: 'https://fuhsd.schoology.com/assignment/1' }] }));
});
test('Lynbrook reading follows the selected campus, not only the district', () => {
  const account = { district: { id: 'fuhsd' }, school: { id: 'lynbrook-high', website: 'https://lhs.fuhsd.org' } };
  assert.equal(isLynbrookWorkspace(account), true);
  assert.equal(isLynbrookWorkspace({ ...account, district: { id: 'pausd' } }), false);
  assert.equal(isLynbrookWorkspace({ ...account, school: { ...account.school, id: 'homestead-high' } }), false);
  assert.equal(isLynbrookWorkspace({ district: { id: 'fuhsd' } }), false);
});
test('school imports are bounded, separate snapshots and reject old replacements', () => {
  const valid = validateSchoolCapture(capture);
  const next = mergeSchoolPages(valid.pages, { ...valid, pages: [{ ...page, capturedAt: '2026-01-02T12:00:00Z', text: page.text + ' Updated.' }] });
  assert.equal(next.length, 1); assert.ok(next[0].text.endsWith('Updated.'));
  assert.deepEqual(mergeSchoolPages(next, valid), next);
  assert.throws(() => validateSchoolCapture({ ...capture, pages: [page, page] }));
  assert.throws(() => validateSchoolCapture({ ...capture, pages: [{ ...page, text: 'x'.repeat(6001) }] }));
  assert.throws(() => validateSchoolCapture({ ...capture, pages: [{ ...page, capturedAt: 'invalid' }] }));
  assert.deepEqual(validateSchoolCapture({ ...capture, pages: [{ ...page, links: [{ url: 'https://lhs.fuhsd.org/news?token=secret', title: 'Do not export' }] }] }).pages[0].links, []);
});
