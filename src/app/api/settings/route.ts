import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

// POST /api/settings { model } -> set the team's active MiniMax model.
export async function POST(req: NextRequest) {
  try {
    const { model } = (await req.json()) as { model?: string };
    if (!model?.trim()) return NextResponse.json({ error: "model is required" }, { status: 400 });

    const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
    if (!project) return NextResponse.json({ error: "No team found" }, { status: 404 });

    await prisma.project.update({ where: { id: project.id }, data: { model: model.trim() } });
    const state = await loadState();
    return NextResponse.json({ state });
  } catch (err) {
    console.error("settings error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
