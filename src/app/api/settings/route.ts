import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState } from "@/lib/state";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/settings { model } -> set the workspace's active model (admins only).
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (!ctx.member.admin) {
      return NextResponse.json({ error: "Only a workspace admin can change this" }, { status: 403 });
    }

    const { model } = (await req.json()) as { model?: string };
    if (!model?.trim()) return NextResponse.json({ error: "model is required" }, { status: 400 });

    await prisma.project.update({ where: { id: ctx.project.id }, data: { model: model.trim() } });
    const state = await loadState(ctx.project.id);
    return NextResponse.json({ state });
  } catch (err) {
    console.error("settings error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
