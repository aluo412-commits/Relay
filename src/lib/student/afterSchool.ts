import { isDateOnly, safeReaderUrl, type ReaderCard } from './reader';
import { cardTiming, neutralTitle } from './readerDates';
import { groupCards } from './readerActions';
import { dayKey, offsetDay, SCHOOL_TIMEZONE } from './types';

export type Hours = { start: string; stop: string };
export type Commitment = { id: string; title: string; start: string; end: string; days: number[] };
export type PlanPrefs = { hours: Hours[]; commute: number; unwind: number; focus: number; rest: number; minimum: number; maximum: number; reserve: number; order: 'due' | 'hard' | 'quick'; commitments: Commitment[] };
export type PlanTask = { id: string; title: string; minutes: number; priority: number; difficulty: number; due: string | null; origin: 'reader' | 'personal'; sourceUrl?: string; sourceVersion?: string; course?: string; requirement?: 'required' | 'optional' | 'unclear' };
export type PlanInput = { date: string; prefs: PlanPrefs; tasks: PlanTask[]; commitmentsConfirmed: boolean };
export type PlanBlock = { id: string; kind: 'fixed' | 'study' | 'break' | 'free' | 'history'; title: string; start: number; end: number; taskId?: string; pinned?: boolean; done?: boolean };
export type EveningPlan = { version: 1; input: PlanInput; createdAt: string; blocks: PlanBlock[]; unplaced: { taskId: string; minutes: number }[]; warnings: string[] };
export type PlannerStore = { version: 1; revision: number; prefs: PlanPrefs | null; plans: EveningPlan[] };
export const DEFAULT_PREFS: PlanPrefs = { hours: Array.from({ length: 7 }, () => ({ start: '15:30', stop: '21:30' })), commute: 30, unwind: 20, focus: 40, rest: 10, minimum: 10, maximum: 180, reserve: 20, order: 'due', commitments: [] };
export const EMPTY_PLANNER: PlannerStore = { version: 1, revision: 0, prefs: null, plans: [] };
export const clonePrefs = (p = DEFAULT_PREFS): PlanPrefs => JSON.parse(JSON.stringify(p));
export function minutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Use a valid same-day time.');
  const [h, m] = value.split(':').map(Number); return h * 60 + m;
}
export function clock(n: number) { return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
export function weekday(date: string) { if (!isDateOnly(date)) throw new Error('Choose a valid date.'); return new Date(`${date}T12:00:00Z`).getUTCDay(); }
export function pacificMinute(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
}
function integer(v: number, min: number, max: number, label: string) { if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${label} must be ${min}–${max}.`); }
function label(v: string, name: string) { if (typeof v !== 'string' || !v.trim() || v.length > 180) throw new Error(`${name} needs 1–180 characters.`); }
function id(v: string) { if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v)) throw new Error('Invalid planner identifier.'); }
export function validatePrefs(p: PlanPrefs): PlanPrefs {
  if (!p || !Array.isArray(p.hours) || p.hours.length !== 7 || !['due', 'hard', 'quick'].includes(p.order) || !Array.isArray(p.commitments) || p.commitments.length > 20) throw new Error('Invalid planning preferences. Maximum 20 fixed commitments.');
  p.hours.forEach(h => { if (!h || minutes(h.stop) <= minutes(h.start)) throw new Error('Finish time must be after the afternoon start, on the same day.'); });
  integer(p.commute, 0, 120, 'Commute minutes'); integer(p.unwind, 0, 120, 'Unwind minutes'); integer(p.focus, 15, 90, 'Focus minutes'); integer(p.rest, 5, 30, 'Break minutes'); integer(p.minimum, 5, 30, 'Minimum study block'); integer(p.maximum, 15, 360, 'Study limit'); integer(p.reserve, 0, 120, 'Free-time reserve');
  if (p.minimum > p.focus) throw new Error('Minimum block must not exceed focus length.');
  const ids = new Set();
  for (const c of p.commitments) { id(c.id); label(c.title, 'Activity'); if (ids.has(c.id)) throw new Error('Duplicate activity.'); ids.add(c.id); if (minutes(c.end) <= minutes(c.start) || !Array.isArray(c.days) || !c.days.length || new Set(c.days).size !== c.days.length || c.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('Check activity times and repeat days.'); }
  return p;
}
export function validateInput(input: PlanInput): PlanInput {
  if (!input || !isDateOnly(input.date) || !Array.isArray(input.tasks) || input.tasks.length > 50 || input.commitmentsConfirmed !== true) throw new Error('Confirm your fixed plans and select at most 50 tasks.');
  validatePrefs(input.prefs); const ids = new Set();
  for (const t of input.tasks) {
    id(t.id); label(t.title, 'Task'); if (ids.has(t.id)) throw new Error('Duplicate task.'); ids.add(t.id);
    integer(t.minutes, 5, 240, 'Task estimate'); integer(t.priority, 1, 3, 'Priority'); integer(t.difficulty, 1, 3, 'Difficulty');
    if (t.due !== null && !isDateOnly(t.due)) throw new Error('Check the task deadline date.');
    if (t.requirement !== undefined && !['required', 'optional', 'unclear'].includes(t.requirement)) throw new Error('Unknown task requirement.');
    if (!['reader', 'personal'].includes(t.origin)) throw new Error('Unknown task source.');
    if (t.origin === 'reader' && (!safeReaderUrl(t.sourceUrl) || safeReaderUrl(t.sourceUrl) !== t.sourceUrl || typeof t.sourceVersion !== 'string' || t.sourceVersion.length > 6000)) throw new Error('Invalid assignment source.');
  }
  return input;
}
export function taskVersion(t: PlanTask) { return JSON.stringify([t.id, t.title, t.due, t.sourceUrl || '', t.sourceVersion || '']); }
export function assignmentChoices(cards: ReaderCard[], date: string): PlanTask[] {
  const byId = new Map(cards.map(c => [c.id, c]));
  return groupCards(cards).flatMap(({ card: c, ids }) => {
    if (c.kind !== 'assignment' || c.status !== 'accepted' || ids.some(id => { const p = byId.get(id)!; return p.hiddenAt || p.doneAt; }) || cardTiming(c, date).bucket === 'past') return [];
    return [{ id: c.id, title: neutralTitle(c.title), minutes: 30, priority: c.requirement === 'required' ? 2 : 1, difficulty: 2, due: cardTiming(c, date).due, origin: 'reader' as const, sourceUrl: c.sourceUrl, sourceVersion: JSON.stringify([c.sourceTextHash, c.quote, c.due, c.requirement, c.status]), course: c.course, requirement: c.requirement }];
  }).slice(0, 50);
}
export function recommendedTaskIds(tasks: PlanTask[], date: string) { return tasks.filter(t => t.priority >= 2 && t.due && t.due >= date && t.due <= offsetDay(date, 7)).map(t => t.id); }
function overlaps(a: PlanBlock, b: PlanBlock) { return a.start < b.end && b.start < a.end; }
export function fixedBlocks(input: PlanInput): PlanBlock[] {
  const p = input.prefs, d = weekday(input.date), h = p.hours[d], start = minutes(h.start), stop = minutes(h.stop);
  if (start + p.commute + p.unwind + p.reserve > stop) throw new Error('Commute, unwind and free time use the whole window. Adjust your boundaries.');
  const blocks: PlanBlock[] = [];
  const add = (id: string, title: string, from: number, to: number, kind: PlanBlock['kind'] = 'fixed') => { if (to > from) blocks.push({ id, kind, title, start: from, end: to }); };
  add('fixed-commute', 'Commute', start, start + p.commute);
  add('fixed-unwind', 'Unwind', start + p.commute, start + p.commute + p.unwind);
  for (const c of p.commitments.filter(c => c.days.includes(d))) {
    const from = minutes(c.start), to = minutes(c.end);
    if (to <= start || from >= stop) continue;
    if (from < start || to > stop) throw new Error(`${c.title} crosses your afternoon boundary. Adjust the activity or window.`);
    add(`fixed-${c.id}`, c.title, from, to);
  }
  add('fixed-reserve', 'Protected free time', stop - p.reserve, stop, 'free');
  blocks.sort((a, b) => a.start - b.start);
  for (let i = 1; i < blocks.length; i++) if (overlaps(blocks[i - 1], blocks[i])) throw new Error(`${blocks[i - 1].title} overlaps ${blocks[i].title}. Fixed plans are never moved automatically.`);
  return blocks;
}
function assertBlocks(input: PlanInput, blocks: PlanBlock[]) {
  const p = input.prefs, h = p.hours[weekday(input.date)], start = minutes(h.start), stop = minutes(h.stop), ids = new Set();
  if (blocks.length > 250) throw new Error('Too many planning blocks.');
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]; id(b.id); label(b.title, 'Session'); integer(b.start, start, stop, 'Session start'); integer(b.end, b.start + 1, stop, 'Session end');
    if ((b.pinned !== undefined && typeof b.pinned !== 'boolean') || (b.done !== undefined && typeof b.done !== 'boolean')) throw new Error('Invalid session flags.');
    if (ids.has(b.id) || !['fixed', 'study', 'break', 'free', 'history'].includes(b.kind)) throw new Error('Invalid or duplicate session.'); ids.add(b.id);
    if (i && overlaps(sorted[i - 1], b)) throw new Error(`${sorted[i - 1].title} overlaps ${b.title}.`);
    if (b.kind === 'study' && (!input.tasks.some(t => t.id === b.taskId) || b.end - b.start > p.focus)) throw new Error('A study block needs a selected task and must fit your focus length.');
    if (b.kind === 'history' && b.done !== true) throw new Error('Invalid completed-session history.');
  }
  const study = sorted.filter(b => b.kind === 'study' || b.kind === 'history');
  if (study.reduce((sum, b) => sum + b.end - b.start, 0) > p.maximum) throw new Error('Study sessions exceed your daily study limit.');
  for (let i = 1; i < study.length; i++) if (study[i].start - study[i - 1].end < p.rest) throw new Error('Keep the requested break between study sessions.');
  const expected = fixedBlocks(input);
  for (const b of expected) if (!blocks.some(p => p.id === b.id && p.start === b.start && p.end === b.end && p.kind === b.kind && p.title === b.title)) throw new Error('Fixed plans changed. Generate a new draft.');
  if (blocks.some(b => (b.kind === 'fixed' || b.kind === 'free') && !expected.some(e => e.id === b.id))) throw new Error('Unexpected fixed block.');
}
export function validatePlan(plan: EveningPlan): EveningPlan {
  if (!plan || plan.version !== 1 || !Array.isArray(plan.blocks) || !Array.isArray(plan.unplaced) || !Array.isArray(plan.warnings) || plan.warnings.length > 20 || plan.warnings.some(w => typeof w !== 'string' || w.length > 500) || typeof plan.createdAt !== 'string' || !Number.isFinite(Date.parse(plan.createdAt))) throw new Error('Invalid saved plan.');
  validateInput(plan.input); assertBlocks(plan.input, plan.blocks);
  const remaining = new Map(plan.input.tasks.map(t => [t.id, t.minutes]));
  for (const b of plan.blocks.filter(b => b.kind === 'study')) remaining.set(b.taskId!, remaining.get(b.taskId!)! - b.end + b.start);
  if (plan.unplaced.length > 50 || new Set(plan.unplaced.map(u => u.taskId)).size !== plan.unplaced.length || plan.unplaced.some(u => !remaining.has(u.taskId))) throw new Error('Invalid unscheduled work.');
  for (const [taskId, n] of remaining) if (n < 0 || (plan.unplaced.find(u => u.taskId === taskId)?.minutes || 0) !== n) throw new Error('Scheduled and remaining minutes do not match the task estimates.');
  return plan;
}
export function validatePlannerStore(raw: PlannerStore): PlannerStore {
  if (!raw || raw.version !== 1 || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.plans) || raw.plans.length > 30) throw new Error('Invalid planner storage.');
  if (raw.prefs) validatePrefs(raw.prefs);
  raw.plans.forEach(validatePlan);
  if (new Set(raw.plans.map(p => p.input.date)).size !== raw.plans.length) throw new Error('Duplicate saved planning dates.');
  return raw;
}
export function generatePlan(input: PlanInput, now = new Date(), previous?: EveningPlan): EveningPlan {
  validateInput(input);
  const today = dayKey(now), p = input.prefs, h = p.hours[weekday(input.date)];
  if (input.date < today || input.date > offsetDay(today, 30)) throw new Error('Generate for today or the next 30 days. Older plans are history only.');
  if (previous && previous.input.date !== input.date) throw new Error('Only replan sessions on the same date.');
  const floor = input.date === today ? Math.ceil(pacificMinute(now) / 5) * 5 : 0;
  const start = Math.max(minutes(h.start) + p.commute + p.unwind, floor), stop = minutes(h.stop) - p.reserve;
  const blocks = fixedBlocks(input), warnings = ['Local rules, not an AI prediction. Estimates and fixed plans are supplied by you. Date-only deadlines have no verified submission time.'];
  const remaining = new Map(input.tasks.map(t => [t.id, t.minutes]));
  if (previous) {
    validatePlan(previous);
    for (const old of previous.blocks.filter(b => b.kind === 'study' || b.kind === 'history')) {
      const task = input.tasks.find(t => t.id === old.taskId), before = previous.input.tasks.find(t => t.id === old.taskId);
      const same = task && before && taskVersion(task) === taskVersion(before);
      if (old.done) {
        blocks.push(same ? { ...old, pinned: true } : { ...old, kind: 'history', taskId: undefined, pinned: true });
        if (same) remaining.set(task.id, remaining.get(task.id)! - old.end + old.start);
      } else if (old.pinned && old.start >= floor) {
        if (!same) throw new Error(`Unpin “${old.title}” before replanning: its task was removed or changed.`);
        blocks.push({ ...old }); remaining.set(task.id, remaining.get(task.id)! - old.end + old.start);
      }
    }
    if (previous.blocks.some(b => b.kind === 'study' && !b.done && b.start < floor)) warnings.push('Past sessions not marked done were returned to remaining work. Passing time does not prove completion.');
  }
  if ([...remaining.values()].some(n => n < 0)) throw new Error('Kept sessions exceed a new task estimate. Unpin/reopen them or increase the estimate.');
  assertBlocks(input, blocks);
  let budget = p.maximum - blocks.filter(b => b.kind === 'study' || b.kind === 'history').reduce((s, b) => s + b.end - b.start, 0);
  const occupied = [...blocks].sort((a, b) => a.start - b.start);
  const gaps: [number, number][] = []; let cursor = start;
  for (const b of occupied) { if (b.end <= cursor) continue; if (b.start > cursor) gaps.push([cursor, Math.min(stop, b.start)]); cursor = Math.max(cursor, b.end); }
  if (cursor < stop) gaps.push([cursor, stop]);
  const urgent = (t: PlanTask) => t.due && t.due <= offsetDay(input.date, 1) ? 0 : 1;
  const tasks = [...input.tasks].sort((a, b) => urgent(a) - urgent(b) || b.priority - a.priority || (p.order === 'hard' ? b.difficulty - a.difficulty : p.order === 'quick' ? a.minutes - b.minutes : 0) || (a.due || '9999').localeCompare(b.due || '9999') || a.id.localeCompare(b.id));
  let serial = 0;
  for (const [from, to] of gaps) {
    let at = from;
    while (at < to && budget > 0) {
      const studies = blocks.filter(b => b.kind === 'study' || b.kind === 'history');
      const prior = studies.filter(b => b.end <= at).sort((a, b) => b.end - a.end)[0];
      const next = studies.filter(b => b.start >= at).sort((a, b) => a.start - b.start)[0];
      const workStart = Math.max(at, prior ? prior.end + p.rest : at), end = Math.min(to, next ? next.start - p.rest : to);
      const capacity = Math.floor(Math.min(end - workStart, budget, p.focus) / 5) * 5;
      const task = tasks.find(t => { const left = remaining.get(t.id)!; return left > 0 && capacity >= Math.min(p.minimum, left); });
      if (!task) break;
      if (workStart > at) blocks.push({ id: `break-${++serial}`, kind: 'break', title: 'Break', start: at, end: workStart });
      const length = Math.min(remaining.get(task.id)!, capacity);
      let blockId: string; do { blockId = `study-${++serial}`; } while (blocks.some(b => b.id === blockId));
      blocks.push({ id: blockId, kind: 'study', title: task.title, taskId: task.id, start: workStart, end: workStart + length });
      remaining.set(task.id, remaining.get(task.id)! - length); budget -= length; at = workStart + length;
    }
  }
  const unplaced = input.tasks.flatMap(t => remaining.get(t.id)! > 0 ? [{ taskId: t.id, minutes: remaining.get(t.id)! }] : []);
  if (unplaced.length) warnings.push('Some work did not fit the available gaps, focus/break rules or study limit. Finish time was not extended. Adjust estimates or choose another day; due dates were not changed.');
  if (input.tasks.some(t => !t.due)) warnings.push('Work with no verified date was explicitly selected. It is not treated as an urgent deadline.');
  if (input.tasks.some(t => t.due && t.due < input.date)) warnings.push('A personally entered task has a past due date. This is not evidence that it is still required or unsubmitted.');
  return validatePlan({ version: 1, input: JSON.parse(JSON.stringify(input)), createdAt: now.toISOString(), blocks: blocks.sort((a, b) => a.start - b.start), unplaced, warnings });
}
export function changeSession(plan: EveningPlan, id: string, change: { start?: number; pinned?: boolean; done?: boolean }, now = new Date()): EveningPlan {
  const b = plan.blocks.find(b => b.id === id);
  if (!b || b.kind !== 'study') throw new Error('Choose a study session.');
  if (plan.input.date < dayKey(now)) throw new Error('Historical plans are read-only.');
  if (change.done && (plan.input.date > dayKey(now) || b.start > pacificMinute(now))) throw new Error('Only mark a session done once its start time has arrived.');
  if (change.start !== undefined && (b.done || (plan.input.date === dayKey(now) && change.start < pacificMinute(now)))) throw new Error('Do not move completed sessions or move work into the past.');
  const next = { ...plan, blocks: plan.blocks.map(old => old.id !== id ? old : { ...old, ...change, ...(change.start !== undefined ? { end: change.start + old.end - old.start, pinned: true } : {}) }) };
  return validatePlan(next);
}
export function planSourceWarnings(plan: EveningPlan, current: PlanTask[]) {
  return plan.input.tasks.filter(t => t.origin === 'reader' && !current.some(c => taskVersion(c) === taskVersion(t))).map(t => `“${t.title}” changed or is no longer eligible (hidden, done, past, stale or removed). Review its source before using this plan.`);
}
