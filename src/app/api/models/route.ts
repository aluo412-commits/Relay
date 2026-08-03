import { NextResponse } from "next/server";
import { listModels } from "@/lib/minimax";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

// GET /api/models -> { models: string[], current: string }
// The models the provider actually serves + the team's currently-selected one.
export async function GET() {
  try {
    const [models, state] = await Promise.all([
      listModels(),
      loadState().catch(() => null),
    ]);
    return NextResponse.json({ models, current: state?.project.model ?? "" });
  } catch (err) {
    return NextResponse.json({ models: [], current: "", error: (err as Error).message });
  }
}
