/*
 * Original illustrations of Baby Routine, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 *
 * Tiny colour maths for the illustration palette: hex parsing, mixing, saturation and WCAG
 * contrast. Plain functions, no dependencies.
 */

type Rgb = readonly [number, number, number];

function parse(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** `a` moved `t` (0..1) of the way towards `b`, in sRGB. */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** Pushes the colour away from its grey by `amount` (0.1 = 10% more chroma), keeping lightness. */
export function saturate(hex: string, amount: number): string {
  const rgb = parse(hex);
  const grey = (Math.max(...rgb) + Math.min(...rgb)) / 2;
  return toHex(rgb.map((v) => grey + (v - grey) * (1 + amount)));
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio of two opaque colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Blue channel (0..255): the night scheme keeps it at or below 0x78. */
export function blue(hex: string): number {
  return parse(hex)[2];
}
