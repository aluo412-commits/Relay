import { isAnswerMaterial, readingPriority } from "../../../extensions/course-reader/priority.js";
import type { ReaderPage } from "./reader";
export function pagePriority(page: ReaderPage) {
  return readingPriority(page.url, page.title, page.description || (/\/updates/.test(page.url) ? page.text.slice(0, 700) : ""));
}
export function canAnalyzeExcerpt(page: ReaderPage): boolean { return page.readDepth !== "description" && !/\/materials\/gp\//.test(page.url) && !isAnswerMaterial(page.title, page.description); }
export function shouldAutoAnalyze(page: ReaderPage): boolean {
  return canAnalyzeExcerpt(page) && pagePriority(page).level === "important";
}
export type SubmissionObservation = { provider: "Schoology" | "Turnitin"; status: "submitted" | "not_submitted" | "submitted_ungraded" | "unknown"; quotes: string[]; reason: string };
// These are source-text observations, not verified platform API states. Never
// infer status from a due date, grade, button, link, or another platform's state.
export function submissionObservations(page: ReaderPage): SubmissionObservation[] {
  if (page.readDepth === "description" || !/^https:\/\/fuhsd\.schoology\.com\/assignment\/\d+\/?$/.test(page.url)) return [];
  const entries: { provider: SubmissionObservation["provider"]; status: SubmissionObservation["status"]; quote: string }[] = [];
  for (const raw of page.text.split(/\n/)) {
    const line = raw.trim();
    const match = /^(Turnitin submission status|Your submission status|Submission status)\s*:\s*(Submitted|Not submitted|No submissions|Submitted[ ,—-]+(?:not yet graded|ungraded))\.?$/i.exec(line);
    if (!match) continue;
    const label = match[2].toLowerCase();
    entries.push({ provider: /^turnitin/i.test(match[1]) ? "Turnitin" : "Schoology", status: /ungraded|not yet graded/.test(label) ? "submitted_ungraded" : /^submitted$/.test(label) ? "submitted" : "not_submitted", quote: line });
  }
  const providers: SubmissionObservation["provider"][] = ["Schoology"];
  if (page.services?.includes("turnitin") || entries.some(e => e.provider === "Turnitin")) providers.push("Turnitin");
  return providers.map(provider => {
    const evidence = entries.filter(e => e.provider === provider), states = new Set(evidence.map(e => e.status));
    const status = states.size === 1 ? evidence[0].status : "unknown";
    return { provider, status, quotes: evidence.map(e => e.quote), reason: states.size > 1 ? "Conflicting status labels in the snapshot; check the original source." : !evidence.length ? `${provider === "Turnitin" ? "Turnitin was linked, but its authenticated status was not read." : "No explicit personal submission status was captured."} Dates, blank grades and upload buttons are not submission evidence.` : "Explicit label observed in a Schoology snapshot. Not a live platform verification; confirm on the source." };
  });
}
