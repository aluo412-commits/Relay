import { isDateOnly, quoteExists, type ReaderCard } from "./reader";
export const RELATIVE_TIME = /\b(?:today|tomorrow|tonight|yesterday|this\s+(?:week|weekend|morning|afternoon)|next\s+(?:class|week|monday|tuesday|wednesday|thursday|friday))\b|今天|明天|今晚|昨天/gi;
export function explicitDateInQuote(date: string, quote: string): boolean {
  if (!isDateOnly(date) || /\b(?:posted|published|uploaded|last updated|created on)\b/i.test(quote)) return false;
  if (new RegExp(String.raw`\b${date}\b`).test(quote)) return true;
  const [year, month, day] = date.split("-").map(Number);
  const months = ["jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "jun(?:e)?", "jul(?:y)?", "aug(?:ust)?", "sep(?:t(?:ember)?)?", "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?"];
  return new RegExp(String.raw`\b(?:${months[month - 1]}\.?\s+0?${day}(?:st|nd|rd|th)?[,]?\s+${year}|0?${day}\s+${months[month - 1]}\.?[,]?\s+${year})\b`, "i").test(quote);
}
export function absoluteDateCount(text: string) {
  return new Set((text.match(/\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}\b/gi) || []).map(s => s.toLowerCase().replace(/\s+/g, " "))).size;
}
export function neutralTitle(title: string) {
  return title.replace(new RegExp(`\\b(?:due|by|for|on)\\s+(?=${RELATIVE_TIME.source})`, "gi"), "").replace(RELATIVE_TIME, "").replace(/\s{2,}/g, " ").replace(/^[\s:—–-]+|[\s:—–-]+$/g, "").trim() || "Review source instructions";
}
export function safeCardDate(card: ReaderCard, text?: string): string | null {
  if (!isDateOnly(card.due)) return null;
  if (card.dateOrigin === "reviewed" || card.status === "accepted") return card.due;
  const table = /docs\.google\.com|\/updates|#pdf-/.test(card.sourceUrl);
  if (table && (absoluteDateCount(card.quote) > 1 || !card.dueQuote || absoluteDateCount(card.dueQuote) > 1 || (!quoteExists(card.quote, card.dueQuote) && !quoteExists(card.dueQuote, card.quote)))) return null;
  return card.dueQuote && explicitDateInQuote(card.due, card.dueQuote) && (text === undefined || quoteExists(text, card.dueQuote)) ? card.due : null;
}
export function sourceClosed(title: string, quote = "") {
  if (/(?:school|campus|district|library)\s+(?:is\s+)?closed\b/i.test(title)) return false;
  return /(?:^|[\s:·(])(?:closed|archived|ended)\)?\s*$/i.test(title) || /\((?:closed|archived|ended)\)/i.test(title) || /^(?:status|availability)\s*:\s*(?:closed|archived|ended)\s*$/im.test(quote);
}
export function cardTiming(card: ReaderCard, today: string) {
  const due = safeCardDate(card);
  const partialDate = !due ? /(?<![\d/])((?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01]))(?![\d/])/.exec(card.quote)?.[1] : null;
  const relative = new RegExp(RELATIVE_TIME.source, "i").test(`${card.title} ${card.quote}`);
  const closed = sourceClosed(card.sourceTitle, card.quote);
  return { due, relative, closed, bucket: closed || (due && due < today) ? "past" as const : due ? "dated" as const : "unknown" as const,
    note: closed ? "Source reports closed/archived. This does not establish your submission status." : relative ? `${partialDate ? `Source mentions ${partialDate}, with no verified year/deadline. ` : ""}Relative words belong to the original source—not today. No deadline was inferred from when Relay read it.` : !due ? `${partialDate ? `Source mentions ${partialDate}; year and current relevance are unverified. ` : ""}Date not verified. Not a current-deadline recommendation.` : due < today ? "Past date—not an upcoming reminder. Check the original source if still relevant." : "Date supported by source or reviewed by you." };
}
