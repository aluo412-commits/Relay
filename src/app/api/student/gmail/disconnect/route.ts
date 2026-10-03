import { NextRequest, NextResponse } from "next/server";
import { GMAIL_COOKIE, OAUTH_COOKIE, PRIVATE_HEADERS, privateCookie, sameOrigin } from "@/lib/student/security";
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const res = NextResponse.json({ disconnected: true }, { headers: PRIVATE_HEADERS });
  res.cookies.set(GMAIL_COOKIE, "", privateCookie(0));
  res.cookies.set(OAUTH_COOKIE, "", privateCookie(0));
  return res;
}
