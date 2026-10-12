import { NextRequest, NextResponse } from "next/server";
import { requireStudent, studentError, StudentAccessError } from "@/lib/student/account";
import { startGmail } from "@/lib/student/gmail";
import { sameOrigin, limitedText } from "@/lib/student/security";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const account = await requireStudent();
    const body = new URLSearchParams(await limitedText(req, 2000));
    if (body.get("binding") !== account.binding) throw new StudentAccessError("Account changed. Refresh Relay before connecting email.", 409);
    return startGmail(req.nextUrl.origin, account);
  } catch (e) { return studentError(e); }
}
