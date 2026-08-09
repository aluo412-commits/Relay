import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId, getActiveWorkspaceId } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/auth/me -> the signed-in user, their workspaces, and the active one.
// Returns { user: null } when signed out (the client then shows the auth screen).
export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ user: null });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ user: null });

    const members = await prisma.member.findMany({
      where: { userId },
      include: { project: true },
      orderBy: { project: { createdAt: "asc" } },
    });

    const workspaces = members.map((m) => ({
      id: m.projectId,
      name: m.project.name,
      memberId: m.id,
      role: m.role,
      admin: m.admin,
      inviteCode: m.project.inviteCode,
    }));

    const cookieWs = await getActiveWorkspaceId();
    const activeWorkspaceId =
      workspaces.find((w) => w.id === cookieWs)?.id ?? workspaces[0]?.id ?? null;

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email },
      workspaces,
      activeWorkspaceId,
    });
  } catch (err) {
    console.error("me error:", err);
    return NextResponse.json({ user: null });
  }
}
