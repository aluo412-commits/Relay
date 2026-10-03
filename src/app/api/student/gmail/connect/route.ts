import { NextRequest, NextResponse } from "next/server";
import { startGmail } from "@/lib/student/gmail";
import { sameOrigin } from "@/lib/student/security";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  return startGmail(req.nextUrl.origin);
}
