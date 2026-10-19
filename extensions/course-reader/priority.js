// Local metadata triage, not an LLM verdict or a claim about unseen contents.
// Shared by the extension and dashboard; never execute source instructions.
function normalize(value) { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([a-zA-Z])(\d)/g, "$1 $2").replace(/[_-]+/g, " "); }
export function isAnswerMaterial(title = "", description = "") { return /\b(answer key|answer sheet|worked (?:solutions?|examples?)|model answers?|sample (?:essays?|answers?)|solutions? manual|solutions? to|homework solutions?)\b/i.test(normalize(`${title}\n${description}`)); }
export function readingPriority(url, title = "", description = "") {
  const label = normalize(`${title}\n${description}`).toLowerCase();
  if (isAnswerMaterial(title, description)) return { level: "reference", reason: "Answer/example material: not sent for automatic AI analysis." };
  if (/\/assignment\/\d+\/?(?:\?|$)/.test(url)) return { level: "important", reason: "Assignment instructions." };
  if (/\/grades\/grades|\/courses(?:\?|$)|\/materials(?:\?|$)/.test(url)) return { level: "reference", reason: "Course index or grade overview: used for discovery/status, not automatic academic analysis." };
  if (/\b(syllabus|course outline|grading policy|late[- ]work|ai[- ]use|rubric|feedback|calendars?|schedules?|agenda|labs?|laboratory|assignments?|homework|hw|due date|deadline|study guide|exam review|test review|daily slides|daily agenda|class agenda|class calendar|course calendar|lab instructions?|lab procedure|project instructions?)\b/.test(label)) return { level: "important", reason: "Title/description indicates requirements, planning, feedback or course rules." };
  if (/\b(required|must|please)\s+(read|watch|complete|submit|prepare|review)\b|\b(due|deadline)\s+(on|by|tomorrow|today|monday|tuesday|wednesday|thursday|friday)\b/.test(label)) return { level: "important", reason: "Description contains an explicit preparation or deadline signal." };
  if (/\b(textbook|reference|optional|extra practice|background reading|resource|lecture notes|class notes)\b/.test(label)) return { level: "reference", reason: "Background/reference material: keep its description without automatic deep reading." };
  return { level: "uncertain", reason: "No clear work-related signal in the title/description; content remains unverified." };
}
