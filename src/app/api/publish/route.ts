import { NextRequest, NextResponse } from "next/server";
import { loadState, applyActions, executeAgentOutput, draftToWork } from "@/lib/state";
import { getContext } from "@/lib/session";
import type { DraftPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/publish  { boardId?, draft }
// Applies ONE reviewed/edited draft: creates the task(s) / posts the record /
// shares the knowledge / flips the status — and delivers any notifications.
// Returns fresh state plus any produced artifacts (e.g. the record's markdown).
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { boardId, draft } = (await req.json()) as { boardId?: string; draft?: DraftPayload };
    if (!draft) return NextResponse.json({ error: "draft is required" }, { status: 400 });

    const state = await loadState(ctx.project.id);
    const actorName = ctx.member.name;
    const activeBoardId = state.boards.find((b) => b.id === boardId)?.id ?? state.boards[0]?.id;
    if (!activeBoardId) return NextResponse.json({ error: "No board found" }, { status: 404 });

    const { proposals, syncActions } = draftToWork(draft);
    if (syncActions.length) {
      await applyActions(state.project.id, activeBoardId, syncActions, actorName);
    }
    const artifacts = await executeAgentOutput(state, activeBoardId, actorName, proposals, []);

    const fresh = await loadState(ctx.project.id);
    return NextResponse.json({ state: fresh, artifacts });
  } catch (err) {
    console.error("publish error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
