// Shared bits for workspace creation + membership.

export const MEMBER_COLORS = ["#e0662a", "#2f7fd1", "#0d9488", "#7c5cd6", "#c2410c", "#0891b2", "#be185d", "#4d7c0f"];

/** A short, human-typeable invite code (no ambiguous chars). */
export function generateInviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function memberColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}
