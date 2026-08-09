import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId, WORKSPACE_COOKIE, cookieOptions, SESSION_MAX_AGE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/workspace/select { workspaceId } -> set the active workspace cookie.
export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { workspaceId } = (await req.json()) as { workspaceId?: string };
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

    const member = await prisma.member.findFirst({ where: { userId, projectId: workspaceId } });
    if (!member) return NextResponse.json({ error: "You're not a member of that workspace" }, { status: 403 });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(WORKSPACE_COOKIE, workspaceId, cookieOptions(SESSION_MAX_AGE));
    return res;
  } catch (err) {
    console.error("workspace select error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
