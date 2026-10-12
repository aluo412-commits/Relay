import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, PRIVATE_HEADERS } from "@/lib/student/security";
import { SESSION_COOKIE, WORKSPACE_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/logout -> clear the session + workspace cookies.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const res = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(WORKSPACE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
