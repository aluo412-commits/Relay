import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadSyncFeed } from "@/lib/syncFeed";

export const dynamic = "force-dynamic";

// GET /api/sync?memberId=  -> ranked "in sync" feed for that member.
export async function GET(req: NextRequest) {
  try {
    const memberId = req.nextUrl.searchParams.get("memberId");
    if (!memberId) return NextResponse.json({ items: [] });
    const { items } = await loadSyncFeed(memberId);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("sync GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/sync  { memberId, key }  -> dismiss an item so it stops surfacing.
export async function POST(req: NextRequest) {
  try {
    const { memberId, key } = (await req.json()) as { memberId?: string; key?: string };
    if (!memberId || !key) return NextResponse.json({ error: "memberId and key are required" }, { status: 400 });
    if (key.startsWith("reconcile:")) {
      // Dismissing a reconcile item resolves its flag.
      await prisma.reconcileFlag.updateMany({ where: { id: key.slice("reconcile:".length), memberId }, data: { resolved: true } });
    } else {
      await prisma.syncDismissal.upsert({
        where: { memberId_key: { memberId, key } },
        create: { memberId, key },
        update: {},
      });
    }
    const { items } = await loadSyncFeed(memberId);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("sync POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
