import { useRef, type TouchEvent } from 'react';

/** Horizontal travel (px) that counts as a swipe, and how much more horizontal than vertical. */
const SWIPE_DISTANCE = 64;
const SWIPE_RATIO = 1.5;

/** The page is pinch-zoomed in: a sideways drag pans the zoomed view, it is not a swipe. */
const zoomedIn = () => (window.visualViewport?.scale ?? 1) > 1.01;

/**
 * Touch handlers that call `onLeft` / `onRight` after a horizontal swipe (mostly horizontal, at
 * least 64 px). Vertical scrolling is left alone, and so is pinch zoom: a gesture with a second
 * finger is never a swipe, nor is a drag while the page is zoomed in
 * (docs/design/30-mobile-overflow-audit.md).
 */
export function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      start.current =
        touch && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd: (event: TouchEvent) => {
      const from = start.current;
      const touch = event.changedTouches[0];
      start.current = null;
      if (!from || !touch || zoomedIn()) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
      if (dx < 0) onLeft();
      else onRight();
    },
  };
}
