import { NextResponse } from "next/server";
import { checkAiHealth } from "@/lib/minimax";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

// GET /api/ai-health -> { ok, error? }  (attempts a 1-token completion on the selected model)
export async function GET() {
  try {
    const model = await loadState().then((s) => s.project.model).catch(() => undefined);
    const health = await checkAiHealth(model);
    return NextResponse.json(health);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
