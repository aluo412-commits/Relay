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

    const rows = await prisma.message.findMany({
      where: { projectId: ctx.project.id, memberId: ctx.member.id, ...(boardId ? { boardId } : {}) },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true, createdAt: true },
    });
    const messages = rows.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt.toISOString() }));

    return NextResponse.json({ state, messages, currentMemberId: ctx.member.id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
