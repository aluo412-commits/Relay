import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId, WORKSPACE_COOKIE, cookieOptions, SESSION_MAX_AGE } from "@/lib/auth";
import { memberColor } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// POST /api/workspace/join { inviteCode, role? } -> join a workspace by code, select it.
export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { inviteCode, role } = (await req.json()) as { inviteCode?: string; role?: string };
    const code = inviteCode?.trim().toUpperCase();
    if (!code) return NextResponse.json({ error: "Enter an invite code" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const project = await prisma.project.findUnique({ where: { inviteCode: code } });
    if (!project) return NextResponse.json({ error: "No workspace matches that code" }, { status: 404 });

    // Already a member? Just select it.
    const existing = await prisma.member.findFirst({ where: { userId, projectId: project.id } });
    if (!existing) {
      const count = await prisma.member.count({ where: { projectId: project.id } });
      await prisma.member.create({
        data: {
          userId,
          projectId: project.id,
          name: user.name,
          color: memberColor(count),
          role: role?.trim() || null,
          admin: false,
        },
      });
    }

    const res = NextResponse.json({ workspace: { id: project.id, name: project.name } });
    res.cookies.set(WORKSPACE_COOKIE, project.id, cookieOptions(SESSION_MAX_AGE));
    return res;
  } catch (err) {
    console.error("workspace join error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
