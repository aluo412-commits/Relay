import { NextRequest, NextResponse } from "next/server";
import { completeJson } from "@/lib/minimax";
import { loadState } from "@/lib/state";
import type { ProgressReview, TaskStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/review-progress
// The AI reviews & polishes a progress check-in on a task spec.
export async function POST(req: NextRequest) {
  try {
    const { taskName, objective, acceptanceCriteria, doneCriteria, currentStatus, draftNote } =
      (await req.json()) as {
        taskName: string;
        objective?: string;
        acceptanceCriteria?: string[];
        doneCriteria?: string[];
        currentStatus?: string;
        draftNote?: string;
      };

    const system = `You are Relay, reviewing a teammate's progress check-in on a task before it's logged. Return ONLY a JSON object:
{
  "reviewedNote": string,        // polish the draft into a clear, professional 1-2 sentence progress note. Keep the person's facts; do NOT invent specifics. If the draft is empty, write a reasonable note from the checked criteria.
  "suggestedStatus": "new"|"inprogress"|"blocked"|"done",  // the status that best fits the evidence
  "comment": string              // one short, friendly sentence of review feedback (what's good / what's still missing)
}
Rules: if all acceptance criteria are done, lean "done". If the note mentions being stuck/waiting, lean "blocked". Never fabricate numbers or facts not in the draft.`;

    const user = `TASK: ${taskName}
OBJECTIVE: ${objective || "(none given)"}
ACCEPTANCE CRITERIA: ${acceptanceCriteria?.length ? acceptanceCriteria.join(" | ") : "(none)"}
MARKED DONE: ${doneCriteria?.length ? doneCriteria.join(" | ") : "(none)"}
CURRENT STATUS: ${currentStatus || "unknown"}
DRAFT PROGRESS NOTE: ${draftNote || "(empty)"}`;

    const model = await loadState().then((s) => s.project.model).catch(() => undefined);
    const review = await completeJson<ProgressReview>(system, user, model);
    if (!review || !review.reviewedNote) {
      return NextResponse.json({ error: "Couldn't review that — try again." }, { status: 502 });
    }
    const valid: TaskStatus[] = ["new", "inprogress", "blocked", "done"];
    if (!valid.includes(review.suggestedStatus)) {
      review.suggestedStatus = (currentStatus as TaskStatus) ?? "inprogress";
    }
    return NextResponse.json({ review });
  } catch (err) {
    console.error("review-progress error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
