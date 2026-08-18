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
