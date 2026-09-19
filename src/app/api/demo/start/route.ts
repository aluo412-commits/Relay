import { NextResponse } from "next/server";

// Retire the old DB-backed demo bootstrap. The demo now runs entirely in-browser.
export async function POST() {
  return NextResponse.json({ error: "Open /demo for the scripted, local-only tour." }, { status: 410 });
}
