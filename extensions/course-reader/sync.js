import { parseLocalPdf } from "./pdf-reader.js";
import { ownedGet, ownedSet, ownedRemove, pairedAccount, currentAccount } from "./owned-storage.js";
import { schoolUrl, homeworkSource, googleUrl, isDue, addJobs, putSnapshot } from "./sync-core.js";
import { readSyncPage } from "./sync-read.js";
import { readingPriority } from "./priority.js";
async function describeSource(url, link, parent, courseId) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return { id: "page-" + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("").slice(0, 24), url, title: link.title || "Course resource", text: `Source title: ${link.title || "Course resource"}\nDescription from linking page: ${link.description || "No description available."}\nDocument contents have not been read.`, description: (link.description || "").slice(0, 500), descriptionSource: parent, readDepth: "description", capturedAt: new Date().toISOString(), warnings: ["Description only, copied from the linking page. Not document contents; not sent for task extraction."], links: [], courseId };
}
const ALARM = "relay-daily-reader";
const DEFAULT = { enabled: false, google: false, pdf: false };
let working = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function state() { const s = await ownedGet(["syncSettings", "syncRun", "syncPages", "homeworkSources"]); return { settings: s.syncSettings || DEFAULT, run: s.syncRun || null, pages: s.syncPages || [], pins: Array.isArray(s.homeworkSources) ? s.homeworkSources.slice(0,40) : [], binding: s.__binding }; }
export async function setHomeworkSource(course, value) {
  const account = await pairedAccount(), s = await state();
  if (s.binding !== account.binding) throw new Error("Account changed; operation canceled.");
  if (s.settings.enabled) throw new Error("Pause reading before changing a homework source.");
  const enrolled = s.run?.courses.find(c => c.id === course);
  const oldPin = s.pins.find(p => p.course === course);
  if (!enrolled && !(value === null && oldPin)) throw new Error("Run a course check first, then choose one of your discovered courses.");
  const url = value === null ? null : homeworkSource(value, course, account.district.schoology);
  if (value !== null && !url) throw new Error("Use this course's Schoology materials or individual file/page wrapper URL. Do not paste a signed download URL or login link.");
  const pins = s.pins.filter(p => p.course !== course);
  if (url) pins.push({ course, url, title: enrolled.title });
  // A paused queue was planned with the old source choice. Start fresh next time.
  await ownedSet({ homeworkSources: pins, syncRun: s.run ? { ...s.run, status: "partial", queue: [], message: "Source choice changed. Enable reading and Sync now to check it." } : null }, account.binding);
  return syncStatus();
}
function publicReport(run) {
  if (!run) return null;
  const { id, status, startedAt, finishedAt, courses, read, changed, unread, unreadCount, limited, message } = run;
  return { id, status, startedAt, finishedAt, courses, read, changed, unread, unreadCount, limited, message, checked: run.visited.length, queued: run.queue.length };
}
export async function websiteReady(account) {
  const tabs = await chrome.tabs.query({ url: "https://relay.aaronluo.com/*" });
  for (const tab of tabs) try {
    if (new URL(tab.url).pathname !== "/") continue;
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [account.binding], func: binding => {
      const a = JSON.parse(document.documentElement.dataset.relayReaderAccount || "null");
      return location.origin === "https://relay.aaronluo.com" && a?.binding === binding && document.documentElement.dataset.relayDailyReaderReady === "1";
    } });
    if (result[0]?.result === true) return true;
  } catch { /* A closed tab is not ready. */ }
  return false;
}
export async function syncStatus() {
  let account;
  try { const a = await currentAccount(); account = { email: a.user.email, districtId: a.district.id, schoology: a.district.schoology, binding: a.binding, scope: a.scope }; }
  catch (e) { return { settings: DEFAULT, report: null, paired: false, account: null, message: e.message }; }
  try { const s = await state(); if (s.binding !== account.binding) throw new Error("Account changed; reopen the extension."); return { settings: s.settings, report: publicReport(s.run), homeworkSources: s.pins, paired: true, account, websiteReady: await websiteReady(account) }; }
  catch (e) { return { settings: DEFAULT, report: null, paired: false, account, message: e.message }; }
}
async function closeOwned(run) {
  const session = await chrome.storage.session.get(["syncBrowserSession", "syncAdoptedTabs"]);
  if (!run || run.browserSession !== session.syncBrowserSession) return;
  for (const id of [run?.schoolTab, run?.docsTab]) {
    if (!id || session.syncAdoptedTabs?.includes(id)) continue;
    try { const tab = await chrome.tabs.get(id); if (!tab.active) await chrome.tabs.remove(id); } catch { /* Already closed or navigated away by the user. */ }
  }
}
export async function configureSync(enabled, google = false, pdf = false) {
  const account = await pairedAccount(), SCHOOL = account.district.schoology;
  if (enabled && !await websiteReady(account)) throw new Error("Open Relay setup in this account and turn on Automatically import daily snapshots before enabling reading. AI permission is a separate choice.");
  if (enabled && !await chrome.permissions.contains({ origins: [SCHOOL + "/*"] })) throw new Error("Grant Schoology access first.");
  if (enabled && google && !await chrome.permissions.contains({ origins: ["https://docs.google.com/*"] })) throw new Error("Grant Google Docs access or leave linked documents off.");
  const old = await state();
  if (old.binding !== account.binding) throw new Error("Account changed; operation canceled.");
  await ownedSet({ syncSettings: { enabled, google: enabled && google, pdf: enabled && pdf } }, account.binding);
  if (!enabled) {
    await chrome.alarms.clear(ALARM);
    if (old.run?.status === "running") await ownedSet({ syncRun: { ...old.run, status: "paused", message: "Daily reading paused by you.", finishedAt: new Date().toISOString() } });
    await closeOwned(old.run);
  } else {
    if (old.run?.status === "paused" && old.run.queue.length) await ownedSet({ syncRun: { ...old.run, status: "running", finishedAt: null, message: "Resuming the paused text sweep…" } });
    await ensureAlarm(); void tick().catch(() => {});
  }
  return syncStatus();
}
export async function forgetSync() {
  await configureSync(false);
  await ownedRemove(["syncPages", "syncRun", "schoolIdentity", "homeworkSources"], (await pairedAccount()).binding);
  await chrome.action.setBadgeText({ text: "" });
  return syncStatus();
}
export async function syncNow() {
  let s = await state(); const binding = s.binding;
  if (!s.settings.enabled) throw new Error("Enable daily course reading first.");
  if (s.run?.status === "running") return syncStatus();
  // Enable can still be delivering the previous snapshot. Wait for that short
  // handoff instead of losing the student's immediate Sync now request.
  for (let i = 0; working && i < 50; i++) await pause(200);
  if (working) throw new Error("The previous sweep is still finishing. Try Sync now again shortly.");
  s = await state();
  if (s.binding !== binding || !s.settings.enabled) throw new Error("Account or reading permission changed; sync canceled.");
  if (s.run?.status === "running") return syncStatus();
  await ownedRemove("syncRun", binding);
  void tick().catch(() => {}); return syncStatus();
}
async function ensureAlarm() { if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 }); }
function issue(run, job, reason, scope = "source") {
  run.unreadCount++;
  if (run.unread.length < 240) run.unread.push({ url: job.url, title: job.title || "Course source", reason: reason.slice(0, 350), scope });
  else run.limited = true;
}
async function ownedTab(run, google) {
  const account = await pairedAccount(), SCHOOL = account.district.schoology;
  const key = google ? "docsTab" : "schoolTab", origin = google ? "https://docs.google.com" : SCHOOL;
  if (google && run.docsBlocked) throw new Error("Google login needs attention; linked documents deferred for this sweep.");
  if (google && !await chrome.permissions.contains({ origins: [origin + "/*"] })) throw new Error("Linked Google Docs access was revoked; document not read.");
  if (run[key]) {
    try {
      const tab = await chrome.tabs.get(run[key]);
      if (new URL(tab.url || "about:blank").origin === origin) return tab;
      throw new Error("login");
    } catch (error) {
      run[key] = null;
      if (error.message === "login") { if (google) run.docsBlocked = true; throw new Error(google ? "Google document session unavailable." : "LOGIN_REQUIRED"); }
      // A closed tab or browser restart is recoverable without losing the queue.
    }
  }
  const tab = await chrome.tabs.create({ url: google ? run.queue[0].url : SCHOOL + "/courses", active: false });
  run[key] = tab.id;
  // Persist the owned-tab identity before waiting so a worker restart can resume.
  const live = await state();
  if (!live.settings.enabled || live.run?.id !== run.id || live.run.status !== "running") { await closeOwned(run); throw new Error("SYNC_STOPPED"); }
  await ownedSet({ syncRun: run });
  for (let i = 0; i < 20; i++) {
    await pause(400);
    const loaded = await chrome.tabs.get(tab.id);
    if (loaded.status === "complete") {
      if (new URL(loaded.url || "about:blank").origin !== origin) { if (google) run.docsBlocked = true; throw new Error(google ? "Google document login required." : "LOGIN_REQUIRED"); }
      return loaded;
    }
  }
  throw new Error("The background source tab did not finish loading.");
}
async function deliver(s) {
  if (!s.run) return;
  const account = await pairedAccount();
  if (s.run.accountBinding !== account.binding) return;
  // Never open or focus Relay without a user action. Delivery waits until Relay
  // is open and its separate local auto-import switch has been enabled.
  const tabs = await chrome.tabs.query({ url: "https://relay.aaronluo.com/*" });
  const eligible = tabs.filter(t => { try { return new URL(t.url).pathname === "/"; } catch { return false; } }).sort((a, b) => Number(b.active) - Number(a.active));
  const revision = `${s.run.id}:${s.run.visited.length}:${s.run.status}`;
  for (const tab of eligible) try {
    const ready = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [account.scope, account.binding], func: (scope, binding) => { const a = JSON.parse(document.documentElement.dataset.relayReaderAccount || "null"); return location.origin === "https://relay.aaronluo.com" && document.documentElement.dataset.relayDailyReaderReady === "1" && a?.scope === scope && a?.binding === binding; } });
    if (!ready[0]?.result) continue;
    const sent = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [{ version: 1, pages: s.pages }, publicReport(s.run), revision, account.scope, account.binding], func: async (capture, report, revision, scope, binding) => {
      const identity = JSON.parse(document.documentElement.dataset.relayReaderAccount || "null");
      if (identity?.scope !== scope || identity?.binding !== binding) return false;
      if (location.origin !== "https://relay.aaronluo.com" || document.documentElement.dataset.relayDailyReaderReady !== "1") return false;
      if (document.documentElement.dataset.relayDailyRevision === revision) return true;
      const id = crypto.randomUUID();
      return new Promise(resolve => {
        const timeout = setTimeout(() => { window.removeEventListener("message", ack); resolve(false); }, 8000);
        function ack(e) { if (e.source === window && e.origin === location.origin && e.data?.type === "relay.reader.synced" && e.data.id === id) { clearTimeout(timeout); window.removeEventListener("message", ack); document.documentElement.dataset.relayDailyRevision = revision; resolve(true); } }
        window.addEventListener("message", ack);
        window.postMessage({ type: "relay.reader.daily", id, capture, report, scope, binding }, location.origin);
      });
    } });
    if (sent[0]?.result) return;
  } catch { /* A closed/not-yet-ready dashboard is not a source-read failure. */ }
}
export async function tick() {
  if (working) return;
  working = true;
  try {
    const account = await pairedAccount(), SCHOOL = account.district.schoology;
    let s = await state();
    if (s.binding !== account.binding) return;
    if (!s.settings.enabled) return;
    if (!await chrome.permissions.contains({ origins: [SCHOOL + "/*"] })) { await configureSync(false); return; }
    if (!isDue(s.settings, s.run)) { await deliver(s); return; }
    const session = await chrome.storage.session.get("syncBrowserSession");
    const browserSession = session.syncBrowserSession || crypto.randomUUID();
    if (!session.syncBrowserSession) await chrome.storage.session.set({ syncBrowserSession: browserSession });
    if (s.run?.status === "running" && s.run.browserSession !== browserSession) {
      s.run.schoolTab = null; s.run.docsTab = null; s.run.browserSession = browserSession;
      await ownedSet({ syncRun: s.run });
    }
    if (s.run?.status !== "running") {
      if (s.run?.browserSession === browserSession) await closeOwned(s.run);
      s.run = { id: crypto.randomUUID(), status: "running", startedAt: new Date().toISOString(), finishedAt: null, courses: [], queue: [{ url: SCHOOL + "/courses", title: "Enrolled courses", course: null }], visited: [], read: 0, changed: 0, unread: [], unreadCount: 0, limited: false, message: "Checking your enrolled courses…", schoolTab: null, docsTab: null, browserSession, accountBinding: account.binding };
      await ownedSet({ syncRun: s.run });
    }
    const run = s.run, deadline = Date.now() + 20000;
    // One worker invocation is short. Persist every page; alarms resume the queue
    // after worker suspension, browser restarts, or a closed source tab.
    while (run.queue.length && Date.now() < deadline) {
      const live = await state();
      if (!live.settings.enabled || live.run?.id !== run.id || live.run.status !== "running") return;
      const job = run.queue[0]; let result;
      try {
        const tab = await ownedTab(run, job.url.startsWith("https://docs.google.com/"));
        const output = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readSyncPage, args: [job.url, SCHOOL, s.settings.pdf === true && job.pinned === true, job.title, (await ownedGet('schoolIdentity')).schoolIdentity || null] });
        result = output[0]?.result || { error: "Source did not return readable content." };
      } catch (e) { result = { error: e.message, login: e.message === "LOGIN_REQUIRED" }; }
      const after = await state();
      if (!after.settings.enabled || after.run?.id !== run.id || after.run.status !== "running") return;
      run.queue.shift(); run.visited.push(job.url);
      if (result.error) {
        issue(run, job, result.error);
        run.consecutiveErrors = (run.consecutiveErrors || 0) + 1;
        if (run.consecutiveErrors >= 3) { run.status = "partial"; run.queue = []; run.message = "Reading needs attention after repeated source failures. Check your login and retry from the extension."; }
        if (result.login) { run.status = "login-required"; run.message = result.identityChanged ? "The school login changed or could not be verified. Confirm the school account and pair Relay again." : "Sign into Schoology, then choose Sync now in the extension."; run.queue = []; }
      } else {
        run.consecutiveErrors = 0;
        if (job.url.startsWith(SCHOOL + "/")) {
          const pin = (await ownedGet("schoolIdentity")).schoolIdentity;
          if (pin && pin !== result.schoolIdentity) {
            run.status = "login-required"; run.queue = []; run.finishedAt = new Date().toISOString(); run.message = "The school login changed or could not be verified. Confirm the school account and pair Relay again.";
            await ownedSet({ syncRun: run }); await closeOwned(run); await deliver(await state()); return;
          }
          if (!pin && result.schoolIdentity) await ownedSet({ schoolIdentity: result.schoolIdentity }, account.binding);
          if (!result.schoolIdentity && job.url === SCHOOL + "/courses") issue(run, job, "Schoology account identity was not exposed by this layout. Use a personal browser profile and confirm the school login belongs to you before pairing.", "attachment");
        }
        if (job.url === SCHOOL + "/courses") {
          run.courses = [...new Map(result.courses.filter(c => /^\d{1,20}$/.test(c.id)).map(c => [c.id, c])).values()];
          if (!run.courses.length) { issue(run, job, "No enrolled courses were discovered. The page may require a different layout or a new login; no full-coverage claim is made."); run.message = "Course discovery needs attention. Open Schoology and check your courses."; }
          else {
            s.pages = s.pages.filter(p => !p.courseId || run.courses.some(c => c.id === p.courseId));
            const pins = s.pins.filter(p => run.courses.some(c => c.id === p.course) && homeworkSource(p.url, p.course, SCHOOL) === p.url).map(p => ({ url: p.url, title: `${p.title} · Selected homework source`, course: p.course, pinned: true }));
            addJobs(run, [...pins, ...run.courses.flatMap(c => [{ url: `${SCHOOL}/course/${c.id}/materials`, title: c.title, course: c.id }, { url: `${SCHOOL}/course/${c.id}/updates`, title: c.title + " · updates", course: c.id }]), { url: SCHOOL + "/grades/grades", title: "My grades", course: null }]);
          }
        }
        const additional = result.extraPages || [];
        for (const file of result.pdfFiles || []) {
          try {
            const parsed = await parseLocalPdf(file.bytes);
            const identity = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(file.title));
            const tag = [...new Uint8Array(identity)].map(b => b.toString(16).padStart(2,'0')).join('').slice(0,8);
            if (!parsed.pages.length) issue(run, { ...job, title: file.title }, 'PDF has no readable text layer. Scans require manual reading; no OCR was attempted.', 'attachment');
            if (parsed.limited) { run.limited = true; issue(run, job, 'PDF limited to the first 20 pages.', 'attachment'); }
            for (const p of parsed.pages) {
              const pageUrl = job.url + '#pdf-' + tag + '-page-' + p.page;
              const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pageUrl));
              additional.push({ id: 'page-' + [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24), url: pageUrl, title: `${job.title} · ${file.title} · PDF page ${p.page}`.slice(0,180), text: p.text, readDepth: 'pdf', pdfPage: p.page, selectedSource: job.pinned === true, capturedAt: new Date().toISOString(), warnings: ['PDF text extracted locally. Table rows preserve visual cell order, but layout/date relationships still need review. No images, OCR or document scripts.', ...(p.truncated ? ['Page truncated at 6,000 characters.'] : [])], links: [] });
            }
          } catch (e) { issue(run, { ...job, title: file.title }, e.message, 'attachment'); }
        }
        // Recheck account/permission after parsing; PDF bytes never leave this browser.
        const parsedState = await state();
        if (!parsedState.settings.enabled || parsedState.binding !== account.binding || parsedState.run?.id !== run.id || parsedState.run.status !== 'running') return;
        for (const page of additional) {
          page.courseId = job.course;
          page.selectedSource = job.pinned === true;
          page.title = `${run.courses.find(c => c.id === job.course)?.title || 'Course'} · ${page.title}`.slice(0,180);
          const merged = putSnapshot(s.pages, page); s.pages = merged.pages; run.read++; if (merged.changed) run.changed++; if (merged.evicted) run.limited = true;
        }
        if (result.page) {
          result.page.description = job.description || "";
          if (job.course) result.page.title = `${run.courses.find(c => c.id === job.course)?.title || "Course"} · ${job.pinned ? `${job.title} · ${result.page.title}` : job.url.startsWith("https://docs.google.com/") ? job.title : result.page.title}`.slice(0, 180);
          result.page.courseId = job.course;
          result.page.selectedSource = job.pinned === true;
          const merged = putSnapshot(s.pages, result.page); s.pages = merged.pages;
          run.read++; if (merged.changed) run.changed++; if (merged.evicted) run.limited = true;
        }
        if (result.empty) issue(run, job, "Too little readable text. Dynamic/file content may not have loaded.");
        if (result.linkLimit || result.page?.warnings.some(w => w.includes("6,000"))) run.limited = true;
        for (const title of result.attachments) issue(run, { ...job, title }, "Not read: attachment, embedded file or external tool. Open its source to inspect it.", "attachment");
        const jobs = [];
        // Only traverse links reached from enrolled course pages, not from the
        // global gradebook or course directory (which can include other links).
        if (job.course) for (const link of result.links) {
          const url = schoolUrl(link.url, SCHOOL), doc = googleUrl(link.url);
          if (url) {
            const course = /\/course\/(\d+)/.exec(url)?.[1] || job.course;
            if (run.courses.some(c => c.id === course)) {
              const traverse = /\/materials(?:\?|$)|\/updates/.test(url);
              const decision = readingPriority(url, link.title, link.description);
              if (traverse || decision.level === "important") jobs.push({ url, title: link.title, description: link.description || "", course });
              else { const entry = await describeSource(url, link, job.url, course); const stored = putSnapshot(s.pages, entry); s.pages = stored.pages; if (stored.evicted) run.limited = true; }
            }
          } else if (doc) {
            const decision = readingPriority(doc, link.title, link.description);
            if (s.settings.google && decision.level === "important") jobs.push({ url: doc, title: link.title, description: link.description || "", course: job.course });
            else {
              const entry = await describeSource(doc, link, job.url, job.course); const stored = putSnapshot(s.pages, entry); s.pages = stored.pages; if (stored.evicted) run.limited = true;
              if (!s.settings.google && decision.level === "important") issue(run, { url: doc, title: link.title }, "Not read: linked Google Docs/Slides access is off.");
            }
          } else {
            run.limited = true;
            issue(run, { ...job, title: link.title }, "Linked source was not followed: unsupported URL or pagination/size limit.", "attachment");
          }
        }
        const lastRead = new Map(s.pages.map(p => [p.url, p.capturedAt]));
        // New/oldest cached links first within each course's fair share; one
        // large class must not consume the entire sweep before other classes.
        jobs.sort((a, b) => (lastRead.get(a.url) || "").localeCompare(lastRead.get(b.url) || ""));
        addJobs(run, jobs);
      }
      if (!run.queue.length) {
        if (run.status === "running") run.status = run.unreadCount || run.limited ? "partial" : "checked";
        run.finishedAt = new Date().toISOString();
        if (!run.message.includes("attention") && run.status !== "login-required") run.message = "Text sweep finished. Coverage is limited to discovered links and readable excerpts, not every file or submission state.";
      } else run.message = `Reading discovered course pages · ${run.visited.length} checked, ${run.queue.length} queued.`;
      const permission = await ownedGet(["syncSettings", "syncRun"]);
      if (!permission.syncSettings?.enabled || permission.syncRun?.id !== run.id || permission.syncRun.status !== "running") return;
      await ownedSet({ syncRun: run, syncPages: s.pages });
      await chrome.action.setBadgeText({ text: run.status === "running" ? "…" : run.status === "checked" ? "" : "!" });
      await pause(650);
    }
    if (run.status !== "running") await closeOwned(run);
    const final = await state(); if (final.settings.enabled) await deliver(final);
  } finally { working = false; }
}
export function installScheduler() {
  chrome.tabs.onActivated.addListener(({ tabId }) => { void (async () => {
    const { syncRun } = await ownedGet("syncRun");
    if (syncRun?.schoolTab === tabId || syncRun?.docsTab === tabId) {
      const saved = await chrome.storage.session.get("syncAdoptedTabs");
      await chrome.storage.session.set({ syncAdoptedTabs: [...new Set([...(saved.syncAdoptedTabs || []), tabId])].slice(-100) });
    }
  })().catch(() => {}); });
  const start = async () => { const s = await state(); if (s.settings.enabled) { await ensureAlarm(); await tick(); } };
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void tick().catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => void start().catch(() => {}));
  chrome.runtime.onInstalled.addListener(() => void start().catch(() => {}));
  chrome.permissions.onRemoved.addListener(() => void start().catch(() => {}));
  // MV3 workers can restart without a browser onStartup event.
  void start().catch(() => {});
}
