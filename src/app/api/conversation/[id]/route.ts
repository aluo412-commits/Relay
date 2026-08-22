import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// Confirm the conversation belongs to the signed-in member.
async function own(id: string, memberId: string) {
  return prisma.conversation.findFirst({ where: { id, memberId } });
}

// GET /api/conversation/[id] -> the thread's messages (oldest first).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { id } = await params;
    const convo = await own(id, ctx.member.id);
    if (!convo) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const rows = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, role: true, content: true, createdAt: true, feedback: true },
    });
    return NextResponse.json({
      conversation: { id: convo.id, title: convo.title, boardId: convo.boardId },
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        feedback: m.feedback ?? undefined,
      })),
    });
  } catch (err) {
    console.error("conversation GET(id) error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH /api/conversation/[id] { title } -> rename.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { id } = await params;
    if (!(await own(id, ctx.member.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { title } = (await req.json()) as { title?: string };
    const clean = (title ?? "").trim();
    if (!clean) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    const updated = await prisma.conversation.update({
      where: { id },
      data: { title: clean.slice(0, 80) },
      select: { id: true, title: true, boardId: true, updatedAt: true },
    });
    return NextResponse.json({
      conversation: { id: updated.id, title: updated.title, boardId: updated.boardId, updatedAt: updated.updatedAt.toISOString() },
    });
  } catch (err) {
    console.error("conversation PATCH error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/conversation/[id] -> delete the thread and its messages (cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { id } = await params;
    if (!(await own(id, ctx.member.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.conversation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("conversation DELETE error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
