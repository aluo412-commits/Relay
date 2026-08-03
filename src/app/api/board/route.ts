import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

// POST /api/board  { name, deadline?, color?, summary? }  -> create a new workstream, returns fresh state + new board id.
const STREAM_COLORS = ["#e0662a", "#2f7fd1", "#0d9488", "#7c5cd6", "#c2410c", "#0891b2"];

export async function POST(req: NextRequest) {
  try {
    const { name, deadline, color, summary } = (await req.json()) as {
      name?: string;
      deadline?: string;
      color?: string;
      summary?: string;
    };
    if (!name?.trim()) return NextResponse.json({ error: "Workstream name is required" }, { status: 400 });

    const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
    if (!project) return NextResponse.json({ error: "No team found" }, { status: 404 });

    // Assign a rotating accent if none provided, so cards are visually distinct.
    const existing = await prisma.board.count({ where: { projectId: project.id } });
    const board = await prisma.board.create({
      data: {
        projectId: project.id,
        name: name.trim(),
        deadline: deadline?.trim() || null,
        color: color?.trim() || STREAM_COLORS[existing % STREAM_COLORS.length],
        summary: summary?.trim() || null,
      },
    });

    const state = await loadState();
    return NextResponse.json({ state, boardId: board.id });
  } catch (err) {
    console.error("board error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
