import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

type ConvRow = { id: string; title: string; boardId: string | null; updatedAt: Date };
const toDTO = (c: ConvRow) => ({ id: c.id, title: c.title, boardId: c.boardId, updatedAt: c.updatedAt.toISOString() });

// GET /api/conversation?boardId=  -> the member's threads for a workstream, newest first.
export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const boardId = req.nextUrl.searchParams.get("boardId");
    const rows = await prisma.conversation.findMany({
      where: { projectId: ctx.project.id, memberId: ctx.member.id, ...(boardId ? { boardId } : {}) },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, boardId: true, updatedAt: true },
    });
    return NextResponse.json({ conversations: rows.map(toDTO) });
  } catch (err) {
    console.error("conversation GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/conversation { boardId?, title? }  -> start a new empty thread.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { boardId, title } = (await req.json().catch(() => ({}))) as { boardId?: string; title?: string };
    const created = await prisma.conversation.create({
      data: {
        projectId: ctx.project.id,
        memberId: ctx.member.id,
        boardId: boardId ?? null,
        title: (title ?? "").trim() || "New chat",
      },
      select: { id: true, title: true, boardId: true, updatedAt: true },
    });
    return NextResponse.json({ conversation: toDTO(created) });
  } catch (err) {
    console.error("conversation POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
