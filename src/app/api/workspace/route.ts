import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId, WORKSPACE_COOKIE, cookieOptions, SESSION_MAX_AGE } from "@/lib/auth";
import { generateInviteCode, memberColor } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// POST /api/workspace { name, role? } -> create a workspace, join it as admin, select it.
export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { name, role } = (await req.json()) as { name?: string; role?: string };
    if (!name?.trim()) return NextResponse.json({ error: "Workspace name is required" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    // Unique invite code (retry on the rare collision).
    let inviteCode = generateInviteCode();
    for (let i = 0; i < 5; i++) {
      const clash = await prisma.project.findUnique({ where: { inviteCode } });
      if (!clash) break;
      inviteCode = generateInviteCode();
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        inviteCode,
        model: "claude-haiku-4-5",
        members: {
          create: {
            userId,
            name: user.name,
            color: memberColor(0),
            role: role?.trim() || null,
            admin: true,
          },
        },
        // A workspace starts with one empty board to work in.
        boards: {
          create: { name: "General", color: memberColor(0), summary: "Your first workstream — rename it or start another." },
        },
      },
    });

    const res = NextResponse.json({
      workspace: { id: project.id, name: project.name, inviteCode: project.inviteCode },
    });
    res.cookies.set(WORKSPACE_COOKIE, project.id, cookieOptions(SESSION_MAX_AGE));
    return res;
  } catch (err) {
    console.error("workspace create error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
