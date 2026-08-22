import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState } from "@/lib/state";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/state              -> the active workspace's shared state + your chat.
// GET /api/state?boardId=     -> your chat scoped to one workstream.
export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const state = await loadState(ctx.project.id);
    const boardId = req.nextUrl.searchParams.get("boardId");

    // The member's most-recently-active thread for this workstream (if any).
    const convo = await prisma.conversation.findFirst({
      where: { projectId: ctx.project.id, memberId: ctx.member.id, ...(boardId ? { boardId } : {}) },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    // Messages for that thread, or (back-compat) legacy messages not yet in a thread.
    const rows = await prisma.message.findMany({
      where: convo
        ? { conversationId: convo.id }
        : { projectId: ctx.project.id, memberId: ctx.member.id, conversationId: null, ...(boardId ? { boardId } : {}) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, role: true, content: true, createdAt: true, feedback: true },
    });
    const messages = rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      feedback: m.feedback ?? undefined,
    }));

    return NextResponse.json({ state, messages, conversationId: convo?.id ?? null, currentMemberId: ctx.member.id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
