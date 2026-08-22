import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/folders { name, parentId? } -> create a folder in the source tree.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { name, parentId } = (await req.json()) as { name?: string; parentId?: string | null };
    const clean = (name ?? "").trim();
    if (!clean) return NextResponse.json({ error: "Folder name is required" }, { status: 400 });

    let parent: string | null = null;
    if (parentId) {
      const p = await prisma.sourceFolder.findFirst({ where: { id: parentId, projectId: ctx.project.id }, select: { id: true } });
      parent = p?.id ?? null;
    }
    const created = await prisma.sourceFolder.create({
      data: { projectId: ctx.project.id, parentId: parent, name: clean.slice(0, 120) },
      select: { id: true, name: true, parentId: true, createdAt: true },
    });
    return NextResponse.json({ folder: { id: created.id, name: created.name, parentId: created.parentId, createdAt: created.createdAt.toISOString() } });
  } catch (err) {
    console.error("folder create error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
