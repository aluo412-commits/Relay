import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadSyncFeed } from "@/lib/syncFeed";
import { proactiveItems } from "@/lib/sync";

export const dynamic = "force-dynamic";

// POST /api/proactive  { memberId }
// If there's an urgent + actionable item Relay hasn't spoken up about yet, inject
// one assistant message into the chat and record it so it never repeats.
export async function POST(req: NextRequest) {
  try {
    const { memberId } = (await req.json()) as { memberId?: string };
    if (!memberId) return NextResponse.json({ message: null });

    const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
    if (!project) return NextResponse.json({ message: null });

    const { items } = await loadSyncFeed(memberId);
    const candidates = proactiveItems(items);
    if (!candidates.length) return NextResponse.json({ message: null });

    const delivered = await prisma.proactiveDelivery.findMany({ where: { memberId } });
    const deliveredKeys = new Set(delivered.map((d) => d.key));
    const item = candidates.find((c) => !deliveredKeys.has(c.key));
    if (!item) return NextResponse.json({ message: null });

    const content = `**Heads up** — ${item.text}${item.taskName ? ` Open it from the board when you're ready.` : ""}`;
    const msg = await prisma.message.create({
      data: { projectId: project.id, memberId, role: "assistant", content },
    });
    await prisma.proactiveDelivery.create({ data: { memberId, key: item.key } });

    return NextResponse.json({
      message: { role: "assistant", content: msg.content, createdAt: msg.createdAt.toISOString() },
    });
  } catch (err) {
    console.error("proactive error:", err);
    return NextResponse.json({ message: null });
  }
}
