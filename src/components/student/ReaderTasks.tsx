"use client";
import { useState } from "react";
import type { CourseReaderController } from "./useCourseReader";
import { groupCards } from "@/lib/student/readerActions";
import { cardTiming, neutralTitle } from "@/lib/student/readerDates";
import { dateLabel, dayKey } from "@/lib/student/types";
import { DraftCard } from "./CourseReader";
export default function ReaderTasks({ reader, compact = false }: { reader: CourseReaderController; compact?: boolean }) {
  const [requestedView, setView] = useState<string | null>(null), [review, setReview] = useState<string | null>(null), [visible, setVisible] = useState(12);
  const [actionMessage, setActionMessage] = useState("");
  const today = dayKey(new Date().toISOString());
  const all = reader.state.cards.filter(c => (c.kind === "assignment" || c.kind === "event") && (!compact || c.status !== "accepted"));
  const match = (c: typeof all[number], tab: string) => tab === "Hidden" ? !!c.hiddenAt : !c.hiddenAt && (tab === "Done" ? !!c.doneAt : tab === "All" ? true : tab === "Past / closed" ? cardTiming(c, today).bucket === "past" : tab === "Date needs checking" ? cardTiming(c, today).bucket === "unknown" || (c.status === "stale" && cardTiming(c, today).bucket === "dated") : cardTiming(c, today).bucket === "dated" && c.status !== "stale");
  const view = requestedView || (all.some(c => match(c, "Upcoming")) ? "Upcoming" : "Date needs checking");
  const act = (ids: string[], action: "hide" | "restore" | "done" | "reopen") => { setView(view); reader.cardAction(ids, action); setActionMessage(action === "restore" ? "Restored to its date-based view. Existing checkmarks are kept; past items return to Past / closed, not Upcoming." : action === "hide" ? "Hidden, not deleted. Find it in Hidden or use Undo." : "Checkmark saved locally. The row stays in this view; nothing was submitted to school."); };
  const selected = all.filter(c => match(c, view));
  const groups = groupCards(selected);
  const hideable = selected.filter(c => !c.hiddenAt).map(c => c.id);
  if (!all.length) return <p className="rr-caption">No assignment instructions extracted yet. Reading course pages does not prove that the homework list or its attached files were read. Check course coverage below.</p>;
  return <section className="rt-tasks" aria-label="Course instructions"><div className="rs-filters rt-tabs">{["Upcoming", "Date needs checking", "Past / closed", "Done", "Hidden", "All"].map(tab => <button key={tab} aria-pressed={view === tab} onClick={() => { setView(tab); setVisible(12); }} className={view === tab ? "rs-filter-active" : ""}>{tab} <span>{groupCards(all.filter(c => match(c, tab))).length}</span></button>)}</div>
    <p className="rr-caption">Only absolute, supported or reviewed dates appear in Upcoming. “Tomorrow” in an old source is never tomorrow today. Checkmarks stay visible and mean done in Relay—not submitted to school.</p>
    <div className="rt-actions">{view === "Hidden" && selected.length > 0 ? <button className="rs-text-button" onClick={() => act(selected.map(c => c.id), "restore")}>Restore all hidden instructions</button> : hideable.length > 0 && <button className="rs-text-button" onClick={() => act(hideable, "hide")}>Hide this view ({hideable.length})</button>}{reader.undo?.ids.length ? <span role="status">Updated {reader.undo.ids.length} source card(s). <button className="rs-text-button" onClick={reader.undoAction}>Undo</button></span> : null}</div>
    {actionMessage && <p className="rr-caption" role="status">{actionMessage}</p>}
    {!selected.length && <p className="rr-caption">No instructions in this view. Other tabs retain undated, past, completed and hidden items; nothing is silently deleted.</p>}
    {groups.slice(0, compact ? 6 : visible).map(({ card: c, ids }) => { const timing = cardTiming(c, today); return <article className={`rt-task ${c.doneAt ? "rt-done" : ""}`} key={c.id}>
      <label className="rt-done-control"><input type="checkbox" aria-label={`Done in Relay: ${neutralTitle(c.title)}`} checked={!!c.doneAt} onChange={e => act(ids, e.target.checked ? "done" : "reopen")}/></label>
      <div className="rt-task-body"><small>{c.course || "Course instruction"} · {c.status === "accepted" ? "Reviewed" : c.status === "stale" ? "Source changed / no longer available" : "Unreviewed AI draft"}{c.doneAt ? " · Done in Relay" : ""}</small><h3>{neutralTitle(c.title)}</h3>{((c.doneAt && c.doneSourceHash && c.doneSourceHash !== c.sourceTextHash) || c.status === "stale") && <p className="rr-warning">Source changed or is unavailable. Your checkmark is kept, but review it against the current instructions.</p>}<p>{timing.due ? `${dateLabel(timing.due, { year: "numeric" })} · ` : ""}{timing.note}</p><a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">Open original source ↗</a><details><summary>Evidence &amp; review{ids.length > 1 ? ` · ${ids.length} matching source cards grouped` : ""}</summary><p className="rr-caption">{c.capturedAt ? `Source read ${dateLabel(c.capturedAt, { year: "numeric", hour: "numeric", minute: "2-digit" })} PT. This is a read time, not a publication date or deadline.` : "Original publication date is not verified."}</p><blockquote>{c.quote}</blockquote>{c.dueQuote && <blockquote>{c.dueQuote}</blockquote>}<button className="rs-text-button" onClick={() => setReview(review === c.id ? null : c.id)}>{review === c.id ? "Close editor" : "Review requirement & date"}</button>{review === c.id && <DraftCard card={c} reader={reader}/>}</details></div>
      <button className="rs-text-button" onClick={() => act(ids, c.hiddenAt ? "restore" : "hide")}>{c.hiddenAt ? "Restore" : "Hide"}</button>
    </article>; })}
    {groups.length > (compact ? 6 : visible) && (compact ? <p className="rr-caption">{groups.length - 6} more in Assignments.</p> : <button className="rs-text-button" onClick={() => setVisible(n => n + 12)}>Show 12 more</button>)}
  </section>;
}
