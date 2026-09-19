// Fast, bounded context recall: don't spend a second model round-trip before chat.
export function selectRecallIds(message: string, entries: { id: string; heading: string; summary: string }[]): string[] {
  if (!message.trim()) return [];
  // A short memory needs no ranking at all.
  if (entries.length <= 3) return entries.map(e => e.id);
  const tokens = (text: string) => {
    const normalized = text.toLowerCase();
    const words: string[] = normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
    // Chinese bigrams allow matching without a segmentation dependency.
    for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
      for (let i = 0; i < run.length - 1; i++) words.push(run.slice(i, i + 2));
    }
    return new Set(words);
  };
  const query = tokens(message);
  const ranked = entries.map((entry, index) => {
    const heading = tokens(entry.heading), summary = tokens(entry.summary);
    const score = [...query].reduce((n, term) => n + (heading.has(term) ? 3 : summary.has(term) ? 1 : 0), 0);
    return { id: entry.id, score, index };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  // Recent context is a bounded fallback for follow-ups like "continue that plan".
  return ranked.length ? ranked.slice(0, 3).map(e => e.id) : entries.slice(0, 2).map(e => e.id);
}
