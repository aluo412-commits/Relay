import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getContext } from "@/lib/session";
import { extractText, isReadable, MAX_FILE_BYTES } from "@/lib/files";
import type { SourceFileDTO } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type MetaRow = { id: string; name: string; mimeType: string; size: number; description: string | null; uploaderName: string | null; folderId: string | null; createdAt: Date };
function toDTO(f: MetaRow): SourceFileDTO {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    description: f.description,
    uploaderName: f.uploaderName,
    hasText: isReadable(f.name, f.mimeType), // derived (text or PDF), so we never load the text column here
    folderId: f.folderId,
    createdAt: f.createdAt.toISOString(),
  };
}

// GET /api/files -> the workspace's source tree: files + folders (metadata only).
export async function GET() {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const [rows, folders] = await Promise.all([
      prisma.sourceFile.findMany({
        where: { projectId: ctx.project.id },
        select: { id: true, name: true, mimeType: true, size: true, description: true, uploaderName: true, folderId: true, createdAt: true },
        orderBy: { name: "asc" },
      }),
      prisma.sourceFolder.findMany({
        where: { projectId: ctx.project.id },
        select: { id: true, name: true, parentId: true, createdAt: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return NextResponse.json({
      files: rows.map(toDTO),
      folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, createdAt: f.createdAt.toISOString() })),
    });
  } catch (err) {
    console.error("files GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/files (multipart: file, description?) -> upload a source file.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    const description = ((form.get("description") as string) || "").trim() || null;
    const rawFolderId = ((form.get("folderId") as string) || "").trim() || null;
    // Only accept a folder that belongs to this workspace.
    let folderId: string | null = null;
    if (rawFolderId) {
      const folder = await prisma.sourceFolder.findFirst({ where: { id: rawFolderId, projectId: ctx.project.id }, select: { id: true } });
      folderId = folder?.id ?? null;
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "That file is empty" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File is too large (max 4 MB)" }, { status: 413 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";
    const text = await extractText(buf, file.name, mimeType);

    const created = await prisma.sourceFile.create({
      data: {
        projectId: ctx.project.id,
        folderId,
        uploaderId: ctx.member.id,
        uploaderName: ctx.member.name,
        name: file.name,
        mimeType,
        size: file.size,
        content: buf,
        text,
        description,
      },
      select: { id: true, name: true, mimeType: true, size: true, description: true, uploaderName: true, folderId: true, createdAt: true },
    });

    return NextResponse.json({ file: toDTO(created) });
  } catch (err) {
    console.error("files POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
