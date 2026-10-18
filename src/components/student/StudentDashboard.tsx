"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { studentHeaders, signalAccountChange, type StudentSession } from "@/lib/student/accountTypes";
import { SCHOOL_TIMEZONE, dateLabel, dayKey, offsetDay, type StudyDashboard, type StudyItem, type SourceId, type SourceState } from "@/lib/student/types";
import { Icon, RelayMark, type IconName } from "./Icons";
import SetupGuide from "./SetupGuide";
import CourseReader, { ReaderImportDialog, DraftCard } from "./CourseReader";
import ReaderBrief from "./ReaderBrief";
import { useCourseReader } from "./useCourseReader";

type View = "overview" | "assignments" | "calendar" | "updates" | "mail" | "connections";
const NAV: { id: View; name: string; icon: IconName }[] = [
  { id: "overview", name: "Overview", icon: "board" }, { id: "assignments", name: "Assignments", icon: "book" }, { id: "calendar", name: "Calendar", icon: "calendar" }, { id: "updates", name: "School updates", icon: "globe" }, { id: "mail", name: "School mail", icon: "mail" }, { id: "connections", name: "Setup & connections", icon: "link" },
];
const SOURCES: Record<SourceId, { name: string; icon: IconName; short: string }> = {
  district: { name: "District website", icon: "globe", short: "District" }, schoology: { name: "Schoology calendar", icon: "book", short: "Schoology" }, gmail: { name: "School email", icon: "mail", short: "Gmail" }, reader: { name: "Browser reader", icon: "book", short: "Course excerpt" },
};
const TITLES: Record<View, [string, string]> = {
  overview: ["Your day, in view.", "Less checking everywhere. More knowing what’s next."],
  assignments: ["A place for every deadline.", "Your Schoology assignments and course events, together."],
  calendar: ["See the week ahead.", "Course deadlines and district events on one timeline."],
  updates: ["Around your school.", "The latest announcements, straight from the district website."],
  mail: ["The messages that matter.", "School email, without the rest of your inbox."],
  connections: ["Course setup",  "One setup. A clear path from your school portal to your assignments."],
};
function Panel({ title, eyebrow, action, children, className = "" }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`rs-panel ${className}`}><header className="rs-panel-heading"><div>{eyebrow && <span className="rs-eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{action}</header>{children}</section>;
}
function Empty({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: ReactNode }) {
  return <div className="rs-empty"><span className="rs-empty-icon"><Icon name={icon} size={26}/></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function SourceTag({ source }: { source: SourceId }) {
  return <span className={`rs-source-tag rs-${source}`}><span/>{SOURCES[source].short}</span>;
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="rs-dialog" aria-labelledby="rs-dialog-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="rs-dialog-inner"><header><h2 id="rs-dialog-title">{title}</h2><button className="rs-icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button></header>{children}</div></dialog>;
}

export default function StudentDashboard({ initialNow, account, onChooseDistrict, onLogout }: { initialNow: string; account: StudentSession; onChooseDistrict: () => void; onLogout: () => void }) {
  const { district } = account;
  const SCHOOLOGY_URL = district.schoology, DISTRICT_URL = district.website, CALENDAR_URL = district.calendar;
  const reader = useCourseReader(account);
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<StudyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudyItem | null>(null);
  const [connect, setConnect] = useState<"schoology" | "gmail" | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [connectError, setConnectError] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("Upcoming");
  const [done, setDone] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(initialNow);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const pending = useRef(false);
  const lastFetch = useRef(0);
  const today = dayKey(now);
  const assignmentDrafts = reader.state.cards.filter(c => c.status === "draft" && (c.kind === "assignment" || c.kind === "event"));
  const readerItems: StudyItem[] = reader.state.cards.filter(c => c.status === "accepted" && (c.kind === "assignment" || c.kind === "event")).map(c => ({ id: c.id, source: "reader", kind: c.kind === "event" ? "event" : "assignment", title: c.title, description: "AI-extracted from an imported excerpt, then reviewed by you. This is not a live Schoology status or a verified submission.", url: c.sourceUrl, date: c.due, allDay: true, course: c.course, requirement: c.requirement, evidence: c.quote }));
  const items = [...(data?.items ?? []), ...readerItems].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  const sources: SourceState[] = [...(data?.sources ?? []), { id: "reader", status: reader.state.dailyReport?.status === "login-required" ? "error" : reader.state.pages.length ? "connected" : "disconnected", message: reader.state.dailyReport?.message || "Timestamped browser snapshots. Daily course reading is optional; AI drafts still need review.", checkedAt: reader.state.pages.map(p => p.capturedAt).sort().at(-1) ?? null }];
  const source = (id: SourceId) => sources.find(s => s.id === id);
  const connected = sources.filter(s => s.status === "connected").length;
  const schoology = source("schoology");
  const hasSchoology = schoology?.status === "connected" || schoology?.status === "error" || reader.state.pages.length > 0;
  const homework = items.filter(i => i.source === "schoology" || i.source === "reader");
  const completionProfile = `${account.scope}:${data?.schoologyProfile ?? "browser-reader"}`;
  useEffect(() => { if (reader.incoming) { setView("connections"); setQuery(""); setDetail(null); setConnect(null); window.scrollTo({ top: 0, left: 0, behavior: "auto" }); } }, [reader.incoming]);
  useEffect(() => { if (detail?.source === "reader" && !reader.state.cards.some(c => c.id === detail.id && c.status === "accepted")) setDetail(null); }, [reader.state.cards, detail]);
  const upcoming = items.filter(i => i.kind === "event" || i.kind === "assignment").filter(i => i.date && dayKey(i.date) >= today);
  const news = items.filter(i => i.kind === "announcement");
  const mail = items.filter(i => i.kind === "mail").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const weekEnd = offsetDay(today, 6);
  const dueSoon = homework.filter(i => i.date && dayKey(i.date) >= today && dayKey(i.date) <= weekEnd && !done.includes(i.id));

  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const generation = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const res = await fetch("/api/student/dashboard", { cache: "no-store", signal: abort.signal, headers: studentHeaders(account) });
      if (res.status === 401 || res.status === 409) { signalAccountChange(); throw new Error("Account changed. Refreshing your private workspace."); }
      if (!res.ok) throw new Error("Your sources could not be checked. Try refreshing in a moment.");
      const next = await res.json() as StudyDashboard;
      if (generation !== sequence.current) return;
      setData(previous => {
        if (!previous) return next;
        const failed = new Set(next.sources.filter(s => s.status === "error").map(s => s.id));
        return { ...next, items: [...next.items, ...previous.items.filter(i => failed.has(i.source))], sources: next.sources.map(s => s.status === "error" ? { ...s, checkedAt: previous.sources.find(old => old.id === s.id)?.checkedAt ?? null } : s) };
      });
      lastFetch.current = Date.now();
      setNow(new Date().toISOString());
      setError("");
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Refresh failed."); }
    finally { if (generation === sequence.current) { pending.current = false; setLoading(false); } }
  }, [account.binding]);
  useEffect(() => {
    void refresh();
    const check = () => { setNow(new Date().toISOString()); if (document.visibilityState === "visible" && navigator.onLine && Date.now() - lastFetch.current > 60_000) void refresh(); };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    const parameters = new URL(location.href).searchParams;
    if (parameters.get("reader") === "import") setView("connections");
    const connection = parameters.get("connection");
    if (connection) {
      const messages: Record<string, string> = { gmail_connected: "School email connected. Your recent school messages are ready to check.", gmail_denied: "Email wasn’t connected. No new email access was saved.", gmail_setup: "Google OAuth must be configured before email can connect.", gmail_api: "Enable the Gmail API in Google Cloud, or ask your school administrator to allow access.", gmail_state: "That authorization link expired. Start the connection again.", gmail_failed: "Google could not complete authorization. Check OAuth settings and school permissions, then try again." };
      setNotice(messages[connection] ?? "Check your email connection in Connections.");
      const clean = new URL(location.href); clean.searchParams.delete("connection"); window.history.replaceState(null, "", clean);
    }
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", check); window.removeEventListener("online", check); window.removeEventListener("focus", check); controller.current?.abort(); sequence.current++; pending.current = false; };
  }, [refresh]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`relay-study-done:${completionProfile}`) ?? "[]");
      setDone(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string").slice(0, 5000) : []);
    } catch { setDone([]); }
  }, [completionProfile]);

  function navigate(next: View) { setView(next); setQuery(""); setSelectedDay(null); const url = new URL(location.href); if (next === "connections") url.searchParams.set("reader", "import"); else url.searchParams.delete("reader"); history.replaceState(null, "", url); window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }
  function openConnect(which: "schoology" | "gmail") { setConnectError(""); setFeedUrl(""); setConnect(which); }
  function invalidate() { controller.current?.abort(); sequence.current++; pending.current = false; }
  async function connectCalendar(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setConnectError(""); invalidate(); pending.current = true;
    try {
      const response = await fetch("/api/student/schoology", { method: "POST", headers: { "Content-Type": "application/json", ...studentHeaders(account) }, body: JSON.stringify({ url: feedUrl }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Connection failed.");
      setFeedUrl(""); setConnect(null); setNotice("Schoology calendar connected. Submission status stays in Schoology.");
      setDetail(null);
      setData(old => old ? { ...old, items: old.items.filter(i => i.source !== "schoology") } : old);
      pending.current = false;
      await refresh();
    } catch (e) { setConnectError(e instanceof Error ? e.message : "Connection failed."); }
    finally { pending.current = false; setSaving(false); setLoading(false); }
  }
  async function disconnect(id: "schoology" | "gmail") {
    if (!window.confirm(`Disconnect ${SOURCES[id].name} from this browser? Its items will disappear from Relay.`)) return;
    setSaving(true); invalidate(); pending.current = true;
    try {
      const res = await fetch(id === "schoology" ? "/api/student/schoology" : "/api/student/gmail/disconnect", { method: id === "schoology" ? "DELETE" : "POST", headers: studentHeaders(account) });
      if (!res.ok) throw new Error("Disconnect failed. Please try again.");
      if (id === "schoology" && data?.schoologyProfile) { try { localStorage.removeItem(`relay-study-done:${account.scope}:${data.schoologyProfile}`); } catch {} setDone([]); }
      setDetail(null);
      setData(old => old ? { ...old, items: old.items.filter(i => i.source !== id), sources: old.sources.map(s => s.id === id ? { ...s, status: "disconnected", checkedAt: null, account: undefined } : s), schoologyProfile: id === "schoology" ? null : old.schoologyProfile } : old);
      setNotice(`${SOURCES[id].name} disconnected from this browser.`);
      pending.current = false;
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Disconnect failed."); }
    finally { pending.current = false; setSaving(false); setLoading(false); }
  }
  function toggleDone(item: StudyItem) {
    const next = done.includes(item.id) ? done.filter(id => id !== item.id) : [...done, item.id];
    setDone(next);
    try { localStorage.setItem(`relay-study-done:${completionProfile}`, JSON.stringify(next)); } catch { setNotice("This browser cannot save your checkmarks. They will reset when you leave."); }
  }
  const connectButton = <button className="rs-button rs-primary" onClick={() => navigate("connections")}>Connect Schoology <Icon name="arrow" size={16}/></button>;
  const allAction = (target: View, label = "View all") => <button className="rs-text-button" onClick={() => navigate(target)}>{label}<Icon name="arrow" size={16}/></button>;
  const row = (item: StudyItem, allowDone = false) => <div className={`rs-item ${done.includes(item.id) ? "rs-completed" : ""}`} key={item.id}>
    {allowDone ? <button className="rs-complete-button" aria-label={`${done.includes(item.id) ? "Unmark" : "Mark"} ${item.title} as done in Relay`} aria-pressed={done.includes(item.id)} onClick={() => toggleDone(item)}>{done.includes(item.id) && <Icon name="check" size={14}/>}</button> : <span className={`rs-item-icon rs-${item.source}`}><Icon name={item.kind === "mail" ? "mail" : item.kind === "announcement" ? "globe" : "calendar"} size={18}/></span>}
    <button className="rs-item-body" onClick={() => setDetail(item)}><span className="rs-item-title">{item.title}</span><span className="rs-item-meta"><SourceTag source={item.source}/>{item.course && <span>{item.course}</span>}{item.requirement && <span className={item.requirement === "unclear" ? "rs-warning-text" : ""}>{item.requirement === "unclear" ? "Requirement unconfirmed" : item.requirement === "optional" ? "Optional practice" : "Required"}</span>}{item.date && <span>{dateLabel(item.date)}{!item.allDay && item.kind !== "mail" ? ` · ${dateLabel(item.date, { month: undefined, day: undefined, hour: "numeric", minute: "2-digit" })}` : ""}</span>}{(item.source === "schoology" || item.source === "reader") && !item.date && <span className="rs-warning-text">Date needs confirmation</span>}{item.source === "schoology" && item.date && dayKey(item.date) < today && !done.includes(item.id) && <span className="rs-warning-text">Past date · check submission</span>}</span></button><Icon name="chevron" size={16}/>
  </div>;
  function calendarRibbon() {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const start = offsetDay(today, -((weekday + 6) % 7) + weekOffset * 7);
    const days = Array.from({ length: 7 }, (_, i) => offsetDay(start, i));
    return <section className="rs-week" aria-label="Weekly calendar"><header><div><Icon name="calendar" size={17}/><h2>{weekOffset === 0 ? "This week" : "Your week"}</h2><span>{dateLabel(start)} — {dateLabel(days[6])}</span></div><div><button className="rs-text-button" onClick={() => { setWeekOffset(0); setSelectedDay(null); }}>Today</button><button className="rs-icon-button" aria-label="Previous week" onClick={() => setWeekOffset(n => n - 1)}><Icon name="chevron" size={16} style={{ transform: "rotate(180deg)" }}/></button><button className="rs-icon-button" aria-label="Next week" onClick={() => setWeekOffset(n => n + 1)}><Icon name="chevron" size={16}/></button></div></header><div className="rs-days">{days.map(day => {
      const events = items.filter(i => i.kind !== "mail" && i.date && dayKey(i.date) === day);
      return <button key={day} className={`rs-day ${day === today ? "rs-today" : ""} ${day === selectedDay ? "rs-selected-day" : ""}`} aria-label={`${dateLabel(day, { weekday: "long" })}, ${events.length} imported entries`} aria-pressed={day === selectedDay} onClick={() => { setSelectedDay(day === selectedDay ? null : day); if (view !== "overview" && view !== "calendar") setView("calendar"); }}><span className="rs-day-name">{dateLabel(day, { month: undefined, day: undefined, weekday: "short" })}{day === today && <i/>}</span><strong>{Number(day.slice(-2))}</strong><span className="rs-day-preview">{events[0]?.title ?? (day === today ? "Today" : "—")}</span><span className="rs-day-dots">{events.slice(0, 4).map(e => <i key={e.id} className={`rs-${e.source}`}/>)}{events.length > 4 && <small>+{events.length - 4}</small>}</span></button>;
    })}</div>{!hasSchoology && <p className="rs-week-note">Only connected calendar entries and reviewed tasks appear here. Course drafts appear separately in Assignments.</p>}</section>;
  }
  const schoolList = homework.filter(i => filter === "Done in Relay" ? done.includes(i.id) : !done.includes(i.id) && (filter === "All dates" || !i.date || dayKey(i.date) >= today));
  const searchResults = items.filter(i => `${i.title} ${i.description} ${i.course ?? ""} ${i.sender ?? ""}`.toLowerCase().includes(query.toLowerCase().trim()));
  const eventList = selectedDay ? items.filter(i => i.kind !== "mail" && i.date && dayKey(i.date) === selectedDay) : upcoming;

  return <div className={`rs-app ${view === "connections" ? "rs-setup-view" : ""}`}>
    <a href="#rs-main" className="rs-skip">Skip to dashboard</a>
    <aside className="rs-sidebar"><a href="/" className="rs-brand" aria-label="Relay home"><RelayMark/><span>relay<span className="rs-brand-dot">.</span></span></a><span className="rs-sidebar-caption">A little more headspace.</span>
      <div className="rs-school"><span className="rs-school-monogram">{district.short[0]}</span><div><strong>{account.school?.name || district.short}</strong><span>{district.short} · Student workspace</span></div><Icon name="shield" size={16}/></div>
      <span className="rs-nav-label">YOUR SPACE</span><nav aria-label="Main navigation">{NAV.map(item => <button key={item.id} className={view === item.id ? "rs-active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.name}</span>{item.id === "mail" && mail.length > 0 && <small>{mail.length}</small>}{item.id === "connections" && <i className={connected === 4 ? "rs-dot-connected" : ""}/>}</button>)}</nav>
      <div className="rs-sidebar-bottom"><div className="rs-private-note"><Icon name="shield" size={19}/><strong>Your school day. Your data.</strong><p>Read-only school access. No submissions or messages sent.</p></div><a href={SCHOOLOGY_URL} target="_blank" rel="noopener noreferrer" className="rs-school-link">Open Schoology <Icon name="external" size={15}/></a><div className="rs-profile"><span>{account.user.name.slice(0, 1).toUpperCase()}</span><div><strong>{account.user.name}</strong><small>Account-private · this browser</small></div></div></div>
    </aside>
    <div className="rs-workspace"><header className="rs-topbar"><div className="rs-breadcrumb">Workspace <span>/</span><strong>{NAV.find(n => n.id === view)?.name}</strong></div><label className="rs-search"><Icon name="search" size={17}/><input aria-label="Search connected sources" placeholder="Find something in your day…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="rs-icon-button" onClick={() => setQuery("")} aria-label="Clear search"><Icon name="close" size={14}/></button>}</label><button className="rs-refresh rs-icon-button" aria-label="Refresh sources" title="Refresh sources" disabled={loading || saving} onClick={() => void refresh()}><Icon name="refresh" size={18}/></button><span className="rs-avatar" title={account.user.email}>{account.user.name.slice(0, 1).toUpperCase()}</span></header>
      <div className="sa-account-strip"><span>{account.user.email} · {district.short}</span><button onClick={onChooseDistrict}>Change school</button><button onClick={onLogout}>Sign out</button></div>
      <main id="rs-main" className="rs-main"><div className="rs-page-heading"><div><span className="rs-date"><Icon name="sun" size={15}/>{dateLabel(today, { weekday: "long", month: "long", year: "numeric" })}</span><h1>{query.trim() ? "Find your next thing." : TITLES[view][0]}</h1><p>{query.trim() ? `Searching your connected sources for “${query.trim()}”` : TITLES[view][1]}</p></div><button className="rs-source-status" onClick={() => navigate("connections")}><span className={connected > 0 ? "rs-status-dot" : "rs-status-dot rs-offline"}/>{reader.analyzing ? "Analyzing instructions…" : assignmentDrafts.length ? `${assignmentDrafts.length} assignment drafts` : reader.state.pages.length ? `${reader.state.pages.length} sources saved · AI ${reader.automation.autoAi ? "on" : "off"}` : "Set up your courses"}<Icon name="chevron" size={14}/></button></div>
        {notice && <div className="rs-notice" role="status">{notice}<button className="rs-icon-button" aria-label="Dismiss message" onClick={() => setNotice("")}><Icon name="close" size={16}/></button></div>}
        {error && <div className="rs-error" role="alert">{error} {data && "Previously loaded items are still shown."}<button onClick={() => void refresh()}>Try again</button></div>}
        {sources.some(s => s.status === "error") && <div className="rs-error" role="status">{sources.filter(s => s.status === "error").map(s => `${SOURCES[s.id].name}: ${s.message}${s.checkedAt ? ` Showing items last checked ${dateLabel(s.checkedAt, { hour: "numeric", minute: "2-digit" })}.` : ""}`).join(" ")}<button onClick={() => navigate("connections")}>Manage connections</button></div>}
        {sources.some(s => s.warnings?.length) && <div className="rs-error" role="status">{sources.flatMap(s => s.warnings ?? []).join(" ")}</div>}
        {loading && !data && <div className="rs-loading" role="status"><span/>Checking the district website and your connected sources…</div>}
        {query.trim() ? <Panel title={`${searchResults.length} results`} eyebrow="ACROSS YOUR SOURCES">{searchResults.length ? searchResults.map(i => row(i)) : <Empty icon="search" title="Nothing matches yet" text="Try a shorter search, or connect another source."/>}</Panel> : <>
          {view === "overview" && <SetupGuide reader={reader} compact onSetup={() => navigate("connections")} onAssignments={() => navigate("assignments")} onChooseSchool={onChooseDistrict}/>}
          {(view === "overview" || view === "calendar") && calendarRibbon()}
          {view === "overview" && <>
            {(reader.state.dailyReport || reader.state.cards.some(c => c.status === "draft")) && <div className="rs-notice rr-overview-sync"><span><strong>{reader.state.cards.filter(c => c.status === "draft").length} study drafts to review</strong>{reader.state.dailyReport && <> · Course reader: {reader.state.dailyReport.status.replaceAll("-", " ")} · {reader.state.dailyReport.changed} changed excerpts · {reader.state.dailyReport.unreadCount} unread notices. {reader.state.dailyReport.status === "login-required" && "Sign into Schoology, then retry from the extension."}</>}</span>{allAction("connections", "Review course check")}</div>}
            <ReaderBrief reader={reader}/>
            <div className="rs-overview-grid"><div className="rs-main-column"><Panel title="On your radar" eyebrow="YOUR SCHOOLWORK" action={allAction("assignments")} className="rs-homework-panel">
              {!hasSchoology ? <div className="rs-connect-homework"><div className="rs-paper-stack" aria-hidden="true"><div/><div/><div><span/><span/><span/><Icon name="check" size={21}/></div></div><div><span className="rs-mini-label">ONE LESS TAB TO CHECK</span><h3>Your course pages,<br/>made actionable.</h3><p>Bring the instructions inside your course pages here.<br/>Review every extracted task before it joins your board.</p>{connectButton}<span className="rs-fine-print">Read-only · No school password needed</span></div></div> : <><div className="rs-homework-summary"><strong>{dueSoon.length}</strong><div><b>upcoming in the next 7 days</b><span>Imported entries & reviewed cards · not submission status</span></div><Icon name="book" size={32}/></div>{schoolList.slice(0, 5).map(i => row(i, true))}{schoolList.length === 0 && <Empty icon="check" title={reader.state.pages.length && !readerItems.length ? "Your excerpts are ready to review" : "No upcoming entries in this view"} text="With automatic AI enabled, Relay organizes important instructions in the course brief above. A quiet board does not confirm that all work is submitted." action={reader.state.pages.length ? allAction("connections", "Open course reader") : undefined}/>}</>}
            </Panel><Panel title={selectedDay ? dateLabel(selectedDay, { weekday: "long" }) : "Coming up"} eyebrow="DATES TO KEEP IN MIND" action={selectedDay ? <button className="rs-text-button" onClick={() => setSelectedDay(null)}>Show upcoming</button> : allAction("calendar", "Calendar")}>
              {eventList.length ? eventList.slice(0, 4).map(item => <button className="rs-agenda-item" key={item.id} onClick={() => setDetail(item)}><span className={`rs-date-tile ${item.title.toLowerCase().includes("no classes") ? "rs-break" : ""}`}><small>{dateLabel(item.date!, { day: undefined, month: "short" })}</small><strong>{Number(dayKey(item.date!).slice(-2))}</strong></span><span className="rs-agenda-copy"><strong>{item.title}</strong><span>{item.allDay ? (item.source === "reader" ? "Date only · check class time" : "All day") : dateLabel(item.date!, { month: undefined, day: undefined, weekday: "short", hour: "numeric", minute: "2-digit" })}{item.location ? ` · ${item.location}` : ""}</span></span><SourceTag source={item.source}/><Icon name="chevron" size={16}/></button>) : <Empty icon="calendar" title={selectedDay ? "Nothing imported for this day" : "No upcoming events loaded"} text="Only dates from connected sources appear here."/>}
            </Panel></div><div className="rs-side-column"><section className="rs-brief"><span className="rs-eyebrow"><span className="rs-little-spark">✳</span> THE SHORT VERSION</span><h2>{hasSchoology ? "A clearer next step." : "Start with your school day."}</h2><p>{hasSchoology ? `${dueSoon.length} imported ${dueSoon.length === 1 ? "entry is" : "entries are"} coming up in the next seven days. ${news.length} district ${news.length === 1 ? "update is" : "updates are"} available below.` : "Start with guided setup above. Your school portal is linked directly; reading and AI analysis each show their own status."}</p>{upcoming[0] && <button onClick={() => setDetail(upcoming[0])}><span>NEXT ON THE CALENDAR</span><strong>{upcoming[0].title}</strong><small>{dateLabel(upcoming[0].date!, { weekday: "short" })}<Icon name="arrow" size={16}/></small></button>}<span className="rs-brief-foot">Built from source records. No guessed deadlines.</span></section>
              <Panel title="The school bulletin" action={allAction("updates", "All updates")}>{news.length ? news.slice(0, 3).map((item, i) => <button className="rs-news-item" key={item.id} onClick={() => setDetail(item)}><span className={`rs-news-symbol rs-news-${i % 3}`}><Icon name={i === 0 ? "globe" : "book"} size={20}/></span><span><SourceTag source="district"/><strong>{item.title}</strong><small>Official district announcement <Icon name="external" size={12}/></small></span></button>) : <Empty icon="globe" title={loading ? "Checking the bulletin…" : "No announcements loaded"} text={district.id === "fuhsd" ? "Relay reads the public FUHSD website. Source errors appear above." : "PAUSD public news is not connected yet. No other district’s announcements are shown."}/>}</Panel>
              <button className="rs-mail-invite" onClick={() => mail.length ? navigate("mail") : openConnect("gmail")}><span className="rs-mail-illustration"><Icon name="mail" size={25}/></span><span><strong>{mail.length ? `${mail.length} school messages` : "Less inbox. More insight."}</strong><small>{mail.length ? "See your recent school email" : "Bring school email into Relay"}</small></span><Icon name="arrow" size={17}/></button>
            </div></div><div className="rs-source-strip"><div><Icon name="link" size={17}/><strong>Connected to your day</strong></div>{(["district", "schoology", "gmail", "reader"] as const).map(id => <button key={id} onClick={() => navigate("connections")}><Icon name={SOURCES[id].icon} size={16}/>{SOURCES[id].name}<span className={`rs-small-status ${source(id)?.status === "connected" ? "rs-is-connected" : ""}`}>{source(id)?.status === "connected" ? (id === "reader" ? "Saved locally" : "Connected") : source(id)?.status === "error" ? "Needs attention" : "Not connected"}</span></button>)}</div>
          </>}
          {view === "assignments" && <><SetupGuide reader={reader} compact onSetup={() => navigate("connections")} onAssignments={() => document.getElementById("assignment-drafts")?.scrollIntoView({ block: "start" })}/>{assignmentDrafts.length > 0 && <section className="sg-assignment-drafts" id="assignment-drafts"><h2>Unreviewed assignment drafts · {assignmentDrafts.length}</h2><p>These are AI interpretations, not verified tasks or submission states. Check the quote and date before adding a draft to your board.</p><div className="rr-drafts">{assignmentDrafts.map(card => <DraftCard key={`${card.id}:${card.status}`} card={card} reader={reader}/>)}</div></section>}<Panel title="Assignments & course events" action={<a className="rs-text-button" href={SCHOOLOGY_URL} target="_blank" rel="noopener noreferrer">Open Schoology <Icon name="external" size={14}/></a>}>{!hasSchoology ? <Empty icon="book" title="Your real homework belongs here" text="Use the browser reader to import course text, or connect a Schoology calendar feed. AI drafts only appear here after your review." action={connectButton}/> : <><div className="rs-filters" aria-label="Filter schoolwork">{["Upcoming", "All dates", "Done in Relay"].map(f => <button key={f} aria-pressed={filter === f} className={filter === f ? "rs-filter-active" : ""} onClick={() => setFilter(f)}>{f}</button>)}</div><p className="rs-panel-note">Checkmarks stay on this browser and do not submit work. Calendar feeds cover the last 30 / next 180 days; reader cards are snapshots you reviewed, not live submission status.</p>{schoolList.length ? schoolList.map(i => row(i, true)) : <Empty icon="book" title="No entries in this view" text={assignmentDrafts.length ? "Review the draft assignments above. They are separate from your accepted board." : "No accepted tasks yet. Check the setup status above or open the course portal; this does not mean there is no homework."}/>}</>}</Panel></>}
          {view === "calendar" && <Panel title={selectedDay ? dateLabel(selectedDay, { weekday: "long" }) : "Upcoming dates"} action={<a className="rs-text-button" href={CALENDAR_URL} target="_blank" rel="noopener noreferrer">{district.id === "fuhsd" ? "District calendar" : "District website"} <Icon name="external" size={14}/></a>}>{eventList.length ? eventList.map(i => row(i)) : <Empty icon="calendar" title="No imported entries" text="Choose another day or check your connected sources."/>}<p className="rs-panel-note">All times in Pacific time ({SCHOOL_TIMEZONE}). Imported calendar coverage may be incomplete.</p></Panel>}
          {view === "updates" && <Panel title={`Latest from ${district.short}`} action={<a className="rs-text-button" href={district.id === "fuhsd" ? `${DISTRICT_URL}/newsroom` : DISTRICT_URL} target="_blank" rel="noopener noreferrer">{district.id === "fuhsd" ? "District newsroom" : "District website"} <Icon name="external" size={14}/></a>}><p className="rs-panel-note">District-wide announcements, not individual school bulletins. Publication dates are only shown when provided by the source.</p>{news.length ? news.map(i => row(i)) : <Empty icon="globe" title="No announcements loaded" text={district.id === "fuhsd" ? "Refresh to check the district website again." : "Public district news is not supported here yet. Use the district website link; repeated refreshes will not connect it."}/>}</Panel>}
          {view === "mail" && <Panel title="Your school inbox" action={source("gmail")?.status !== "connected" ? <button className="rs-text-button" onClick={() => openConnect("gmail")}>Connect email <Icon name="arrow" size={14}/></button> : undefined}>{mail.length ? <><p className="rs-panel-note">Up to 12 inbox messages from {district.short} and Schoology in the last 30 days. These are original message previews, not AI-generated summaries. Email dates are received dates, not deadlines.</p>{mail.map(i => row(i))}</> : <Empty icon="mail" title={source("gmail")?.status === "connected" ? "No matching school messages" : "Your school mail, in one place"} text={source("gmail")?.status === "connected" ? `No recent messages matched the ${district.short} and Schoology sender filter.` : "Connect Gmail with read-only permission. Relay only fetches recent school message headers and previews, never attachments."} action={source("gmail")?.status !== "connected" ? <button className="rs-button rs-primary" onClick={() => openConnect("gmail")}>Connect school email <Icon name="arrow" size={16}/></button> : undefined}/>}</Panel>}
          {view === "connections" && <><SetupGuide reader={reader} onAssignments={() => navigate("assignments")} onChooseSchool={onChooseDistrict}/><details className="sg-secondary" id="reader-advanced"><summary>Coverage &amp; advanced source tools</summary><CourseReader reader={reader}/></details><details className="sg-secondary"><summary>Optional extras · calendar feed, school email &amp; district updates</summary><div className="rs-connection-grid">{(["schoology", "gmail", "district"] as const).map(id => {
            const state = source(id); const active = state?.status === "connected" || state?.status === "error";
            return <section className="rs-connection-card" key={id}><div className="rs-connection-top"><span className={`rs-connection-icon rs-${id}`}><Icon name={SOURCES[id].icon} size={27}/></span><span className={`rs-small-status ${state?.status === "connected" ? "rs-is-connected" : ""}`}>{state?.status === "connected" ? "Connected" : state?.status === "error" ? "Needs attention" : state?.status === "setup_required" ? "Setup required" : "Not connected"}</span></div><h2>{SOURCES[id].name}</h2><p>{id === "schoology" ? "Your assignments and course events, from your personal calendar subscription." : id === "gmail" ? "Recent school messages from your Gmail inbox. Read-only, with your permission." : "Public district announcements and calendar events. No login required."}</p>{state?.account && <span className="rs-account">{state.account}</span>}<div className="rs-connection-facts"><span><Icon name="check" size={14}/>{id === "schoology" ? "Deadlines & calendar entries" : id === "gmail" ? "Subject, sender & message preview" : "Official public sources"}</span><span><Icon name="shield" size={14}/>{id === "district" ? "Public pages cached up to 15 minutes" : "Encrypted connection in this browser"}</span></div><small className="rs-connection-message">{state?.message ?? "Checking connection…"}</small><div className="rs-connection-actions">{id === "district" ? <a className="rs-button" href={DISTRICT_URL} target="_blank" rel="noopener noreferrer">Visit district website <Icon name="external" size={15}/></a> : <><button className="rs-button rs-primary" disabled={saving || (id === "gmail" && state?.status === "setup_required")} onClick={() => openConnect(id)}>{active ? "Reconnect" : "Connect"} {id === "gmail" ? "Gmail" : "Schoology"}<Icon name="arrow" size={15}/></button>{active && <button className="rs-text-button rs-disconnect" disabled={saving} onClick={() => void disconnect(id)}>Disconnect</button>}</>}</div></section>;
          })}</div></details><details className="sg-secondary"><summary>Privacy &amp; permissions</summary><section className="rs-privacy-panel"><Icon name="shield" size={27}/><div><h2>A connection, not a copy of your school account.</h2><p>Relay processes calendar and email data on its server, but does not send that data to AI. Browser-reader excerpts and reviewed cards stay in this browser’s storage; excerpts are sent to Relay’s server and AI provider only through a manual analysis you consent to, or a separately enabled recurring AI permission. The extension can collect daily snapshots while Chrome runs; automatic AI runs when this dashboard is visible. No assignment text or email is stored in Relay’s database; AI usage counts are stored for limits. Connection credentials are encrypted in HTTP-only browser cookies for up to 30 days. Connections and encrypted reader storage are scoped to your Relay account and district. Sign out on shared computers; this does not protect an already signed-in session from someone with access to your device.</p><p>Schoology calendar export must be enabled by your school. Google may require administrator approval or a verified OAuth app. Relay is an independent project, not affiliated with either district or Schoology.</p><a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Manage or revoke Google access <Icon name="external" size={13}/></a></div></section></details></>}
        </>}
        <footer className="rs-footer"><span>relay<span>·</span>A calmer school day.</span><span>{data ? `Last checked ${dateLabel(data.fetchedAt, { month: undefined, day: undefined, hour: "numeric", minute: "2-digit" })} PT` : "Waiting for sources"}<span>·</span>{district.short} pilot</span></footer>
      </main>
    </div>
    <ReaderImportDialog reader={reader}/>
    {connect === "schoology" && <Modal title="Connect your Schoology calendar" onClose={() => { if (!saving) { setConnect(null); setFeedUrl(""); } }}><p>Use your personal calendar subscription link. This gives Relay read-only access to the entries in that feed, not your whole Schoology account.</p><ol className="rs-connect-steps"><li><a href={`${SCHOOLOGY_URL}/calendar`} target="_blank" rel="noopener noreferrer">Open your Schoology calendar <Icon name="external" size={13}/></a> and sign in at your school.</li><li>Look for the calendar export or subscription option and copy its iCal URL. Availability depends on your school’s settings.</li><li>Paste the private link below. Treat it like a password; don’t share it in chat.</li></ol><form onSubmit={connectCalendar}><label htmlFor="rs-calendar-url">Private calendar subscription URL</label><input id="rs-calendar-url" type="password" autoComplete="off" placeholder="https://…schoology.com/…" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} required maxLength={1500} autoFocus/><p className="rs-fine-print">Use {new URL(SCHOOLOGY_URL).hostname}, not schoology.org. Relay accepts only approved Schoology hosts and will not follow login redirects.</p>{connectError && <p className="rs-form-error" role="alert">{connectError}</p>}<button className="rs-button rs-primary" disabled={saving || !feedUrl.trim()}>{saving ? "Checking your calendar…" : "Connect calendar"}<Icon name="arrow" size={16}/></button></form><div className="rs-dialog-note"><Icon name="shield" size={18}/><p>No export option? Your school may have disabled it. Use the browser course reader in guided setup instead; it does not require a calendar feed. We won’t ask for your password or session cookies.</p></div></Modal>}
    {connect === "gmail" && <Modal title="Bring school email into Relay" onClose={() => setConnect(null)}><div className="rs-mail-consent-icon"><Icon name="mail" size={32}/></div><p>Google will ask for <strong>read-only Gmail access</strong>. That permission covers your mailbox; Relay limits its requests to up to 12 recent inbox messages from {district.short} and Schoology.</p><ul className="rs-consent-list"><li><Icon name="check" size={17}/>Reads the subject, sender and short preview.</li><li><Icon name="check" size={17}/>Never sends, deletes, or marks email as read.</li><li><Icon name="check" size={17}/>No attachments. No email sent to AI providers.</li></ul>{source("gmail")?.status === "setup_required" ? <p className="rs-form-error">Google OAuth is not configured on this deployment yet.</p> : <form action="/api/student/gmail/connect" method="post"><input type="hidden" name="binding" value={account.binding}/><button className="rs-button rs-primary">Continue to Google <Icon name="external" size={16}/></button></form>}<p className="rs-fine-print">Your school may block third-party Gmail access. This is a separate permission from signing into Schoology with Google.</p></Modal>}
    {detail && <Modal title={detail.title} onClose={() => setDetail(null)}><div className="rs-detail-meta"><SourceTag source={detail.source}/><span>{detail.kind === "mail" ? "Email preview" : detail.kind === "announcement" ? "District announcement" : "Calendar entry"}</span></div>{detail.date && <div className="rs-detail-date"><Icon name="calendar" size={18}/>{dateLabel(detail.date, { weekday: "long", year: "numeric", ...(detail.allDay ? {} : { hour: "numeric", minute: "2-digit" }) })}{detail.allDay ? (detail.source === "reader" ? " · Date only; verify class time" : " · All day") : " PT"}</div>}{detail.sender && <p className="rs-detail-sender">From: {detail.sender}</p>}{detail.location && <p><strong>Location:</strong> {detail.location}</p>}<p className="rs-detail-description">{detail.description || "No description was included in this calendar entry."}</p>{detail.evidence && <div className="rr-evidence"><span>Supporting excerpt · reviewed by you</span><blockquote>{detail.evidence}</blockquote></div>}<div className="rs-dialog-note"><Icon name="link" size={18}/><p>{detail.source === "schoology" ? "Calendar entries do not include submission status. Confirm dates and submission details in Schoology." : detail.source === "gmail" ? "This is an original email preview, not a verified task or deadline." : detail.source === "reader" ? "This is a browser snapshot reviewed by you, not a verified live Schoology record. Check the source for changes." : "Read the official source for full details and any recent changes."}</p></div><a className="rs-button rs-primary" href={detail.url} target="_blank" rel="noopener noreferrer">Open original source <Icon name="external" size={16}/></a></Modal>}
  </div>;
}
