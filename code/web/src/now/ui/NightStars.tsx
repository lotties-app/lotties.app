import { Box } from '@mui/material';

/*
 * A few pin-prick stars behind the Now screen in the night scheme. Original, CSS only: one
 * background of tiny radial gradients at fixed spots. Static (no animation), very low contrast
 * (they must never compete with text), warm like the rest of the scheme, and dropped when the
 * person asks for less data or less transparency. Nothing is drawn in light or dark.
 */

/** [x %, y %, radius px] of each star; fixed, so the sky is the same on every visit. */
const STARS: readonly (readonly [number, number, number])[] = [
  [6, 5, 1],
  [19, 11, 0.8],
  [33, 4, 1],
  [47, 9, 0.8],
  [61, 3, 1.2],
  [77, 8, 0.8],
  [91, 5, 1],
  [12, 22, 0.8],
  [27, 28, 1],
  [54, 24, 0.8],
  [70, 30, 1],
  [88, 21, 0.8],
  [4, 40, 1],
  [38, 44, 0.8],
  [83, 42, 1.2],
  [16, 58, 0.8],
  [64, 55, 1],
  [93, 62, 0.8],
  [29, 72, 1],
  [49, 79, 0.8],
  [76, 76, 1],
  [9, 88, 0.8],
  [58, 92, 1],
  [86, 90, 0.8],
];

const STAR_COLOR = 'color-mix(in srgb, var(--mui-palette-text-primary, #d49a5e) 26%, transparent)';

const SKY = STARS.map(
  ([x, y, radius]) =>
    `radial-gradient(${radius}px ${radius}px at ${x}% ${y}%, ${STAR_COLOR}, transparent)`,
).join(', ');

/** The night sky; render it once inside a stacking context (it sits at `z-index: -1`). */
export function NightStars() {
  return (
    <Box
      aria-hidden
      data-testid="night-stars"
      sx={{
        display: 'none',
        '[data-night] &': {
          display: 'block',
          position: 'fixed',
          inset: 0,
          zIndex: -1,
          pointerEvents: 'none',
          backgroundImage: SKY,
          backgroundRepeat: 'no-repeat',
        },
        '@media (prefers-reduced-data: reduce), (prefers-reduced-transparency: reduce)': {
          '[data-night] &': { display: 'none' },
        },
      }}
    />
  );
}
