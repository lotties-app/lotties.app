/*
 * Original illustrations of Baby Routine, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 *
 * Path builders on the 96 x 96 illustration grid. Every shape is a closed path, so gradients in
 * `objectBoundingBox` units light each one from its own top-left corner. Values are rounded to a
 * tenth of a unit: the strings stay short and the output is deterministic.
 */

export interface Circle {
  x: number;
  y: number;
  r: number;
}

const n = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

const TAU = Math.PI * 2;
const norm = (angle: number) => ((angle % TAU) + TAU) % TAU;
const angleOf = (p: { x: number; y: number }, c: Circle) => Math.atan2(p.y - c.y, p.x - c.x);

/** The two intersection points of circles `a` and `b` (they must overlap). */
function intersect(a: Circle, b: Circle) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const l = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - l * l));
  const mx = a.x + (l * dx) / d;
  const my = a.y + (l * dy) / d;
  return [
    { x: mx + (h * dy) / d, y: my - (h * dx) / d },
    { x: mx - (h * dy) / d, y: my + (h * dx) / d },
  ] as const;
}

/** Clockwise (screen) arc on `c` from `a` to `b`. */
function arcCw(c: Circle, a: { x: number; y: number }, b: { x: number; y: number }) {
  const span = norm(angleOf(b, c) - angleOf(a, c));
  return `A${n(c.r)} ${n(c.r)} 0 ${span > Math.PI ? 1 : 0} 1 ${n(b.x)} ${n(b.y)}`;
}

export function circle(x: number, y: number, r: number): string {
  return `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

export function ellipse(x: number, y: number, rx: number, ry: number): string {
  return `M${n(x - rx)} ${n(y)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
}

/** Rounded rectangle. */
export function rect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return (
    `M${n(x + rr)} ${n(y)}H${n(x + w - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w)} ${n(y + rr)}` +
    `V${n(y + h - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w - rr)} ${n(y + h)}H${n(x + rr)}` +
    `A${n(rr)} ${n(rr)} 0 0 1 ${n(x)} ${n(y + h - rr)}V${n(y + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + rr)} ${n(y)}Z`
  );
}

/** A bar with round ends from (x1, y1) to (x2, y2), `w` wide. */
export function capsule(x1: number, y1: number, x2: number, y2: number, w: number): string {
  const r = w / 2;
  const l = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / l) * r;
  const ny = ((x2 - x1) / l) * r;
  return (
    `M${n(x1 + nx)} ${n(y1 + ny)}L${n(x2 + nx)} ${n(y2 + ny)}` +
    `A${n(r)} ${n(r)} 0 0 0 ${n(x2 - nx)} ${n(y2 - ny)}L${n(x1 - nx)} ${n(y1 - ny)}` +
    `A${n(r)} ${n(r)} 0 0 0 ${n(x1 + nx)} ${n(y1 + ny)}Z`
  );
}

/** Crescent: the part of circle `outer` outside circle `cut`. */
export function crescent(outer: Circle, cut: Circle): string {
  const [p, q] = intersect(outer, cut);
  // Outer arc from p to q through the side away from the cut circle.
  const away = norm(Math.atan2(outer.y - cut.y, outer.x - cut.x) - angleOf(p, outer));
  const cw = norm(angleOf(q, outer) - angleOf(p, outer));
  const sweepOuter = away < cw ? 1 : 0;
  const spanOuter = sweepOuter ? cw : TAU - cw;
  // Inner arc from q back to p through the inside of the outer circle.
  const towards = norm(Math.atan2(outer.y - cut.y, outer.x - cut.x) - angleOf(q, cut));
  const cw2 = norm(angleOf(p, cut) - angleOf(q, cut));
  const sweepInner = towards < cw2 ? 1 : 0;
  const spanInner = sweepInner ? cw2 : TAU - cw2;
  return (
    `M${n(p.x)} ${n(p.y)}A${n(outer.r)} ${n(outer.r)} 0 ${spanOuter > Math.PI ? 1 : 0} ${sweepOuter} ${n(q.x)} ${n(q.y)}` +
    `A${n(cut.r)} ${n(cut.r)} 0 ${spanInner > Math.PI ? 1 : 0} ${sweepInner} ${n(p.x)} ${n(p.y)}Z`
  );
}

/**
 * Cloud outline: overlapping circles from left to right on a flat base. The first and the last
 * circle sit on the base (their bottoms share one y); each neighbour pair must overlap.
 */
export function cloud(circles: readonly Circle[]): string {
  const first = circles[0];
  const last = circles[circles.length - 1];
  let from = { x: first.x, y: first.y + first.r };
  let d = `M${n(from.x)} ${n(from.y)}`;
  for (let i = 1; i < circles.length; i += 1) {
    const [a, b] = intersect(circles[i - 1], circles[i]);
    const top = a.y < b.y ? a : b;
    d += arcCw(circles[i - 1], from, top);
    from = top;
  }
  d += arcCw(last, from, { x: last.x, y: last.y + last.r });
  return `${d}Z`;
}

/** Star with `points` rounded tips (outer radius `R`, inner radius `r`), first tip straight up. */
export function star(x: number, y: number, R: number, r: number, points = 5, round = 0.3): string {
  const corners = Array.from({ length: points * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const radius = i % 2 === 0 ? R : r;
    return { x: x + radius * Math.cos(a), y: y + radius * Math.sin(a) };
  });
  const along = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  return `${corners
    .map((p, i) => {
      const prev = corners[(i - 1 + corners.length) % corners.length];
      const next = corners[(i + 1) % corners.length];
      const t = i % 2 === 0 ? round : round * 0.5;
      const a = along(p, prev, t);
      const b = along(p, next, t);
      return `${i === 0 ? 'M' : 'L'}${n(a.x)} ${n(a.y)}Q${n(p.x)} ${n(p.y)} ${n(b.x)} ${n(b.y)}`;
    })
    .join('')}Z`;
}

/** Four-point sparkle with soft concave sides, `R` from the centre to each tip. */
export function sparkle(x: number, y: number, R: number, pinch = 0.16): string {
  const i = R * pinch;
  const c = (dx: number, dy: number) => `${n(x + dx)} ${n(y + dy)}`;
  return (
    `M${c(0, -R)}C${c(i, -i)} ${c(i, -i)} ${c(R, 0)}C${c(i, i)} ${c(i, i)} ${c(0, R)}` +
    `C${c(-i, i)} ${c(-i, i)} ${c(-R, 0)}C${c(-i, -i)} ${c(-i, -i)} ${c(0, -R)}Z`
  );
}
