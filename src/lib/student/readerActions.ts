import type { ReaderCard } from "./reader";
const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export function cardGroupKey(c: ReaderCard) {
  const source = new URL(c.sourceUrl); if (c.due) source.hash = "";
  return JSON.stringify([source.href, c.kind, c.requirement, c.due, normalized(c.quote)]);
}
export function groupCards(cards: ReaderCard[]) {
  const groups = new Map<string, { card: ReaderCard; ids: string[] }>();
  for (const card of cards) { const key = cardGroupKey(card), existing = groups.get(key); if (!existing) groups.set(key, { card, ids: [card.id] }); else { existing.ids.push(card.id); if (card.status === "accepted" || (card.doneAt && !existing.card.doneAt)) existing.card = card; } }
  return [...groups.values()];
}
export function mergeAnalyzedCards(current: ReaderCard[], incoming: ReaderCard[], sourceIds: string[]) {
  const old = new Map(current.map(c => [c.id, c]));
  const result = new Map(current.filter(c => !sourceIds.includes(c.sourceId) || c.hiddenAt || c.doneAt || c.status === "accepted").map(c => [c.id, c]));
  for (const c of incoming) {
    const previous = old.get(c.id) || current.find(p => p.sourceTextHash === c.sourceTextHash && cardGroupKey(p) === cardGroupKey(c));
    if (previous && previous.id !== c.id && result.has(previous.id)) continue;
    result.set(c.id, previous?.status === "accepted" ? previous : { ...c, hiddenAt: previous?.hiddenAt || null, doneAt: previous?.doneAt || null, doneSourceHash: previous?.doneSourceHash || null, hiddenSourceHash: previous?.hiddenSourceHash || null });
  }
  return [...result.values()];
}
export function patchCardActions(cards: ReaderCard[], ids: string[], action: "hide" | "restore" | "done" | "reopen", now = new Date().toISOString()) {
  const selected = new Set(ids);
  return cards.map(c => !selected.has(c.id) ? c : action === "hide" ? { ...c, hiddenAt: now, hiddenSourceHash: c.sourceTextHash } : action === "restore" ? { ...c, hiddenAt: null } : action === "done" ? { ...c, doneAt: now, doneSourceHash: c.sourceTextHash } : { ...c, doneAt: null });
}
