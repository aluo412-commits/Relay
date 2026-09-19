import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/session";
import { loadState } from "@/lib/state";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lightweight shared snapshot only: no AI, private chat, drafts or lastSeen writes.
export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const [state, logs, notifications] = await Promise.all([
      loadState(ctx.project.id),
      prisma.logEntry.findMany({
        where: { projectId: ctx.project.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
        select: { id: true, text: true, synced: true, createdAt: true, member: { select: { name: true } } },
      }),
      prisma.notification.findMany({
        where: { projectId: ctx.project.id, recipientId: ctx.member.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50,
      }),
    ]);
    const payload = {
      memberId: ctx.member.id, state,
      entries: logs.reverse().map(({ member, ...log }) => ({ ...log, memberName: member.name })),
      notifications,
      unread: await prisma.notification.count({ where: { projectId: ctx.project.id, recipientId: ctx.member.id, read: false } }),
    };
    const content = JSON.stringify(payload);
    const etag = `"${createHash("sha256").update(content).digest("hex")}"`;
    const headers = { "Cache-Control": "private, no-cache, must-revalidate", Vary: "Cookie", ETag: etag };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(content, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("live snapshot error", error);
    return NextResponse.json({ error: "Workspace sync temporarily unavailable" }, { status: 503 });
  }
}
