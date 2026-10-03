import { limitedText } from "./security";
import { CALENDAR_URL, DISTRICT_URL, type StudyItem } from "./types";

export function plainText(html: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", hellip: "…" };
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] !== "#") return named[entity] ?? whole;
    const n = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  }).replace(/\s+/g, " ").trim();
}
/** Extract only official Finalsite article records. No navigation text or model guesses. */
export function parseDistrict(html: string, kind: "news" | "calendar"): StudyItem[] {
  const items = new Map<string, StudyItem>();
  if (!html.includes(kind === "news" ? "fsPostElement" : "fsCalendar")) throw new Error("The district website format changed. Open the original website while we reconnect.");
  for (const match of html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)) {
    const [, attributes, body] = match;
    if (kind === "news") {
      const id = /data-post-id="(\d+)"/.exec(attributes)?.[1];
      const title = /class="fsTitle[^"]*"[^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(body)?.[1];
      const slug = /data-slug="([a-z\d\-/]+)"/.exec(body)?.[1];
      if (!id || !title) continue;
      items.set(id, { id: `district:news:${id}`, source: "district", kind: "announcement", title: plainText(title), description: "Published on the FUHSD website. Open the original announcement for full details.", date: null, allDay: false, url: slug ? `${DISTRICT_URL}/newsroom/~board/${slug}` : `${DISTRICT_URL}/newsroom` });
    } else {
      const event = /class="fsCalendarEventLink"[^>]*data-occur-id="(\d+)"[^>]*>([\s\S]*?)<\/a>/i.exec(body);
      const date = /<time\b[^>]*datetime="([^"]+)"/i.exec(body)?.[1];
      if (!event || !date || !Number.isFinite(Date.parse(date))) continue;
      const allDay = body.includes('class="fsAllDay"');
      const location = /class="fsLocation"[^>]*>([\s\S]*?)<\/div>/.exec(body)?.[1];
      items.set(event[1], { id: `district:event:${event[1]}`, source: "district", kind: "event", title: plainText(event[2]), description: "From the official FUHSD district calendar. School-specific activities may be listed separately.", date: allDay ? date.slice(0, 10) : date, allDay, url: CALENDAR_URL, location: location ? plainText(location) : undefined });
    }
  }
  return [...items.values()];
}
export async function readDistrict(): Promise<StudyItem[]> {
  const results = await Promise.all([DISTRICT_URL, CALENDAR_URL].map(async (url, i) => {
    const res = await fetch(url, { redirect: "error", next: { revalidate: 900 }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error("The district website is temporarily unavailable.");
    return parseDistrict(await limitedText(res, 1_500_000), i === 0 ? "news" : "calendar");
  }));
  return results.flat();
}
