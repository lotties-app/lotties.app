import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, type SxProps, type Theme } from '@mui/material';

const IMAGE_ROLE = 'img';

/** At or below this size the simplified drawing is used (whole-pixel shapes, no gradients). */
const SIMPLE_MAX = 32;

/**
 * Brand colours of the app icon (docs/design/07-app-icon.md, concept B "Day disc"). Fixed art, not
 * theme roles: the icon is the same object wherever it appears; only its tile and inks follow the
 * light or dark scheme.
 */
const LIGHT = {
  tile: '#f5efe4',
  tileHi: '#fffcf6',
  tileLo: '#ebe2d0',
  day: '#b04c29',
  dayHi: '#dc7c55',
  dayMid: '#ca552d',
  dayLo: '#bc502c',
  night: '#2a251f',
  nightHi: '#5d554a',
  nightMid: '#3a332b',
  nightLo: '#342d26',
  ruler: '#2a251f',
  now: '#ca552d',
} as const;
type Colours = Record<keyof typeof LIGHT, string>;
const DARK: Colours = {
  tile: '#24201b',
  tileHi: '#332e27',
  tileLo: '#1b1814',
  day: '#e58f68',
  dayHi: '#f3cdbb',
  dayMid: '#e58f68',
  dayLo: '#c76c49',
  night: '#f2eadc',
  nightHi: '#faf7f1',
  nightMid: '#f2eadc',
  nightLo: '#cac0b0',
  ruler: '#cac0b0',
  now: '#e58f68',
};

/** Custom properties on the svg: dark values under the theme's dark scheme (night included). */
function colourVars(theme: Theme) {
  const vars = (c: Colours) =>
    Object.fromEntries(Object.entries(c).map(([key, value]) => [`--bm-${key}`, value]));
  return { ...vars(LIGHT), ...theme.applyStyles('dark', vars(DARK)) };
}

const fill = (key: keyof Colours) => ({ fill: `var(--bm-${key})` });
const stop = (key: keyof Colours) => ({ stopColor: `var(--bm-${key})` });

const TILE_1024 =
  'M230 0H794A230 230 0 0 1 1024 230V794A230 230 0 0 1 794 1024H230A230 230 0 0 1 0 794V230A230 230 0 0 1 230 0Z';
const CRESCENT_1024 = 'M458.9 671.8A230 230 0 1 0 458.9 224.2A236 236 0 0 1 458.9 671.8Z';
const BEAD_1024 = 'M608 716L608 792A12 12 0 0 0 632 792L632 716A12 12 0 0 0 608 716Z';
const MASK_1024 = {
  maskUnits: 'userSpaceOnUse',
  x: -200,
  y: -200,
  width: 1424,
  height: 1424,
} as const;

