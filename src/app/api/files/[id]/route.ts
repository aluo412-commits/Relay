import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/files/:id -> download the file bytes (scoped to your workspace).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { id } = await params;
    const f = await prisma.sourceFile.findFirst({ where: { id, projectId: ctx.project.id } });
    if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = Buffer.from(f.content);
    return new NextResponse(body, {
      headers: {
        "Content-Type": f.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Content-Length": String(body.length),
      },
    });
  } catch (err) {
    console.error("file download error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH /api/files/:id { name?, folderId? }  -> rename and/or move a file.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { id } = await params;
    const existing = await prisma.sourceFile.findFirst({ where: { id, projectId: ctx.project.id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await req.json()) as { name?: string; folderId?: string | null };
    const data: { name?: string; folderId?: string | null } = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 200);
    if (body.folderId !== undefined) {
      if (body.folderId === null) data.folderId = null;
      else {
        const folder = await prisma.sourceFolder.findFirst({ where: { id: body.folderId, projectId: ctx.project.id }, select: { id: true } });
        data.folderId = folder?.id ?? null;
      }
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    await prisma.sourceFile.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("file patch error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/files/:id -> remove a source file from your workspace.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { id } = await params;
    await prisma.sourceFile.deleteMany({ where: { id, projectId: ctx.project.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("file delete error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
