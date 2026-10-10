// Pure scheduling/queue rules, also exercised by the app's test runner.
export const SCHOOL = "https://fuhsd.schoology.com";
export const PAGE_LIMIT = 240;
export const SOURCE_LIMIT = 300;
export function schoolUrl(value, base = SCHOOL) {
  if (typeof value !== "string" || value.length > 1200) return null;
  try {
    const u = new URL(value, base);
    if (u.origin !== SCHOOL || u.username || u.password) return null;
    if (/^\/course\/\d+\/?$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/$/, "") + "/materials";
    if (!/^\/(courses|grades\/grades|assignment\/\d+|page\/\d+|course\/\d+\/(materials(?:\/gp\/\d+)?|updates))\/?$/.test(u.pathname)) return null;
    const f = u.searchParams.get("f"), p = u.searchParams.get("page");
    if (p && (!/^\d{1,2}$/.test(p) || Number(p) > 20)) return null;
    u.search = ""; u.hash = "";
    if (f && /^\d{1,20}$/.test(f)) u.searchParams.set("f", f);
    if (p && /^\d{1,2}$/.test(p) && Number(p) <= 20) u.searchParams.set("page", p);
    return u.href;
  } catch { return null; }
}
export function googleUrl(value) {
  if (typeof value !== "string" || value.length > 1200) return null;
  try {
    const u = new URL(value);
    if (u.origin !== "https://docs.google.com" || u.username || u.password) return null;
    const m = /^\/(document|presentation)\/d\/([\w-]+)(?:\/.*)?$/.exec(u.pathname);
    return m ? `https://docs.google.com/${m[1]}/d/${m[2]}/edit` : null;
  } catch { return null; }
}
export function pacificDay(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function isDue(settings, report, now = new Date()) {
  if (!settings?.enabled || report?.status === "login-required") return false;
  if (report?.status === "running") return true;
  if (!report?.startedAt) return true;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 8 && pacificDay(new Date(report.startedAt)) !== pacificDay(now);
}
export function addJobs(run, candidates) {
  const known = new Set([...run.visited, ...run.queue.map(j => j.url)]);
  run.scheduledByCourse ||= {};
  const perCourse = run.courses?.length ? Math.max(2, Math.floor((PAGE_LIMIT - 2) / run.courses.length)) : PAGE_LIMIT;
  for (const job of candidates) {
    if (known.has(job.url)) continue;
    if (known.size >= PAGE_LIMIT || (job.course && (run.scheduledByCourse[job.course] || 0) >= perCourse)) { run.limited = true; continue; }
    known.add(job.url);
    if (job.course) run.scheduledByCourse[job.course] = (run.scheduledByCourse[job.course] || 0) + 1;
    run.queue.push(job);
  }
}
export function putSnapshot(pages, page) {
  const previous = pages.find(p => p.url === page.url);
  const next = pages.filter(p => p.url !== page.url);
  next.push(page);
  // Retain current snapshots, not an unbounded history of the student's files.
  next.sort((a, b) => Number(a.readDepth === "description") - Number(b.readDepth === "description") || b.capturedAt.localeCompare(a.capturedAt));
  return { pages: next.slice(0, SOURCE_LIMIT), changed: !previous || previous.text !== page.text, evicted: next.length > SOURCE_LIMIT };
}
