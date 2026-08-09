import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState } from "@/lib/state";
import { getContext } from "@/lib/session";
import type { TaskStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST /api/request
//   { mode: "create", taskId, proposedStatus, note }
//   { mode: "resolve", requestId, decision: "approve" | "decline" }
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const body = await req.json();

    if (body.mode === "create") {
      const task = await prisma.task.findFirst({ where: { id: body.taskId, projectId: ctx.project.id } });
      if (!task) return NextResponse.json({ error: "Unknown task" }, { status: 404 });

      await prisma.changeRequest.create({
        data: {
          projectId: task.projectId,
          taskId: task.id,
          taskName: task.name,
          requestedById: ctx.member.id,
          requestedByName: ctx.member.name,
          targetId: task.ownerId ?? null,
          proposedStatus: body.proposedStatus as TaskStatus,
          note: body.note || null,
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.mode === "resolve") {
      const request = await prisma.changeRequest.findFirst({
        where: { id: body.requestId, projectId: ctx.project.id },
      });
      if (!request) return NextResponse.json({ error: "Unknown request" }, { status: 404 });
      // Only the task owner (the target of the request) may resolve it.
      if (request.targetId && request.targetId !== ctx.member.id) {
        return NextResponse.json({ error: "Only the task owner can resolve this" }, { status: 403 });
      }

      if (body.decision === "approve") {
        await prisma.task.update({
          where: { id: request.taskId },
          data: { status: request.proposedStatus, note: request.note ?? undefined },
        });
        await prisma.changeRequest.update({ where: { id: request.id }, data: { status: "approved" } });
      } else {
        await prisma.changeRequest.update({ where: { id: request.id }, data: { status: "declined" } });
      }
      const state = await loadState(ctx.project.id);
      return NextResponse.json({ state });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err) {
    console.error("request error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
