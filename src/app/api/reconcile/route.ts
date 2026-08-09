import { NextResponse } from "next/server";
import { runReconcile, loadSyncFeed } from "@/lib/syncFeed";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/reconcile
// Run the AI reconciliation check (flags stale in-progress tasks) and return the
// refreshed feed. Called on member load; safe no-op if the AI is unavailable.
export async function POST() {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ items: [] });
    await runReconcile(ctx.member.id);
    const { items } = await loadSyncFeed(ctx.member.id);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("reconcile error:", err);
    return NextResponse.json({ items: [] });
  }
}
