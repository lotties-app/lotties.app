/** Width of the growth chart's viewBox (the SVG scales to its container). */
export const CHART_WIDTH = 480;

/** Smallest rendered label size (docs/DESIGN.md: 12 px floor; review 05 M13 measured 7.4 px). */
export const MIN_LABEL_PX = 12;

/**
 * Label size in viewBox units so that labels render at `MIN_LABEL_PX` or more. Before the width is
 * known it assumes the narrowest phone column (320 px viewport, 2 x 16 px gutter, 2 x 16 px card
 * padding), so even the first frame is never below the floor.
 */
export function labelSize(renderedWidth: number | null): number {
  const width = renderedWidth ?? 256;
  return Math.max(11, Math.ceil((MIN_LABEL_PX * CHART_WIDTH) / width));
}
