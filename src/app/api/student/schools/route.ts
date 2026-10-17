import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { PRIVATE_HEADERS } from "@/lib/student/security";
import { schoolSearchUrl, parseSchoolResults, NCES_SOURCE } from "@/lib/student/schoolDirectory";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
// Best-effort per-instance guard, not a distributed abuse-control system.
const attempts = new Map<string, { at: number; count: number }>();
export async function GET(req: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
  const uid = await getSessionUserId();
  if (!uid) return json({ error: "Sign into Relay before searching the directory." }, 401);
  const now = Date.now(), prior = attempts.get(uid), usage = prior && now - prior.at < 60000 ? prior : { at: now, count: 0 };
  if (++usage.count > 30) return json({ error: "Too many directory searches. Wait a minute and try again." }, 429);
  if (attempts.size >= 2000 && !attempts.has(uid)) attempts.delete(attempts.keys().next().value!);
  attempts.set(uid, usage);
  let url: URL;
  try { url = schoolSearchUrl(req.nextUrl.searchParams.get("q") || "", req.nextUrl.searchParams.get("state") || ""); }
  catch (e) { return json({ error: (e as Error).message }, 400); }
  try {
    // Fixed federal public-data endpoint only. User-supplied school URLs are
    // never fetched here and never become extension permissions.
    const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(9000), next: { revalidate: 900 } });
    if (!r.ok || !r.body) throw new Error("Directory unavailable");
    const reader = r.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 256000) { await reader.cancel(); throw new Error("Directory response too large"); } chunks.push(value); } } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return json({ schools: parseSchoolResults(body), source: NCES_SOURCE, year: "2024–25", limited: body.exceededTransferLimit === true || body.features?.length === 20 });
  } catch { return json({ error: "The NCES public-school directory is unavailable right now. Use the local school list or add your school links below. No connection has been made." }, 502); }
}
