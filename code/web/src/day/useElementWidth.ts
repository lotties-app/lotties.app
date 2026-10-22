import { useEffect, useRef, useState } from 'react';

/**
 * The content width of an element in CSS pixels, kept current by a ResizeObserver (no layout reads
 * during render); `null` until measured or where ResizeObserver is missing (tests).
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width;
      if (next) setWidth((current) => (current === next ? current : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
