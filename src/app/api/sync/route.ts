import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadSyncFeed } from "@/lib/syncFeed";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/sync  -> your ranked "in sync" feed.
export async function GET() {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ items: [] });
    const { items } = await loadSyncFeed(ctx.member.id);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("sync GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/sync  { key }  -> dismiss an item so it stops surfacing.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const memberId = ctx.member.id;
    const { key } = (await req.json()) as { key?: string };
    if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
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
