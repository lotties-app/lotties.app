/*
 * Original illustrations of Baby Routine, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 */
import { useContext, useId, type ReactNode } from 'react';
import { ThemeModeContext } from '../../theme/ThemeModeContext';
import type { SchemeName } from '../../theme/tokens';
import { mix } from './color';
import { tone, type Hue, type NightRole, type Tone } from './palette';

/** Props every illustration takes. */
export interface IllustrationProps {
  /** Rendered width and height in px (24 to 96 stay crisp). Default 48. */
  size?: number;
  /** Colour scheme; defaults to the scheme the app shows (light, dark or night). */
  scheme?: SchemeName;
  /** Accessible name. Without it the illustration is decorative (`aria-hidden`). */
  title?: string;
  /** Soft halo behind the object (hero places). Never drawn in the night scheme. */
  glow?: boolean;
  /**
   * Reserved: the illustrations are static today. Any future motion must stay off when this is
   * set, in the night scheme and under `prefers-reduced-motion`.
   */
  still?: boolean;
  className?: string;
}

/** One material of a drawing: its hue in light and dark, and its role in the night scheme. */
export interface Material {
  hue: Hue;
  night?: NightRole;
  /** Light scheme only: 0..1 towards the pastel of the hue (secondary parts, see `tone`). */
  lift?: number;
}

/** What a drawing gets to paint with. */
export interface Kit {
  scheme: SchemeName;
  /** Night: flat fills, no glow, no shadow. */
  flat: boolean;
  /** Body fill of a material: a top-left lit gradient, or the flat body colour in night. */
  fill: (material: string) => string;
  /** Volume overlay (highlight plus soft inner shade), `undefined` in night. */
  volume: (material: string) => string | undefined;
  /** Tone of each material, by key (solid details: eyes, letters, stripes). */
  tones: Readonly<Record<string, Tone>>;
  /** Specular highlight paint of a material. */
  shine: (material: string) => { fill: string; opacity: number };
}

const VIEWBOX = '0 0 96 96';
/**
 * Optical size for rows and small tiles (32 px and under): the view box hugs the drawing so the
 * object is about 12% larger, and the ground glow (mud at that size) is left out.
 */
const VIEWBOX_COMPACT = '5 5 86 86';
const COMPACT_MAX = 32;

interface FrameProps extends IllustrationProps {
  /** Registry name, exposed as `data-illustration`. */
  name: string;
  materials: Readonly<Record<string, Material>>;
  /** Material whose colour tints the ground glow and the halo. */
  main: string;
  /** Ground glow under the object (centre x, radius x), or `false` for none. */
  ground?: { x: number; rx: number } | false;
  children: (kit: Kit) => ReactNode;
}

/**
 * Shared `<svg>` of every illustration: 96 x 96 grid, unique gradient ids per instance (`useId`),
 * light from the top-left, a soft ground glow, an optional halo, decorative unless titled. In the
 * night scheme everything is flat (no gradient, shadow, glow or halo).
 */
export function IllustrationFrame({
  name,
  materials,
  main,
  ground = { x: 48, rx: 26 },
  size = 48,
  scheme: requested,
  title,
  glow = false,
  className,
  children,
}: FrameProps) {
  const shown = useContext(ThemeModeContext)?.scheme;
  const scheme: SchemeName = requested ?? shown ?? 'dark';
  const uid = `il${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const flat = scheme === 'night';
  const tones: Record<string, Tone> = {};
  for (const [key, m] of Object.entries(materials))
    tones[key] = tone(scheme, m.hue, m.night, m.lift);
  const ref = (key: string, suffix = '') => `${uid}-${key}${suffix}`;
  const kit: Kit = {
    scheme,
    flat,
    fill: (key) => (flat ? tones[key].mid : `url(#${ref(key)})`),
    volume: (key) => (flat ? undefined : `url(#${ref(key, '-v')})`),
    tones,
    shine: (key) =>
      flat
        ? { fill: tones[key].hi, opacity: 0.55 }
        : { fill: '#ffffff', opacity: scheme === 'light' ? 0.62 : 0.5 },
  };
  const mainTone = tones[main];
  const light = scheme === 'light';
  const compact = size <= COMPACT_MAX;
  const showGround = ground && !flat && !compact;
  const showGlow = glow && !flat;
  return (
    <svg
      width={size}
      height={size}
      viewBox={compact ? VIEWBOX_COMPACT : VIEWBOX}
      className={className}
      data-illustration={name}
      data-scheme={scheme}
      data-main={mainTone.mid}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    >
      {!flat && (
        <defs>
          {Object.entries(tones).map(([key, t]) => (
            <linearGradient key={key} id={ref(key)} x1="0.2" y1="0" x2="0.8" y2="1">
              <stop offset="0" stopColor={t.hi} />
              <stop offset="0.5" stopColor={t.mid} />
              <stop offset="1" stopColor={light ? mix(t.mid, t.lo, 0.4) : t.lo} />
            </linearGradient>
          ))}
          {Object.entries(tones).map(([key, t]) => (
            <radialGradient key={key} id={ref(key, '-v')} cx="0.3" cy="0.24" r="0.95">
              <stop offset="0" stopColor="#ffffff" stopOpacity={light ? 0.42 : 0.36} />
              <stop offset="0.38" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="0.7" stopColor={t.lo} stopOpacity="0" />
              <stop offset="1" stopColor={t.lo} stopOpacity={light ? 0.42 : 0.6} />
            </radialGradient>
          ))}
          {showGround && (
            <radialGradient id={ref('ground')}>
              <stop
                offset="0"
                stopColor={light ? mainTone.lo : mainTone.mid}
                stopOpacity={light ? 0.3 : 0.42}
              />
              <stop offset="1" stopColor={light ? mainTone.lo : mainTone.mid} stopOpacity="0" />
            </radialGradient>
          )}
          {showGlow && (
            <radialGradient id={ref('glow')}>
              <stop offset="0" stopColor={light ? mainTone.hi : mainTone.mid} stopOpacity="0.5" />
              <stop
                offset="0.55"
                stopColor={light ? mainTone.hi : mainTone.mid}
                stopOpacity="0.18"
              />
              <stop offset="1" stopColor={light ? mainTone.hi : mainTone.mid} stopOpacity="0" />
            </radialGradient>
          )}
        </defs>
      )}
      {showGlow && <circle cx="48" cy="48" r="48" fill={`url(#${ref('glow')})`} />}
      {showGround && (
        <ellipse cx={ground.x} cy="85" rx={ground.rx} ry="5" fill={`url(#${ref('ground')})`} />
      )}
      {children(kit)}
    </svg>
  );
}

/** A solid body: its fill plus the volume overlay (highlight and soft inner shade). */
export function Body({
  kit,
  m,
  d,
  transform,
}: {
  kit: Kit;
  m: string;
  d: string;
  transform?: string;
}) {
  const volume = kit.volume(m);
  return (
    <g transform={transform}>
      <path d={d} fill={kit.fill(m)} />
      {volume && <path d={d} fill={volume} />}
    </g>
  );
}

/** A specular highlight (small glossy spot, top-left of a body). */
export function Shine({ kit, m, d }: { kit: Kit; m: string; d: string }) {
  const { fill, opacity } = kit.shine(m);
  return <path d={d} fill={fill} opacity={opacity} />;
}
