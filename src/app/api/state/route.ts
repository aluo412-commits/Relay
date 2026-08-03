import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

// GET /api/state                     -> shared project state
// GET /api/state?memberId=            -> also that member's chat (all streams, back-compat)
// GET /api/state?memberId=&boardId=   -> that member's chat scoped to one workstream
export async function GET(req: NextRequest) {
  try {
    const state = await loadState();
    const memberId = req.nextUrl.searchParams.get("memberId");
    const boardId = req.nextUrl.searchParams.get("boardId");

    let messages: { role: string; content: string; createdAt: string }[] = [];
    if (memberId) {
      const rows = await prisma.message.findMany({
        where: { projectId: state.project.id, memberId, ...(boardId ? { boardId } : {}) },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, createdAt: true },
      });
      messages = rows.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt.toISOString() }));
    }

    return NextResponse.json({ state, messages });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
