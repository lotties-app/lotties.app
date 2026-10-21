/*
 * Hero art of the login theme: the "nap" (cloud with a crescent moon) and "bottle" illustrations of
 * Baby Routine, original works by the project contributors, licensed under the project licence
 * (AGPL-3.0-or-later). Shapes are the same as web/src/ui/illustrations/{sleep,feeding}.tsx; colours
 * come from CSS custom properties (tokens.generated.css), so light and dark follow
 * `prefers-color-scheme` with no JavaScript. Gradient recipe: docs/design/ILLUSTRATIONS.md.
 */
import { capsule, cloud, crescent, rect, sparkle } from './geometry';

const NAP_CLOUD = cloud([
  { x: 27, y: 66, r: 12 },
  { x: 46, y: 55, r: 19 },
  { x: 67, y: 64, r: 14 },
]);
const NAP_MOON = crescent({ x: 66, y: 28, r: 15 }, { x: 74, y: 21, r: 12 });
const TEAT = 'M39 28C39 19 43 12 48 12C53 12 57 19 57 28Z';
const COLLAR = rect(35, 26, 26, 9, 3.5);
const BOTTLE_BODY = rect(34, 33, 28, 50, 11);
const BOTTLE_MILK = rect(38.5, 51, 19, 27.5, 7);

const MATERIALS = ['cloud', 'moon', 'glass', 'teat', 'milk'] as const;
type Material = (typeof MATERIALS)[number];

function Body({ m, d }: { m: Material; d: string }) {
  return (
    <>
      <path d={d} fill={`url(#br-fill-${m})`} />
      <path d={d} fill={`url(#br-vol-${m})`} />
    </>
  );
}

function Shine({ d }: { d: string }) {
  return <path d={d} className="br-art-shine" />;
}

export function HeroArt({ label }: { label?: string }) {
  return (
    <svg
      className="br-art"
      viewBox="0 0 176 96"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        {MATERIALS.map((m) => (
          <linearGradient key={m} id={`br-fill-${m}`} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" style={{ stopColor: `var(--il-${m}-hi)` }} />
            <stop offset="0.5" style={{ stopColor: `var(--il-${m}-mid)` }} />
            <stop offset="1" style={{ stopColor: `var(--il-${m}-end)` }} />
          </linearGradient>
        ))}
        {MATERIALS.map((m) => (
          <radialGradient key={m} id={`br-vol-${m}`} cx="0.3" cy="0.24" r="0.95">
            <stop offset="0" stopColor="#fff" style={{ stopOpacity: 'var(--il-vol-white)' }} />
            <stop offset="0.38" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.7" style={{ stopColor: `var(--il-${m}-lo)` }} stopOpacity="0" />
            <stop offset="1" style={{ stopColor: `var(--il-${m}-lo)`, stopOpacity: 'var(--il-vol-rim)' }} />
          </radialGradient>
        ))}
        <radialGradient id="br-ground">
          <stop offset="0" style={{ stopColor: 'var(--il-cloud-lo)' }} stopOpacity="0.35" />
          <stop offset="1" style={{ stopColor: 'var(--il-cloud-lo)' }} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="47" cy="85" rx="30" ry="5" fill="url(#br-ground)" />
      <ellipse cx="130" cy="85" rx="22" ry="5" fill="url(#br-ground)" />
      <g>
        <Body m="moon" d={NAP_MOON} />
        <Body m="cloud" d={NAP_CLOUD} />
        <Shine d={capsule(33, 52, 38, 45, 5)} />
        <Shine d={capsule(55, 24, 58, 18, 3.5)} />
      </g>
      <g transform="translate(80 0) rotate(12 48 50)">
        <Body m="teat" d={TEAT} />
        <Body m="glass" d={BOTTLE_BODY} />
        <Body m="milk" d={BOTTLE_MILK} />
        <Body m="glass" d={COLLAR} />
        <path d={capsule(50, 42, 56, 42, 3)} style={{ fill: 'var(--il-glass-hi)' }} opacity="0.85" />
        <Shine d={capsule(39.5, 40, 39.5, 47, 4)} />
        <Shine d={capsule(44, 21, 46, 16, 3)} />
      </g>
      <path d={sparkle(100, 22, 6.5)} style={{ fill: 'var(--il-moon-mid)' }} opacity="0.9" />
      <path d={sparkle(168, 30, 4.5)} style={{ fill: 'var(--il-cloud-mid)' }} opacity="0.9" />
    </svg>
  );
}
