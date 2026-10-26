import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentChoices, changeSession, clonePrefs, clock, generatePlan, minutes, pacificMinute, planSourceWarnings, recommendedTaskIds, validateInput, validatePlan, validatePlannerStore, type PlanInput, type PlanTask } from './afterSchool';
import type { ReaderCard } from './reader';
const now = new Date('2026-10-26T21:00:00Z'); // 14:00 Pacific, Monday
const task = (id: string, n = 60, due: string | null = '2026-10-27'): PlanTask => ({ id, title: `Task ${id}`, minutes: n, priority: 2, difficulty: 2, due, origin: 'personal' });
function input(tasks = [task('a'), task('b')]): PlanInput { return { date: '2026-10-26', prefs: clonePrefs(), tasks, commitmentsConfirmed: true }; }
const duration = (b: { start: number; end: number }) => b.end - b.start;
test('planner uses real available gaps, protects dinner and free time, and does not edit deadlines', () => {
  const i = input([task('a', 180)]); i.prefs.commitments.push({ id: 'dinner', title: 'Dinner', start: '18:30', end: '19:00', days: [1] });
  const copy = JSON.stringify(i), p = generatePlan(i, now);
  assert.equal(JSON.stringify(i), copy); assert.equal(p.unplaced.length, 0);
  assert.equal(p.blocks.filter(b => b.kind === 'study').reduce((n, b) => n + duration(b), 0), 180);
  assert.ok(p.blocks.some(b => b.kind === 'break')); assert.ok(p.blocks.some(b => b.id === 'fixed-dinner'));
  assert.equal(p.blocks.at(-1)?.end, minutes('21:30'));
  for (let n = 1; n < p.blocks.length; n++) assert.ok(p.blocks[n].start >= p.blocks[n - 1].end);
  assert.equal(p.input.tasks[0].due, '2026-10-27');
});
test('capacity overflow stays explicit without extending finish or daily budget', () => {
  const i = input([task('a', 240), task('b', 240)]); i.prefs.maximum = 75;
  const p = generatePlan(i, now); const allocated = p.blocks.filter(b => b.kind === 'study').reduce((n, b) => n + duration(b), 0);
  assert.equal(allocated, 75); assert.equal(p.unplaced.reduce((n, u) => n + u.minutes, 0), 405); assert.ok(p.warnings.some(w => w.includes('did not fit')));
});
test('today never schedules new study in the past; late evenings do not roll into tomorrow', () => {
  const p = generatePlan(input(), new Date('2026-10-27T01:37:00Z')); // 18:37
  assert.ok(p.blocks.filter(b => b.kind === 'study').every(b => b.start >= minutes('18:40')));
  const late = generatePlan(input(), new Date('2026-10-27T06:45:00Z'));
  assert.equal(late.blocks.filter(b => b.kind === 'study').length, 0); assert.equal(late.unplaced.length, 2);
  assert.throws(() => generatePlan({ ...input(), date: '2026-10-25' }, now), /Older plans/);
});
test('Pacific midnight and DST are date/time operations, not fixed UTC offsets', () => {
  assert.equal(pacificMinute(new Date('2026-11-02T00:30:00Z')), minutes('16:30'));
  assert.equal(pacificMinute(new Date('2026-10-26T00:30:00Z')), minutes('17:30'));
  assert.equal(pacificMinute(new Date('2026-11-02T08:00:00Z')), 0);
  assert.equal(clock(minutes('23:59')), '23:59'); assert.throws(() => minutes('24:00'));
});
test('fixed conflicts and invalid preferences fail instead of silently moving commitments', () => {
  const i = input(); i.prefs.commitments = [{ id: 'practice', title: 'Practice', start: '15:45', end: '16:30', days: [1] }];
  assert.throws(() => generatePlan(i, now), /overlaps/);
  i.prefs.commitments = [{ id: 'late', title: 'Late activity', start: '21:00', end: '22:00', days: [1] }];
  assert.throws(() => generatePlan(i, now), /boundary/);
  i.prefs.commitments = []; i.prefs.hours[1].stop = '14:00'; assert.throws(() => generatePlan(i, now));
  assert.throws(() => validateInput({ ...input(), commitmentsConfirmed: false }));
  assert.throws(() => generatePlan(input([task('a', NaN)]), now));
});
test('weekday routines apply only on selected days; small leftover tasks may finish in short blocks', () => {
  const i = input([task('tiny', 5)]); i.prefs.commitments = [{ id: 'tuesday', title: 'Tuesday only', start: '15:45', end: '18:00', days: [2] }];
  const p = generatePlan(i, now); assert.equal(p.unplaced.length, 0); assert.ok(!p.blocks.some(b => b.title === 'Tuesday only'));
  assert.equal(p.blocks.find(b => b.kind === 'study')?.end! - p.blocks.find(b => b.kind === 'study')?.start!, 5);
});
test('soonest dates beat elective hard/quick ordering; unknown dates do not acquire false urgency', () => {
  const i = input([{ ...task('hard', 60, null), difficulty: 3 }, { ...task('due', 60, '2026-10-26'), difficulty: 1 }]); i.prefs.order = 'hard';
  assert.equal(generatePlan(i, now).blocks.find(b => b.kind === 'study')?.taskId, 'due');
  const unknown = task('unknown', 30, null); assert.deepEqual(recommendedTaskIds([unknown, task('dated')], i.date), ['dated']);
});
test('pins remain fixed; completed sessions remain visible; replanning conserves remaining estimates', () => {
  const i = input([task('a', 100)]), p = generatePlan(i, now), studies = p.blocks.filter(b => b.kind === 'study');
  const at = new Date('2026-10-27T00:00:00Z'); // 17:00
  let edited = changeSession(p, studies[0].id, { done: true }, at);
  edited = changeSession(edited, studies[1].id, { pinned: true }, at);
  const next = generatePlan(i, at, edited);
  assert.deepEqual(next.blocks.find(b => b.id === studies[1].id), edited.blocks.find(b => b.id === studies[1].id));
  assert.ok(next.blocks.find(b => b.id === studies[0].id)?.done);
  assert.equal(next.blocks.filter(b => b.kind === 'study').reduce((n, b) => n + duration(b), 0) + next.unplaced.reduce((n, u) => n + u.minutes, 0), 100);
});
test('past unchecked sessions are not treated as done; stale pinned tasks require explicit unpinning', () => {
  const i = input(), p = generatePlan(i, now), first = p.blocks.find(b => b.kind === 'study')!;
  const next = generatePlan(i, new Date('2026-10-27T02:00:00Z'), p);
  assert.ok(next.warnings.some(w => w.includes('not marked done')));
  const pinned = changeSession(p, first.id, { pinned: true }, now);
  assert.throws(() => generatePlan({ ...i, tasks: [] }, now, pinned), /Unpin/);
  const smaller = { ...i, tasks: i.tasks.map(t => ({ ...t, minutes: 5 })) };
  assert.throws(() => generatePlan(smaller, now, pinned), /exceed a new task estimate/);
});
test('completed work no longer selected stays history, not a revived task', () => {
  const i = input(), p = generatePlan(i, now), first = p.blocks.find(b => b.kind === 'study')!;
  const at = new Date('2026-10-27T01:00:00Z'), completed = changeSession(p, first.id, { done: true }, at);
  const result = generatePlan({ ...i, tasks: [] }, at, completed);
  assert.ok(result.blocks.some(b => b.kind === 'history' && b.done)); assert.equal(result.unplaced.length, 0);
});
test('manual time edits reject collisions, insufficient rest and moves into the past', () => {
  const p = generatePlan(input(), now), first = p.blocks.find(b => b.kind === 'study')!;
  assert.throws(() => changeSession(p, first.id, { start: minutes('15:30') }, now), /overlaps/);
  assert.throws(() => changeSession(p, first.id, { start: minutes('16:00') }, new Date('2026-10-27T01:00:00Z')), /past/);
  assert.throws(() => changeSession(p, first.id, { done: true }, now), /start time/);
  assert.throws(() => changeSession(p, first.id, { pinned: true }, new Date('2026-10-28T01:00:00Z')), /Historical/);
});
const card: ReaderCard = { id: 'reader-' + 'a'.repeat(24), sourceId: 'page-a', sourceUrl: 'https://fuhsd.schoology.com/assignment/1', sourceTitle: 'Assignment', sourceTextHash: 'a'.repeat(64), title: 'Read the chapter', course: 'Science', kind: 'assignment', requirement: 'required', quote: 'Read the chapter before class.', due: '2026-10-27', dueQuote: 'Due October 27, 2026.', status: 'accepted' };
test('only reviewed active assignments become candidates; no closed/done/hidden/draft/event promotion', () => {
  assert.equal(assignmentChoices([card], '2026-10-26').length, 1);
  for (const patch of [{ status: 'draft' }, { status: 'stale' }, { hiddenAt: 'now' }, { doneAt: 'now' }, { sourceTitle: 'Tutorial (Closed)' }, { kind: 'event' }, { due: '2026-10-25' }]) assert.equal(assignmentChoices([{ ...card, ...patch } as ReaderCard], '2026-10-26').length, 0);
  assert.equal(assignmentChoices([card, { ...card, id: 'reader-' + 'b'.repeat(24), doneAt: 'now' }], '2026-10-26').length, 0);
  const optional = assignmentChoices([{ ...card, requirement: 'optional' }], '2026-10-26'); assert.equal(recommendedTaskIds(optional, '2026-10-26').length, 0);
});
test('saved plans report source changes and validators reject malformed storage', () => {
  const tasks = assignmentChoices([card], '2026-10-26'), p = generatePlan(input(tasks), now);
  assert.equal(planSourceWarnings(p, tasks).length, 0);
  assert.equal(planSourceWarnings(p, assignmentChoices([{ ...card, sourceTextHash: 'changed' }], '2026-10-26')).length, 1);
  assert.throws(() => validatePlan({ ...p, unplaced: [{ taskId: 'missing', minutes: 1 }] }));
  assert.throws(() => validatePlannerStore({ version: 1, revision: 1, prefs: null, plans: [p, p] }));
});
test('bounded randomized layouts preserve time, task minutes and all hard constraints', () => {
  let seed = 412; const random = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let run = 0; run < 180; run++) {
    const i = input(Array.from({ length: 1 + random(12) }, (_, n) => ({ ...task(`task-${n}`, 5 + random(48) * 5), priority: 1 + random(3), difficulty: 1 + random(3) })));
    i.prefs.focus = 15 + random(15) * 5; i.prefs.maximum = 15 + random(24) * 15; i.prefs.rest = 5 + random(6) * 5;
    i.prefs.commitments = [{ id: 'dinner', title: 'Dinner', start: '18:30', end: '19:00', days: [1] }];
    const p = generatePlan(i, now); validatePlan(p);
    for (const t of i.tasks) assert.equal(p.blocks.filter(b => b.taskId === t.id).reduce((n, b) => n + duration(b), 0) + (p.unplaced.find(u => u.taskId === t.id)?.minutes || 0), t.minutes);
    assert.ok(p.blocks.filter(b => b.kind === 'study').every(b => b.start >= minutes('16:20') && b.end <= minutes('21:10')));
    const pin = p.blocks.find(b => b.kind === 'study'); if (pin) validatePlan(generatePlan(i, now, changeSession(p, pin.id, { pinned: true }, now)));
  }
});
