export type SpotlightRect = { top: number; left: number; right: number; bottom: number };

/** One interpolated rectangle drives the cutout, outline, and hit-test panels. */
export function interpolateSpotlight(from: SpotlightRect, to: SpotlightRect, progress: number): SpotlightRect {
  const p = Math.min(1, Math.max(0, progress));
  const eased = 1 - (1 - p) ** 3;
  return {
    top: from.top + (to.top - from.top) * eased,
    left: from.left + (to.left - from.left) * eased,
    right: from.right + (to.right - from.right) * eased,
    bottom: from.bottom + (to.bottom - from.bottom) * eased,
  };
}
