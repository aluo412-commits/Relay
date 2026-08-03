import { NextRequest, NextResponse } from "next/server";
import { runReconcile, loadSyncFeed } from "@/lib/syncFeed";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/reconcile { memberId }
// Run the AI reconciliation check (flags stale in-progress tasks) and return the
// refreshed feed. Called on member load; safe no-op if the AI is unavailable.
export async function POST(req: NextRequest) {
  try {
    const { memberId } = (await req.json()) as { memberId?: string };
    if (!memberId) return NextResponse.json({ items: [] });
    await runReconcile(memberId);
    const { items } = await loadSyncFeed(memberId);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("reconcile error:", err);
    return NextResponse.json({ items: [] });
  }
}
