export const SCHOOL_TIMEZONE = "America/Los_Angeles";
export const SCHOOLOGY_URL = "https://fuhsd.schoology.com";
export const DISTRICT_URL = "https://www.fuhsd.org";
export const CALENDAR_URL = `${DISTRICT_URL}/about-us/general-information/calendar`;

export type SourceId = "district" | "schoology" | "gmail";
export type StudyItem = {
  id: string;
  source: SourceId;
  kind: "assignment" | "event" | "announcement" | "mail";
  title: string;
  description: string;
  url: string;
  date: string | null;
  allDay: boolean;
  course?: string;
  sender?: string;
  location?: string;
};
export type SourceState = {
  id: SourceId;
  status: "connected" | "disconnected" | "error" | "setup_required";
  message: string;
  checkedAt: string | null;
  account?: string;
  warnings?: string[];
};
export type StudyDashboard = {
  items: StudyItem[];
  sources: SourceState[];
  fetchedAt: string;
  schoologyProfile: string | null;
};

export function dayKey(date: string | Date): string {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
}
export function dateLabel(date: string, options: Intl.DateTimeFormatOptions = {}): string {
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return new Intl.DateTimeFormat("en-US", { timeZone: allDay ? "UTC" : SCHOOL_TIMEZONE, month: "short", day: "numeric", ...options }).format(new Date(allDay ? `${date}T12:00:00Z` : date));
}
export function offsetDay(date: string, offset: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
