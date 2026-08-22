import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// Collect a folder's descendant ids (to prevent moving a folder into its own subtree).
function descendantsOf(id: string, all: { id: string; parentId: string | null }[]): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const f of all) {
    if (!f.parentId) continue;
    (byParent.get(f.parentId) ?? byParent.set(f.parentId, []).get(f.parentId)!).push(f.id);
  }
  const out = new Set<string>();
  const walk = (fid: string) => {
    for (const c of byParent.get(fid) ?? []) {
      if (!out.has(c)) { out.add(c); walk(c); }
    }
  };
  walk(id);
  return out;
}

// PATCH /api/folders/:id { name?, parentId? } -> rename and/or move a folder.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { id } = await params;
    const self = await prisma.sourceFolder.findFirst({ where: { id, projectId: ctx.project.id }, select: { id: true } });
    if (!self) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await req.json()) as { name?: string; parentId?: string | null };
    const data: { name?: string; parentId?: string | null } = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 120);
    if (body.parentId !== undefined) {
      if (body.parentId === null) data.parentId = null;
      else if (body.parentId === id) return NextResponse.json({ error: "A folder can't contain itself" }, { status: 400 });
      else {
        const target = await prisma.sourceFolder.findFirst({ where: { id: body.parentId, projectId: ctx.project.id }, select: { id: true } });
        if (!target) return NextResponse.json({ error: "Target folder not found" }, { status: 404 });
        const all = await prisma.sourceFolder.findMany({ where: { projectId: ctx.project.id }, select: { id: true, parentId: true } });
        if (descendantsOf(id, all).has(body.parentId)) {
          return NextResponse.json({ error: "Can't move a folder into one of its own subfolders" }, { status: 400 });
        }
        data.parentId = body.parentId;
      }
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    await prisma.sourceFolder.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("folder patch error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/folders/:id -> delete the folder and everything inside it (cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { id } = await params;
    const self = await prisma.sourceFolder.findFirst({ where: { id, projectId: ctx.project.id }, select: { id: true } });
    if (!self) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.sourceFolder.delete({ where: { id } }); // cascades to subfolders + files
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("folder delete error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
