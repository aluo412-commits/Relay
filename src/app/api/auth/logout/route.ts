import { NextResponse } from "next/server";
import { SESSION_COOKIE, WORKSPACE_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/logout -> clear the session + workspace cookies.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(WORKSPACE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
