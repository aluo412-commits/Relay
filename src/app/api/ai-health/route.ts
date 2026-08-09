import { NextResponse } from "next/server";
import { checkAiHealth } from "@/lib/minimax";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/ai-health -> { ok, error? }  (attempts a 1-token completion on the selected model)
export async function GET() {
  try {
    const ctx = await getContext().catch(() => null);
    const health = await checkAiHealth(ctx?.project.model);
    return NextResponse.json(health);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
