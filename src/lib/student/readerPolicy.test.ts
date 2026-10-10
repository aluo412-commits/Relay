import { test } from "node:test";
import assert from "node:assert/strict";
import { readingPriority } from "../../../extensions/course-reader/priority.js";
import { canAnalyzeExcerpt, shouldAutoAnalyze, submissionObservations } from "./readerPolicy";
import { validateCapture, type ReaderPage } from "./reader";
import { validateReaderAnalysis } from "./readerAnalysis";
const page: ReaderPage = { id: "source-1", url: "https://fuhsd.schoology.com/assignment/123", title: "Homework instructions", text: "Required homework: read chapter three and prepare for discussion.", capturedAt: "2026-01-01T00:00:00Z", warnings: [], links: [] };

test("automatic priority chooses work-related instructions without student selection", () => {
  assert.equal(shouldAutoAnalyze(page), true);
  const url = "https://docs.google.com/document/d/synthetic/edit";
  for (const title of ["Syllabus", "Class calendar", "Daily slides", "Teacher feedback", "Lab procedure", "Exam review", "AP_Calculus_Calendar_2026", "DailySlides", "Lab1_Enzymes"]) assert.equal(readingPriority(url, title).level, "important");
  assert.equal(readingPriority(url, "Textbook reference").level, "reference");
  assert.equal(readingPriority(url, "Unclear title").level, "uncertain");
  assert.equal(readingPriority(url, "Chapter three", "Required read before class").level, "important");
  assert.equal(shouldAutoAnalyze({ ...page, url: "https://fuhsd.schoology.com/grades/grades" }), false);
});
test("description-only resources and answer materials never enter academic task extraction", () => {
  const descriptor: ReaderPage = { ...page, readDepth: "description", description: "Teacher's resource label", descriptionSource: "https://fuhsd.schoology.com/course/123/materials" };
  const validated = validateCapture({ version: 1, pages: [descriptor] });
  assert.equal(validated.pages[0].readDepth, "description"); assert.equal(canAnalyzeExcerpt(descriptor), false);
  assert.equal(shouldAutoAnalyze({ ...page, title: "Worked solutions" }), false);
  assert.equal(canAnalyzeExcerpt({ ...page, title: "Sample essays" }), false);
  assert.equal(canAnalyzeExcerpt({ ...page, title: "Homework_Answer_Key" }), false);
  const result = validateReaderAnalysis({ cards: [{ sourceId: page.id, title: "Read chapter three", kind: "assignment", requirement: "required", quote: page.text }] }, validated);
  assert.equal(result.cards.length, 0); assert.equal(result.rejected, 1);
});
test("feedback learning notes remain information, not required dated assignments", () => {
  const feedback = { ...page, title: "Teacher feedback", text: "Teacher feedback: revisit how evidence supports your claim. Reviewed October 6, 2026." };
  const result = validateReaderAnalysis({ cards: [{ sourceId: page.id, title: "Revisit evidence and claims", kind: "insight", requirement: "required", quote: "Teacher feedback: revisit how evidence supports your claim.", due: "2026-10-06", dueQuote: "Reviewed October 6, 2026." }] }, { version: 1, pages: [feedback] });
  assert.equal(result.cards[0].kind, "insight"); assert.equal(result.cards[0].requirement, "unclear"); assert.equal(result.cards[0].due, null); assert.equal(result.cards[0].status, "draft");
});
test("Turnitin links never inherit a Schoology submission state", () => {
  const p: ReaderPage = { ...page, text: page.text + "\nSubmission status: Submitted", services: ["turnitin"] };
  const labels = submissionObservations(p);
  assert.equal(labels.find(x => x.provider === "Schoology")?.status, "submitted");
  assert.equal(labels.find(x => x.provider === "Turnitin")?.status, "unknown");
  assert.deepEqual(labels[0].quotes, ["Submission status: Submitted"]);
  const explicit = submissionObservations({ ...p, text: "Turnitin submission status: Submitted, ungraded" });
  assert.equal(explicit.find(x => x.provider === "Turnitin")?.status, "submitted_ungraded");
});
test("status detection rejects grades, dates, instructions, aggregates and conflicting labels", () => {
  for (const text of ["Grade: blank\nDue: yesterday\nSubmit assignment", "If your Submission status: Submitted, wait for grading.", "Example: Submission status: Not submitted", "Submission status: Submitted or Not submitted"]) assert.equal(submissionObservations({ ...page, text })[0].status, "unknown");
  assert.equal(submissionObservations({ ...page, text: "Submission status: Submitted\nSubmission status: Not submitted" })[0].status, "unknown");
  assert.deepEqual(submissionObservations({ ...page, url: "https://fuhsd.schoology.com/grades/grades", text: "Submission status: Submitted" }), []);
  assert.deepEqual(submissionObservations({ ...page, readDepth: "description" }), []);
});
