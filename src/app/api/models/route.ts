import { NextResponse } from "next/server";
import { listModels } from "@/lib/minimax";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/models -> { models: string[], current: string }
// The models the provider serves + the active workspace's currently-selected one.
export async function GET() {
  try {
    const [models, ctx] = await Promise.all([listModels(), getContext().catch(() => null)]);
    return NextResponse.json({ models, current: ctx?.project.model ?? "" });
  } catch (err) {
    return NextResponse.json({ models: [], current: "", error: (err as Error).message });
  }
}
