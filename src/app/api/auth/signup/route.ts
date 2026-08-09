import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, signSession, SESSION_COOKIE, cookieOptions, SESSION_MAX_AGE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/signup { email, password, name } -> create account + sign in.
export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = (await req.json()) as {
      email?: string;
      password?: string;
      name?: string;
    };
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail || !password || !name?.trim()) {
      return NextResponse.json({ error: "Name, email and password are required" }, { status: 400 });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) {
      return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
    }

    const user = await prisma.user.create({
      data: { email: cleanEmail, name: name.trim(), passwordHash: await hashPassword(password) },
    });

    const token = await signSession(user.id);
    const res = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE));
    return res;
  } catch (err) {
    console.error("signup error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
