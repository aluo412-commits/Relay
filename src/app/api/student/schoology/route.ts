import { NextRequest, NextResponse } from "next/server";
import { readSchoology, validateCalendarUrl } from "@/lib/student/schoology";
import { limitedText, SCHOOL_COOKIE, PRIVATE_HEADERS, privateCookie, sameOrigin, seal } from "@/lib/student/security";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Open Relay in your browser to connect a calendar." }, { status: 403, headers: PRIVATE_HEADERS });
  try {
    const body = JSON.parse(await limitedText(req, 4096));
    if (typeof body.url !== "string") throw new Error("Paste your Schoology calendar subscription link.");
    const url = validateCalendarUrl(body.url).href;
    // Validate before saving; never report a successful connection for an HTML login page.
    const result = await readSchoology(url);
    const res = NextResponse.json({ count: result.items.length, warnings: result.warnings }, { headers: PRIVATE_HEADERS });
    res.cookies.set(SCHOOL_COOKIE, seal({ url }, SCHOOL_COOKIE), privateCookie());
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar connection failed.";
    return NextResponse.json({ error: message.includes("fetch") || message.includes("aborted") ? "Schoology did not respond. Check the link and try again." : message }, { status: 400, headers: PRIVATE_HEADERS });
  }
}
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const res = NextResponse.json({ disconnected: true }, { headers: PRIVATE_HEADERS });
  res.cookies.set(SCHOOL_COOKIE, "", privateCookie(0));
  return res;
}
