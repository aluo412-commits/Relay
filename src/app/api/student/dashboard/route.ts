import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { googleConfigured } from "@/lib/google";
import { readDistrict } from "@/lib/student/district";
import { readSchoology } from "@/lib/student/schoology";
import { readGmail, type GmailConnection } from "@/lib/student/gmail";
import { GMAIL_COOKIE, SCHOOL_COOKIE, PRIVATE_HEADERS, privateCookie, seal, unseal } from "@/lib/student/security";
import { dayKey, offsetDay, type StudyDashboard, type SourceState, type StudyItem } from "@/lib/student/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const fetchedAt = new Date().toISOString();
  const calendar = unseal<{ url: string }>(req.cookies.get(SCHOOL_COOKIE)?.value, SCHOOL_COOKIE);
  const gmail = unseal<GmailConnection>(req.cookies.get(GMAIL_COOKIE)?.value, GMAIL_COOKIE);
  let refreshed: GmailConnection | null = null;
  type Result = { items: StudyItem[]; source: SourceState };
  const tasks: Promise<Result>[] = [
    readDistrict().then(items => ({ items, source: { id: "district", status: "connected", message: "Official FUHSD news and district events. Public pages refresh at most every 15 minutes.", checkedAt: fetchedAt } } as Result)).catch(() => ({ items: [], source: { id: "district", status: "error", message: "The district website could not be read. Try again or open fuhsd.org.", checkedAt: null } })),
    calendar ? readSchoology(calendar.url).then(({ items, warnings }) => ({ items, source: { id: "schoology", status: "connected", message: "Calendar entries only. Grades, attachments and submission status are not included.", warnings, checkedAt: fetchedAt } } as Result)).catch(err => ({ items: [], source: { id: "schoology", status: "error", message: err instanceof Error && !err.message.includes("fetch") ? err.message : "Schoology is unavailable. Check your calendar link and try again.", checkedAt: null } })) : Promise.resolve({ items: [], source: { id: "schoology", status: "disconnected", message: "Connect your Schoology calendar to see your own assignments and course events.", checkedAt: null } }),
    gmail ? readGmail(gmail).then(result => {
      if (result.connection !== gmail) refreshed = result.connection;
      return { items: result.items, source: { id: "gmail", status: "connected", message: "Up to 12 recent inbox messages from FUHSD and Schoology. Subject, sender and preview only; no attachments.", checkedAt: fetchedAt, account: gmail.email } } as Result;
    }).catch(() => ({ items: [], source: { id: "gmail", status: "error", message: "Google could not provide school email. Reconnect or check your school’s access policy.", checkedAt: null, account: gmail.email } })) : Promise.resolve({ items: [], source: { id: "gmail", status: googleConfigured() ? "disconnected" : "setup_required", message: googleConfigured() ? "Authorize read-only access to bring school email into your day." : "Google OAuth credentials must be configured before email can connect.", checkedAt: null } }),
  ];
  const results = await Promise.all(tasks);
  const since = offsetDay(dayKey(fetchedAt), -30);
  const until = offsetDay(dayKey(fetchedAt), 180);
  for (const result of results) {
    result.items = result.items.filter(item => !item.date || (dayKey(item.date) >= since && dayKey(item.date) <= until));
    if (result.source.id === "schoology" && result.items.length > 400) {
      const future = result.items.filter(i => !i.date || dayKey(i.date) >= dayKey(fetchedAt)).sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
      const past = result.items.filter(i => i.date && dayKey(i.date) < dayKey(fetchedAt)).sort((a, b) => b.date!.localeCompare(a.date!));
      result.items = [...future, ...past].slice(0, 400);
      result.source.warnings = [...(result.source.warnings ?? []), "Only 400 Schoology entries are shown, prioritizing upcoming dates. Open Schoology for the full calendar."];
    }
  }
  const body: StudyDashboard = {
    items: results.flatMap(r => r.items).sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999")).slice(0, 500),
    sources: results.map(r => r.source), fetchedAt,
    schoologyProfile: calendar ? createHash("sha256").update(calendar.url).digest("hex").slice(0, 16) : null,
  };
  const res = NextResponse.json(body, { headers: PRIVATE_HEADERS });
  if (refreshed) res.cookies.set(GMAIL_COOKIE, seal(refreshed, GMAIL_COOKIE), privateCookie());
  return res;
}
