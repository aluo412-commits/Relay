// Optional task due dates. Stored on Task.due as an ISO "YYYY-MM-DD" string;
// unset (null/"") is a first-class, common state — never coerced to a date.

export type DueState = "none" | "soon" | "today" | "overdue";

export const SOON_DAYS = 3; // "due soon" = within this many days (inclusive)

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(now: Date, days: number): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function parseCount(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digit: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digit[value[1]] ?? 0);
  if (value.includes("十")) return (digit[value[0]] ?? 0) * 10 + (digit[value[2]] ?? 0);
  return digit[value] ?? 0;
}

function validDate(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? isoDate(d) : null;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
  "日": 0, "天": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6,
};

/**
 * Convert an explicit human deadline into the YYYY-MM-DD format used by Task.due.
 * This is intentionally conservative: it returns null when the text has no clear
 * deadline rather than guessing from words like "next step" or "soon".
 */
export function inferDueDate(text: string | null | undefined, now: Date = new Date()): string | null {
  if (!text?.trim()) return null;
  const s = text.trim().toLowerCase();
  let m = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/.exec(s);
  if (m) return validDate(Number(m[3]), Number(m[1]), Number(m[2]));

  const relative = [
    [/\b(?:today|tonight|eod|end of day)\b|今天|今日|今天结束/, 0],
    [/\b(?:tomorrow)\b|明天|明早|明晚/, 1],
    [/\b(?:day after tomorrow)\b|后天/, 2],
  ] as const;
  for (const [pattern, days] of relative) if (pattern.test(s)) return isoDate(addDays(now, days));

  m = /(?:\bin\s+|within\s+|after\s+)(\d+)\s*(?:calendar\s*)?(day|days|d)\b/.exec(s) || /(\d+)\s*(?:天|日)(?:后|内)/.exec(s) || /(?:in|within|after)?\s*([一二两三四五六七八九十]+)\s*(?:天|日)(?:后|内)/.exec(s);
  if (m) return isoDate(addDays(now, parseCount(m[1])));
  m = /(?:\bin\s+|within\s+|after\s+)(\d+)\s*(?:calendar\s*)?(week|weeks|w)\b/.exec(s) || /(\d+)\s*周(?:后|内)/.exec(s) || /([一二两三四五六七八九十]+)\s*周(?:后|内)/.exec(s);
  if (m) return isoDate(addDays(now, parseCount(m[1]) * 7));
  m = /(?:\bin\s+|within\s+|after\s+)(\d+)\s*(?:hour|hours|h)\b/.exec(s);
  if (m) return isoDate(addDays(now, Math.max(0, Math.ceil(Number(m[1]) / 24))));
  if (/\b(?:end of month|by month[- ]end)\b|月底|本月底/.test(s)) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return isoDate(d);
  }
  m = /(?:next month|下个月)\s*(\d{1,2})\s*(?:st|nd|rd|th|日|号)?/.exec(s);
  if (m) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, Number(m[1]));
    return d.getDate() === Number(m[1]) ? isoDate(d) : null;
  }
  if (/\b(?:next week)\b|下周|下星期/.test(s)) return isoDate(addDays(now, 7));
  if (/\b(?:end of week|this weekend)\b|本周末|周末/.test(s)) {
    const daysToFriday = (5 - now.getDay() + 7) % 7;
    return isoDate(addDays(now, daysToFriday));
  }

  // "June 5", "Jun 5, 2027", and the Chinese "6月5日" forms.
  const months: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  m = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/.exec(s);
  if (m) {
    const year = Number(m[3] || now.getFullYear());
    let result = validDate(year, months[m[1]], Number(m[2]));
    if (result && !m[3] && result < isoDate(now)) result = validDate(year + 1, months[m[1]], Number(m[2]));
    return result;
  }
  m = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/.exec(s);
  if (m) {
    let result = validDate(now.getFullYear(), Number(m[1]), Number(m[2]));
    if (result && result < isoDate(now)) result = validDate(now.getFullYear() + 1, Number(m[1]), Number(m[2]));
    return result;
  }

  // Weekday deadlines: "by Friday", "next Monday", 下周一, 本周五.
  m = /\b(?:next\s+|this\s+|by\s+|on\s+)?(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/.exec(s);
  const chineseWeekday = /(?:下周|下星期|本周|本星期|周|星期)([日天一二三四五六])/.exec(s);
  if (m || chineseWeekday) {
    const target = m ? WEEKDAYS[m[1]] : WEEKDAYS[chineseWeekday![1]];
    const isNext = !!(m && /\bnext\s+/.test(m[0])) || !!(chineseWeekday && /下/.test(chineseWeekday[0]));
    let delta = (target - now.getDay() + 7) % 7;
    if (isNext) delta = delta || 7;
    return isoDate(addDays(now, delta));
  }
  return null;
}

/** Normalize a model-provided due value, falling back to the user's original wording. */
export function normalizeDue(due: string | null | undefined, context: string, now: Date = new Date()): string | undefined {
  return inferDueDate(due, now) ?? inferDueDate(context, now) ?? undefined;
}

/** Local calendar day at midnight, so comparisons are date-based, not time-based. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse an ISO YYYY-MM-DD into a local midnight Date, or null if absent/invalid. */
export function parseDue(due: string | null | undefined): Date | null {
  if (!due) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** Whole calendar days from today to the due date (negative = past). null if no due. */
export function daysUntilDue(due: string | null | undefined, now: Date = new Date()): number | null {
  const d = parseDue(due);
  if (!d) return null;
  const ms = startOfDay(d).getTime() - startOfDay(now).getTime();
  return Math.round(ms / 86_400_000);
}

/** Derive the display state for a due date. */
export function dueState(due: string | null | undefined, now: Date = new Date()): DueState {
  const days = daysUntilDue(due, now);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= SOON_DAYS) return "soon";
  return "none"; // has a date, but far off — not flagged
}

/** Short human label, e.g. "Aug 5". Empty string if no due date. */
export function formatDue(due: string | null | undefined): string {
  const d = parseDue(due);
  if (!d) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A one-word urgency label for chips ("overdue", "today", "soon"), else "". */
export function dueLabel(due: string | null | undefined, now: Date = new Date()): string {
  const s = dueState(due, now);
  return s === "none" ? "" : s;
}

// Sort ordering for open work: overdue → today → soon → other-dated → undated.
const RANK: Record<DueState, number> = { overdue: 0, today: 1, soon: 2, none: 3 };

/** Comparator: most-urgent due first; undated last; ties broken by the date itself. */
export function compareDue(
  a: string | null | undefined,
  b: string | null | undefined,
  now: Date = new Date()
): number {
  const ra = RANK[dueState(a, now)];
  const rb = RANK[dueState(b, now)];
  if (ra !== rb) return ra - rb;
  const da = parseDue(a);
  const db = parseDue(b);
  if (da && db) return da.getTime() - db.getTime();
  if (da) return -1; // a is dated, b is not → a first
  if (db) return 1;
  return 0;
}