/** The full icon art (docs/design/icons/icon-b.svg and icon-b-dark.svg), 1024 grid. */
function FullArt({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={stop('tileHi')} />
          <stop offset="0.55" style={stop('tile')} />
          <stop offset="1" style={stop('tileLo')} />
        </linearGradient>
        <linearGradient id={`${id}-day`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" style={stop('dayHi')} />
          <stop offset="0.5" style={stop('dayMid')} />
          <stop offset="1" style={stop('dayLo')} />
        </linearGradient>
        <linearGradient id={`${id}-night`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" style={stop('nightHi')} />
          <stop offset="0.5" style={stop('nightMid')} />
          <stop offset="1" style={stop('nightLo')} />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={TILE_1024} />
        </clipPath>
        <mask id={`${id}-gap`} {...MASK_1024}>
          <rect x="-200" y="-200" width="1424" height="1424" fill="#fff" />
          <path
            d={CRESCENT_1024}
            fill="#000"
            stroke="#000"
            strokeWidth="20"
            strokeLinejoin="round"
          />
        </mask>
        <mask id={`${id}-star`} {...MASK_1024}>
          <rect x="-200" y="-200" width="1424" height="1424" fill="#fff" />
          <path
            d="M668 342C674.6 365.4 674.6 365.4 698 372C674.6 378.6 674.6 378.6 668 402C661.4 378.6 661.4 378.6 638 372C661.4 365.4 661.4 365.4 668 342Z"
            fill="#000"
          />
          <circle cx="690" cy="520" r="9" fill="#000" />
        </mask>
        <mask id={`${id}-now`} {...MASK_1024}>
          <rect x="-200" y="-200" width="1424" height="1424" fill="#fff" />
          <path d={BEAD_1024} fill="#000" stroke="#000" strokeWidth="28" strokeLinejoin="round" />
        </mask>
      </defs>
      <path d={TILE_1024} fill={`url(#${id}-tile)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <g mask={`url(#${id}-gap)`}>
          <circle cx="512" cy="448" r="230" fill={`url(#${id}-day)`} />
        </g>
        <g mask={`url(#${id}-star)`}>
          <path d={CRESCENT_1024} fill={`url(#${id}-night)`} />
        </g>
        <g mask={`url(#${id}-now)`} style={fill('ruler')}>
          <rect x="166" y="744" width="464" height="20" rx="10" />
          <rect x="615.5" y="749.5" width="237" height="9" rx="4.5" />
        </g>
        <path d={BEAD_1024} style={fill('now')} />
      </g>
    </>
  );
}

const CRESCENT_32 = 'M13.74 22.14A9.8 9.8 0 1 0 13.74 3.06A12 12 0 0 1 13.74 22.14Z';
const MASK_32 = { maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 32, height: 32 } as const;

/** The simplified drawing for 16 to 32 px (docs/design/icons/favicon-b.svg), 32 grid. */
function SimpleArt({ id }: { id: string }) {
  return (
    <>
      <defs>
        <mask id={`${id}-gap`} {...MASK_32}>
          <rect width="32" height="32" fill="#fff" />
          <path
            d={CRESCENT_32}
            fill="#000"
            stroke="#000"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </mask>
        <mask id={`${id}-star`} {...MASK_32}>
          <rect width="32" height="32" fill="#fff" />
          <path
            d="M21.9 7.7C22.2 8.8 22.5 9.1 23.6 9.4C22.5 9.7 22.2 10 21.9 11.1C21.6 10 21.3 9.7 20.2 9.4C21.3 9.1 21.6 8.8 21.9 7.7Z"
            fill="#000"
          />
        </mask>
      </defs>
      <path
        d="M7 0H25A7 7 0 0 1 32 7V25A7 7 0 0 1 25 32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z"
        style={fill('tile')}
      />
      <g mask={`url(#${id}-gap)`}>
        <circle cx="16" cy="12.6" r="9.8" style={fill('day')} />
      </g>
      <g mask={`url(#${id}-star)`}>
        <path d={CRESCENT_32} style={fill('night')} />
      </g>
      <g style={fill('ruler')}>
        <path d="M5 26H19.4V28H5A1 1 0 0 1 5 26Z" />
        <path d="M20 26.5H27A.5.5 0 0 1 27 27.5H20Z" />
      </g>
      <rect x="19.6" y="24.3" width="2.8" height="5.7" rx="1.4" style={fill('now')} />
    </>
  );
}

export interface BrandMarkProps {
  /** Icon edge in px; at 32 or less the simplified drawing is used. Default 32. */
  size?: number;
  /**
   * Shows the name "Baby Routine" next to the icon, as live text in the display font. The icon is
   * then decorative, so a screen reader hears the name once.
   */
  showName?: boolean;
  /** Hides the icon from assistive technology when a heading or label beside it names the app. */
  decorative?: boolean;
  /** Element of the name text (`span` by default; `p` or a heading where one fits the page). */
  nameComponent?: 'span' | 'p' | 'h1' | 'h2';
  sx?: SxProps<Theme>;
}

/**
 * The app icon (concept B "Day disc") as inline SVG, optionally with the wordmark. Icon only, it is
 * an image named by `t('app.name')`; with the name or `decorative` it is hidden from assistive
 * technology so the name is announced once.
 */
export function BrandMark({
  size = 32,
  showName = false,
  decorative = false,
  nameComponent = 'span',
  sx,
}: BrandMarkProps) {
  const { t } = useTranslation();
  const id = `bm${useId().replace(/\W/g, '')}`;
  const simple = size <= SIMPLE_MAX;
  const hidden = showName || decorative;
  const icon = (
    <Box
      component="svg"
      viewBox={simple ? '0 0 32 32' : '0 0 1024 1024'}
      width={size}
      height={size}
      focusable="false"
      {...(hidden ? { 'aria-hidden': true } : { role: IMAGE_ROLE, 'aria-label': t('app.name') })}
      data-brand-mark={simple ? 'simple' : 'full'}
      sx={(theme) => ({ display: 'block', flexShrink: 0, ...colourVars(theme) })}
    >
      {simple ? <SimpleArt id={id} /> : <FullArt id={id} />}
    </Box>
  );
  if (!showName) return <Box sx={sx}>{icon}</Box>;
  return (
    <Stack
      direction="row"
      spacing={size >= 48 ? 2 : 1.25}
      sx={[{ alignItems: 'center' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {icon}
      <Box
        component={nameComponent}
        sx={(theme) => ({
          m: 0,
          fontFamily: theme.typography.fontFamilyDisplay,
          fontWeight: 600,
          fontSize: `${Math.round(size * 0.75)}px`,
          lineHeight: 1.1,
          letterSpacing: '-0.01em',
          color: 'text.primary',
        })}
      >
        {t('app.name')}
      </Box>
    </Stack>
  );
}
