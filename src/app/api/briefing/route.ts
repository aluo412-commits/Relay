import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Briefing, TaskStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_RANK: Record<string, number> = { blocked: 0, inprogress: 1, new: 2, done: 3 };

// GET /api/briefing?memberId=  -> what this member still owes + what changed since they last looked.
// Also stamps lastSeenAt so the next visit only shows genuinely new activity.
export async function GET(req: NextRequest) {
  try {
    const memberId = req.nextUrl.searchParams.get("memberId");
    if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member) return NextResponse.json({ error: "Unknown member" }, { status: 404 });

    const projectId = member.projectId;
    const since = member.lastSeenAt ?? new Date(0);

    const [ownTasks, updates, knowledge, requests] = await Promise.all([
      prisma.task.findMany({
        where: { projectId, ownerId: memberId, status: { not: "done" } },
      }),
      prisma.update.findMany({
        where: { projectId, authorId: { not: memberId }, createdAt: { gt: since } },
        include: { author: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.knowledge.findMany({
        where: { projectId, createdAt: { gt: since } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.changeRequest.findMany({
        where: { projectId, targetId: memberId, status: "pending" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const briefing: Briefing = {
      yourTasks: ownTasks
        .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9))
        .map((t) => ({ name: t.name, status: t.status as TaskStatus, note: t.note })),
      newUpdates: updates.map((u) => ({
        title: u.title,
        status: u.status,
        author: u.author?.name ?? null,
        summary: u.summary,
      })),
      newKnowledge: knowledge.map((k) => ({
        tag: k.tag,
        text: k.text,
        importance: (k.importance as Briefing["newKnowledge"][number]["importance"]) ?? "normal",
      })),
      requests: requests.map((r) => ({
        id: r.id,
        taskName: r.taskName,
        requestedBy: r.requestedByName,
        proposedStatus: r.proposedStatus as Briefing["requests"][number]["proposedStatus"],
        note: r.note,
      })),
    };

    // Mark as seen now (so the catch-up reflects only new activity next time).
    await prisma.member.update({ where: { id: memberId }, data: { lastSeenAt: new Date() } });

    return NextResponse.json({ briefing });
  } catch (err) {
    console.error("briefing error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
