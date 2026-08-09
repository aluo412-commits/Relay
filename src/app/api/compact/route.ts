import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { summarizeForCompaction } from "@/lib/minimax";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type EntryDTO = { id: string; heading: string; summary: string; content: string; createdAt: string };
const toDTO = (e: { id: string; heading: string; summary: string; content: string; createdAt: Date }): EntryDTO => ({
  id: e.id,
  heading: e.heading,
  summary: e.summary,
  content: e.content,
  createdAt: e.createdAt.toISOString(),
});

// GET /api/compact  -> your compacted-context entries (newest first).
export async function GET() {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ entries: [] });
    const rows = await prisma.compactEntry.findMany({
      where: { memberId: ctx.member.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ entries: rows.map(toDTO) });
  } catch (err) {
    console.error("compact GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/compact
// Fold your current live conversation into one summarized entry, then clear the live
// thread. The full transcript is preserved behind the entry.
export async function POST() {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const memberId = ctx.member.id;
    const projectId = ctx.project.id;

    const msgs = await prisma.message.findMany({
      where: { projectId, memberId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
    if (msgs.length === 0) {
      return NextResponse.json({ error: "Nothing to compact" }, { status: 400 });
    }

    const transcript = msgs
      .map((m) => `${m.role === "user" ? ctx.member.name : "Relay"}: ${m.content}`)
      .join("\n\n");
    const { heading, summary } = await summarizeForCompaction(transcript, ctx.project.model);

    const entry = await prisma.compactEntry.create({
      data: { projectId, memberId, heading, summary, content: transcript },
    });

    // Clear the live thread — it now lives behind the compact entry.
    await prisma.message.deleteMany({ where: { projectId, memberId } });

    return NextResponse.json({ entry: toDTO(entry) });
  } catch (err) {
    console.error("compact POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/compact?id=  -> forget a compacted entry (yours only).
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await prisma.compactEntry.deleteMany({ where: { id, memberId: ctx.member.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("compact DELETE error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
