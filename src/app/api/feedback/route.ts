import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/feedback { messageId, value }  value: 1 (up) | -1 (down) | 0 (clear)
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { messageId, value } = (await req.json()) as { messageId?: string; value?: number };
    if (!messageId) return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    const normalized = value === 1 ? 1 : value === -1 ? -1 : null;

    // Only the message's own member may rate it.
    const msg = await prisma.message.findFirst({ where: { id: messageId, memberId: ctx.member.id }, select: { id: true } });
    if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.message.update({ where: { id: messageId }, data: { feedback: normalized } });
    return NextResponse.json({ ok: true, feedback: normalized });
  } catch (err) {
    console.error("feedback error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
