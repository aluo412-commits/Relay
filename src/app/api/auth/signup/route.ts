import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, limitedText, PRIVATE_HEADERS } from "@/lib/student/security";
import { prisma } from "@/lib/db";
import { hashPassword, signSession, SESSION_COOKIE, WORKSPACE_COOKIE, cookieOptions, SESSION_MAX_AGE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/signup { email, password, name } -> create account + sign in.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const { email, password, name } = JSON.parse(await limitedText(req, 4096)) as {
      email?: string;
      password?: string;
      name?: string;
    };
    if (typeof email !== "string" || typeof password !== "string" || typeof name !== "string" || password.length > 128 || name.length > 100 || email.length > 254) return NextResponse.json({ error: "Invalid account details." }, { status: 400 });
    const cleanEmail = email.trim().toLowerCase();
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
    const res = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } }, { headers: PRIVATE_HEADERS });
    res.cookies.set(WORKSPACE_COOKIE, "", cookieOptions(0));
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE));
    return res;
  } catch (err) {
    console.error("signup error:", err);
    return NextResponse.json({ error: "Account creation could not finish. Check your details and try again." }, { status: 500 });
  }
}
