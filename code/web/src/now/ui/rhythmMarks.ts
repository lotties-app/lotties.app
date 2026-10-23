import type { Point } from '../ringGeometry';

/**
 * Styles of the marks of the ring and the ruler (`.rhythm-mark` with its `.rhythm-ring`): no
 * browser outline, the selection ring in the accent shown on keyboard focus and on the selected
 * mark, a fainter one on hover with a mouse, a short fade that reduced motion turns off, and the
 * system highlight in forced colours. Spread into the `sx` of the chart's container.
 */
export const rhythmMarkSx = {
  '& .rhythm-mark': { outline: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  '& .rhythm-ring': {
    opacity: 0,
    pointerEvents: 'none',
    transition: 'opacity 150ms ease-out',
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
  },
  '@media (hover: hover)': { '& .rhythm-mark:hover .rhythm-ring': { opacity: 0.5 } },
  '& .rhythm-mark:focus-visible .rhythm-ring, & .rhythm-mark[aria-pressed="true"] .rhythm-ring': {
    opacity: 1,
  },
  '@media (forced-colors: active)': {
    '& .rhythm-ring': { stroke: 'Highlight', borderColor: 'Highlight' },
  },
} as const;

/**
 * A point of an SVG drawn in a `size` wide view box, as the zero-size box a tooltip anchors to
 * (the middle of an arc, the top of the face), so the tooltip points at the mark, not at the
 * corner of its touch target.
 */
export function virtualAnchor(svg: SVGSVGElement | null, point: Point, size: number) {
  return {
    getBoundingClientRect: () => {
      const box = svg?.getBoundingClientRect();
      const scale = box ? box.width / size : 0;
      const x = (box?.left ?? 0) + point.x * scale;
      const y = (box?.top ?? 0) + point.y * scale;
      return {
        x,
        y,
        left: x,
        right: x,
        top: y,
        bottom: y,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    },
  };
}
