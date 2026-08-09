import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState, applyActions } from "@/lib/state";
import { getContext } from "@/lib/session";
import type { UpdateDraft, BoardAction } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST /api/apply
//   { update?, actions?[], boardId?, notify? }
// Persists a posted work update (if provided) and applies board actions.
// Used both when posting an update and when accepting a Connector suggestion.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const body = (await req.json()) as {
      boardId?: string;
      update?: UpdateDraft | null;
      actions?: BoardAction[];
      notify?: { recipientName?: string; text?: string } | null;
    };

    const state = await loadState(ctx.project.id);
    const projectId = state.project.id;
    // Task actions need a board; default to the first board if none specified.
    const boardId = body.boardId || state.boards[0]?.id;
    const actorName = ctx.member.name;

    if (body.update && body.update.title) {
      await prisma.update.create({
        data: {
          projectId,
          authorId: ctx.member.id,
          title: body.update.title,
          status: body.update.status ?? "",
          summary: body.update.summary || null,
          details: body.update.details || null,
          changes: body.update.changes || null,
          impact: body.update.impact || null,
          artifacts: body.update.artifacts?.length ? JSON.stringify(body.update.artifacts) : null,
          nextSteps: body.update.nextSteps || null,
        },
      });
    }

    if (body.actions?.length && boardId) {
      await applyActions(projectId, boardId, body.actions, actorName);
    }

    // Connector delivery: looping someone in actually notifies them.
    if (body.notify?.recipientName && body.notify.text) {
      const recipient = state.members.find(
        (m) => m.name.toLowerCase() === body.notify!.recipientName!.toLowerCase()
      );
      if (recipient) {
        await prisma.notification.create({
          data: {
            projectId,
            recipientId: recipient.id,
            kind: "connector",
            text: body.notify.text,
            fromName: actorName,
          },
        });
      }
    }

    const fresh = await loadState(ctx.project.id);
    return NextResponse.json({ state: fresh });
  } catch (err) {
    console.error("apply error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
