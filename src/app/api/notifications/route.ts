import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getContext } from "@/lib/session";
import type { NotificationDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/notifications  -> your notifications (recent) + unread count.
export async function GET() {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ notifications: [], unread: 0 });
    const rows = await prisma.notification.findMany({
      where: { recipientId: ctx.member.id },
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

// POST /api/notifications { ids?, all? } -> mark read (scoped to you).
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { ids, all } = (await req.json()) as { ids?: string[]; all?: boolean };
    if (all) {
      await prisma.notification.updateMany({ where: { recipientId: ctx.member.id }, data: { read: true } });
    } else if (ids?.length) {
      await prisma.notification.updateMany({
        where: { id: { in: ids }, recipientId: ctx.member.id },
        data: { read: true },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("notifications POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
