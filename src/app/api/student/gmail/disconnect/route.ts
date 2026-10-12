import { NextRequest, NextResponse } from "next/server";
import { requireStudent, studentError, connectionCookie } from "@/lib/student/account";
import { GMAIL_COOKIE, OAUTH_COOKIE, PRIVATE_HEADERS, privateCookie, sameOrigin } from "@/lib/student/security";
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  let account; try { account = await requireStudent(req); } catch (e) { return studentError(e); }
  const res = NextResponse.json({ disconnected: true }, { headers: PRIVATE_HEADERS });
  res.cookies.set(connectionCookie(GMAIL_COOKIE, account), "", privateCookie(0));
  res.cookies.set(OAUTH_COOKIE, "", privateCookie(0));
  return res;
}
