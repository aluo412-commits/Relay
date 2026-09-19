import { NextRequest, NextResponse } from "next/server";
import { checkAiHealth } from "@/lib/minimax";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/ai-health -> { ok, error? }  (attempts a 1-token completion on the selected model)
export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext().catch(() => null);
    if (!ctx) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    // On page load, only check configuration. A real completion is reserved for
    // the explicit Settings health check, not every tab visit.
    if (req.nextUrl.searchParams.get("passive") === "1") {
      const configured = !!(process.env.LLM_API_KEY || process.env.ZHIPU_API_KEY || process.env.OPENCODE_API_KEY || process.env.MINIMAX_API_KEY);
      return NextResponse.json({ ok: configured, checked: "configuration", ...(configured ? {} : { error: "AI provider key is not configured" }) });
    }
    const health = await checkAiHealth(ctx?.project.model);
    return NextResponse.json(health);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
