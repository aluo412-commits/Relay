import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState } from "@/lib/state";
import { summarizeForCompaction } from "@/lib/minimax";

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

// GET /api/compact?memberId=  -> this member's compacted-context entries (newest first).
export async function GET(req: NextRequest) {
  try {
    const memberId = req.nextUrl.searchParams.get("memberId");
    if (!memberId) return NextResponse.json({ entries: [] });
    const rows = await prisma.compactEntry.findMany({ where: { memberId }, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ entries: rows.map(toDTO) });
  } catch (err) {
    console.error("compact GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/compact { memberId }
// Fold the member's current live conversation into one summarized entry, then clear
// the live thread. The full transcript is preserved behind the entry.
export async function POST(req: NextRequest) {
  try {
    const { memberId } = (await req.json()) as { memberId?: string };
    if (!memberId) return NextResponse.json({ error: "memberId is required" }, { status: 400 });

    const state = await loadState();
    const member = state.members.find((m) => m.id === memberId);
    if (!member) return NextResponse.json({ error: "Unknown member" }, { status: 404 });

    const msgs = await prisma.message.findMany({
      where: { projectId: state.project.id, memberId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
    if (msgs.length === 0) {
      return NextResponse.json({ error: "Nothing to compact" }, { status: 400 });
    }

    const transcript = msgs
      .map((m) => `${m.role === "user" ? member.name : "Relay"}: ${m.content}`)
      .join("\n\n");
    const { heading, summary } = await summarizeForCompaction(transcript, state.project.model);

    const entry = await prisma.compactEntry.create({
      data: { projectId: state.project.id, memberId, heading, summary, content: transcript },
    });

    // Clear the live thread — it now lives behind the compact entry.
    await prisma.message.deleteMany({ where: { projectId: state.project.id, memberId } });

    return NextResponse.json({ entry: toDTO(entry) });
  } catch (err) {
    console.error("compact POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/compact?id=  -> forget a compacted entry.
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await prisma.compactEntry.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("compact DELETE error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
