import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState } from "@/lib/state";
import type { TaskStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST /api/request
//   { mode: "create", taskId, requestedById, proposedStatus, note }
//   { mode: "resolve", requestId, decision: "approve" | "decline" }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.mode === "create") {
      const task = await prisma.task.findUnique({ where: { id: body.taskId } });
      if (!task) return NextResponse.json({ error: "Unknown task" }, { status: 404 });
      const requester = body.requestedById
        ? await prisma.member.findUnique({ where: { id: body.requestedById } })
        : null;

      await prisma.changeRequest.create({
        data: {
          projectId: task.projectId,
          taskId: task.id,
          taskName: task.name,
          requestedById: body.requestedById ?? null,
          requestedByName: requester?.name ?? null,
          targetId: task.ownerId ?? null,
          proposedStatus: body.proposedStatus as TaskStatus,
          note: body.note || null,
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.mode === "resolve") {
      const request = await prisma.changeRequest.findUnique({ where: { id: body.requestId } });
      if (!request) return NextResponse.json({ error: "Unknown request" }, { status: 404 });

      if (body.decision === "approve") {
        await prisma.task.update({
          where: { id: request.taskId },
          data: { status: request.proposedStatus, note: request.note ?? undefined },
        });
        await prisma.changeRequest.update({ where: { id: request.id }, data: { status: "approved" } });
      } else {
        await prisma.changeRequest.update({ where: { id: request.id }, data: { status: "declined" } });
      }
      const state = await loadState();
      return NextResponse.json({ state });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err) {
    console.error("request error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
