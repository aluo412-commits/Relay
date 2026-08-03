import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { NotificationDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/notifications?memberId=  -> that member's notifications (recent) + unread count.
export async function GET(req: NextRequest) {
  try {
    const memberId = req.nextUrl.searchParams.get("memberId");
    if (!memberId) return NextResponse.json({ notifications: [], unread: 0 });
    const rows = await prisma.notification.findMany({
      where: { recipientId: memberId },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const notifications: NotificationDTO[] = rows.map((n) => ({
      id: n.id,
      kind: n.kind as NotificationDTO["kind"],
      text: n.text,
      importance: (n.importance as NotificationDTO["importance"]) ?? null,
      fromName: n.fromName,
      boardName: n.boardName,
      taskName: n.taskName,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    }));
    const unread = notifications.filter((n) => !n.read).length;
    return NextResponse.json({ notifications, unread });
  } catch (err) {
    console.error("notifications GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/notifications { memberId, ids?, all? } -> mark read.
export async function POST(req: NextRequest) {
  try {
    const { memberId, ids, all } = (await req.json()) as {
      memberId?: string;
      ids?: string[];
      all?: boolean;
    };
    if (all && memberId) {
      await prisma.notification.updateMany({ where: { recipientId: memberId }, data: { read: true } });
    } else if (ids?.length) {
      await prisma.notification.updateMany({ where: { id: { in: ids } }, data: { read: true } });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("notifications POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
