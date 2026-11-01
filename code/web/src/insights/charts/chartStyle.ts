import { useEffect, useRef, useState } from 'react';
import type { Theme } from '@mui/material';
import type { ChartColors } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';

/**
 * Read by screen readers, not shown. In pixels: `sx` reads `width: 1` as 100 %, and a hidden text a
 * full line wide pushed the page sideways (docs/design/30-mobile-overflow-audit.md).
 */
export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/*
 * Shared non-component bits of the Insights charts: the rendered width (labels are sized in
 * viewBox units so they never render under 12 px, like the growth chart) and series colours from
 * the chart tokens (CSS variables, so light, dark and night follow the scheme).
 */

export type SeriesColor = keyof ChartColors;

export const chartColor = (theme: Theme, color: SeriesColor) => palette(theme).chart[color];

/** Width the SVG is drawn at, in CSS pixels (`null` until measured). */
export function useRenderedWidth<T extends Element>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width;
      if (next) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Gentle fade-in; the global styles drop it under reduced motion and in the night scheme. */
export const fadeIn = {
  '@keyframes insightsFadeIn': { from: { opacity: 0 }, to: { opacity: 1 } },
  animation: 'insightsFadeIn 220ms ease-out',
} as const;
