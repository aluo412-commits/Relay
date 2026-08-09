import { NextRequest, NextResponse } from "next/server";
import { googleConfigured, googleAuthUrl } from "@/lib/google";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "g_oauth_state";
const isProd = process.env.NODE_ENV === "production";

// GET /api/auth/google -> begin the OAuth flow (redirect to Google's consent screen).
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/?authError=google_unconfigured", origin));
  }
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(googleAuthUrl(origin, state));
  // Short-lived CSRF token; SameSite=Lax so it survives the top-level redirect back.
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
