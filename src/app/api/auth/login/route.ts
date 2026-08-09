import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  verifyPassword,
  signSession,
  SESSION_COOKIE,
  WORKSPACE_COOKIE,
  cookieOptions,
  SESSION_MAX_AGE,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/login { email, password } -> sign in, select first workspace.
export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (user && !user.passwordHash) {
      return NextResponse.json(
        { error: 'This account uses Google — click "Continue with Google".' },
        { status: 401 }
      );
    }
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }

    const firstMembership = await prisma.member.findFirst({
      where: { userId: user.id },
      orderBy: { project: { createdAt: "asc" } },
    });

    const token = await signSession(user.id);
    const res = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE));
    if (firstMembership) {
      res.cookies.set(WORKSPACE_COOKIE, firstMembership.projectId, cookieOptions(SESSION_MAX_AGE));
    }
    return res;
  } catch (err) {
    console.error("login error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
