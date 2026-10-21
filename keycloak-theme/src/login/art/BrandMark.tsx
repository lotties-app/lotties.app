/*
 * The Lotties app icon (concept B "Day disc"), simplified drawing for small sizes, original
 * work by the project contributors (AGPL-3.0-or-later). Same shapes as docs/design/icons/favicon-b.svg
 * and web/src/ui/BrandMark.tsx. Colours come from the --br-mark-* custom properties in theme.css, so
 * light and dark follow `prefers-color-scheme` with no JavaScript.
 */
import { useId } from 'react';

const CRESCENT = 'M13.74 22.14A9.8 9.8 0 1 0 13.74 3.06A12 12 0 0 1 13.74 22.14Z';
const MASK = { maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 32, height: 32 } as const;

export function BrandMark({ className }: { className?: string }) {
  const id = `brm${useId().replace(/\W/g, '')}`;
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <mask id={`${id}-gap`} {...MASK}>
          <rect width="32" height="32" fill="#fff" />
          <path d={CRESCENT} fill="#000" stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
        </mask>
        <mask id={`${id}-star`} {...MASK}>
          <rect width="32" height="32" fill="#fff" />
          <path
            d="M21.9 7.7C22.2 8.8 22.5 9.1 23.6 9.4C22.5 9.7 22.2 10 21.9 11.1C21.6 10 21.3 9.7 20.2 9.4C21.3 9.1 21.6 8.8 21.9 7.7Z"
            fill="#000"
          />
        </mask>
      </defs>
      <path
        className="br-mark-tile"
        d="M7 0H25A7 7 0 0 1 32 7V25A7 7 0 0 1 25 32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z"
      />
      <g mask={`url(#${id}-gap)`}>
        <circle className="br-mark-day" cx="16" cy="12.6" r="9.8" />
      </g>
      <g mask={`url(#${id}-star)`}>
        <path className="br-mark-night" d={CRESCENT} />
      </g>
      <g className="br-mark-ruler">
        <path d="M5 26H19.4V28H5A1 1 0 0 1 5 26Z" />
        <path d="M20 26.5H27A.5.5 0 0 1 27 27.5H20Z" />
      </g>
      <rect className="br-mark-day" x="19.6" y="24.3" width="2.8" height="5.7" rx="1.4" />
    </svg>
  );
}
