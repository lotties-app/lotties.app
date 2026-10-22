/*
 * Geometry of the hand-built Insights charts (no chart library), pure and unit-tested: a clean
 * value axis, column bands capped at 24 px, stacked segments with a 2 px surface gap, columns with a
 * 4 px rounded data end and a square base, which columns get a date label, and rhythm-row spans.
 * Everything is in viewBox units; the SVG scales with its container.
 */

export const HOUR_MS = 3_600_000;
/** Widest column (dataviz mark spec): the band's leftover is air. */
export const MAX_BAR = 24;
/** Surface gap between stacked segments. */
export const SEGMENT_GAP = 2;
/** Radius of a column's data end. */
export const BAR_RADIUS = 4;

export interface ValueAxis {
  max: number;
  ticks: number[];
}

const COUNT_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12].map((h) => h * HOUR_MS);

function axisFrom(value: number, steps: readonly number[], targetTicks: number): ValueAxis {
  const top = Math.max(value, 0);
  const step = steps.find((s) => Math.ceil(top / s) <= targetTicks) ?? steps[steps.length - 1];
  const max = Math.max(step, Math.ceil(top / step) * step);
  const ticks: number[] = [];
  for (let tick = 0; tick <= max + step / 2; tick += step) ticks.push(tick);
  return { max, ticks };
}

/** Axis for whole counts (feeds, diapers): 0 and round steps, at most `targetTicks` above 0. */
export const countAxis = (maxValue: number, targetTicks = 4) =>
  axisFrom(maxValue, COUNT_STEPS, targetTicks);

/** Axis for durations in ms, stepped in whole hours. */
export const hoursAxis = (maxMs: number, targetTicks = 4) =>
  axisFrom(maxMs, HOUR_STEPS, targetTicks);

export interface Band {
  /** Centre of the band. */
  center: number;
  /** Width of the column drawn in it. */
  bar: number;
  x: number;
}

/**
 * `count` equal bands over [x0, x0 + width]; each column takes `fill` of its band (at most
 * `MAX_BAR`) and is centred in it.
 */
export function bands(count: number, x0: number, width: number, fill = 0.62): Band[] {
  if (count <= 0) return [];
  const band = width / count;
  const bar = Math.max(1, Math.min(MAX_BAR, band * fill));
  return Array.from({ length: count }, (_, index) => {
    const center = x0 + band * (index + 0.5);
    return { center, bar, x: center - bar / 2 };
  });
}

/**
 * Path of a column from `baseY` up to `topY` with a rounded data end and a square base. Empty when
 * there is nothing to draw; the radius shrinks for very short columns.
 */
export function columnPath(x: number, width: number, topY: number, baseY: number): string {
  const height = baseY - topY;
  if (height <= 0 || width <= 0) return '';
  const r = Math.min(BAR_RADIUS, width / 2, height);
  const right = x + width;
  return [
    `M${x},${baseY}`,
    `V${topY + r}`,
    `Q${x},${topY} ${x + r},${topY}`,
    `H${right - r}`,
    `Q${right},${topY} ${right},${topY + r}`,
    `V${baseY}`,
    'Z',
  ].join(' ');
}

export interface Segment {
  index: number;
  /** Top (smaller y) and bottom of the segment. */
  top: number;
  bottom: number;
  /** Only the topmost drawn segment gets the rounded data end. */
  isTop: boolean;
}

/**
 * Stacked segments of one column (bottom to top) for `values`, with a `SEGMENT_GAP` surface gap
 * between drawn segments. `scale` maps a value to its height. Zero values are skipped.
 */
export function stackSegments(
  values: readonly number[],
  scale: (value: number) => number,
  baseY: number,
): Segment[] {
  const segments: Segment[] = [];
  let bottom = baseY;
  values.forEach((value, index) => {
    if (value <= 0) return;
    const height = scale(value);
    const gap = segments.length > 0 ? SEGMENT_GAP : 0;
    const segmentBottom = bottom - gap;
    const top = Math.min(segmentBottom, bottom - height);
    segments.push({ index, top, bottom: segmentBottom, isTop: false });
    bottom = top;
  });
  const drawn = segments.filter((segment) => segment.bottom - segment.top > 0);
  if (drawn.length > 0) drawn[drawn.length - 1].isTop = true;
  return drawn;
}

/**
 * Columns that carry a date label: every column up to 7, otherwise every 7th counted back from the
 * newest (so today, a week ago, ... are labelled).
 */
export function labelledColumns(count: number): number[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index);
  const result: number[] = [];
  for (let index = count - 1; index >= 0; index -= 7) result.unshift(index);
  return result;
}

/** Keeps a label of `textWidth` centred on `x` inside [min, max]. */
export function clampLabel(x: number, textWidth: number, min: number, max: number): number {
  const half = textWidth / 2;
  if (max - min <= textWidth) return (min + max) / 2;
  return Math.min(max - half, Math.max(min + half, x));
}

/** Rough width of a label (no layout in pure code): average glyph about 0.56 em. */
export const estimateTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.56;

/** Row height of the rhythm chart: roomy for a week, compact for a month. */
export function rhythmRowHeight(rows: number): number {
  if (rows <= 7) return 22;
  if (rows <= 14) return 16;
  return 10;
}

/** A rhythm span (fractions of the row) in viewBox units, at least 1.5 units wide. */
export function spanRect(from: number, to: number, x0: number, width: number) {
  const x = x0 + Math.max(0, Math.min(1, from)) * width;
  const end = x0 + Math.max(0, Math.min(1, to)) * width;
  return { x, width: Math.max(1.5, end - x) };
}

export interface LabelBox {
  index: number;
  /** Centre of the label. */
  x: number;
  width: number;
}

/**
 * The labels that fit without touching, in priority order (the first wins: pass the newest day
 * first), at least `gap` units apart. Long localized dates ("14 de out.") drop a neighbour instead
 * of overlapping it.
 */
export function nonOverlapping(labels: readonly LabelBox[], gap = 8): LabelBox[] {
  const kept: LabelBox[] = [];
  for (const label of labels) {
    const clear = kept.every(
      (other) => Math.abs(other.x - label.x) >= (other.width + label.width) / 2 + gap,
    );
    if (clear) kept.push(label);
  }
  return kept;
}
