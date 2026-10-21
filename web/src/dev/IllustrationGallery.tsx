import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { SCHEMES, SCHEME_NAMES, type SchemeName } from '../theme/tokens';
import { SegmentedControl } from '../ui/form';
import { ILLUSTRATIONS, ILLUSTRATION_NAMES, type IllustrationName } from '../ui/illustrations';

/** Sizes the illustrations must hold: see `SIZE_GRID` for where each one is used. */
const SIZES = [24, 32, 40, 48, 64, 96] as const;

/** The size grid of the app: the size in px and the places that use it. */
const SIZE_GRID: readonly { size: number; where: string }[] = [
  { size: 24, where: 'Day ribbon legend, small chips' },
  { size: 32, where: 'Day rows, toast, forgotten notice, type menu' },
  { size: 40, where: 'Tiles (compact)' },
  { size: 48, where: 'Log tiles, More sheet, tray headers, nursing and timer cards' },
  { size: 64, where: 'Event sheet header, first-run choices' },
  { size: 96, where: 'Hero: Now state card, empty states, estimated nap sheet' },
];

type Background = 'surface' | 'tint';

const SCHEME_LABEL: Record<SchemeName, string> = {
  light: 'Light',
  dark: 'Dark',
  night: 'Night',
};

/** Tile around an illustration of `size`: the stamp the app will use (about 1.5x, rounded). */
const tileOf = (size: number) => Math.round(size * 1.5);

/**
 * Developer-only: every illustration at 24 / 32 / 48 / 64 / 96 px in the light, dark and night
 * schemes side by side, on the page surface or on the category tint (route `/dev/illustrations`,
 * `?bg=tint|surface&glow=1`).
 */
export default function IllustrationGallery() {
  const [params, setParams] = useSearchParams();
  const background: Background = params.get('bg') === 'surface' ? 'surface' : 'tint';
  const glow = params.get('glow') === '1';
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh', p: 2 }}>
      <Box component="header" sx={{ display: 'grid', gap: 1.5, maxWidth: 640, mb: 2 }}>
        <Typography variant="h4" component="h1">
          Illustrations
        </Typography>
        <SegmentedControl<Background>
          aria-label="Background"
          value={background}
          onChange={(value) => value && set('bg', value)}
          options={[
            { value: 'tint', label: 'On category tint' },
            { value: 'surface', label: 'On surface' },
          ]}
        />
        <SegmentedControl<'0' | '1'>
          aria-label="Glow"
          value={glow ? '1' : '0'}
          onChange={(value) => value && set('glow', value)}
          options={[
            { value: '0', label: 'No glow' },
            { value: '1', label: 'Glow' },
          ]}
        />
      </Box>
      <Box component="section" aria-label="Size grid" sx={{ mb: 2, display: 'grid', gap: 0.5 }}>
        <Typography variant="h5" component="h2">
          Size grid
        </Typography>
        {SIZE_GRID.map(({ size, where }) => (
          <Typography key={size} variant="body2" data-size-grid={size}>
            {`${size} px: ${where}`}
          </Typography>
        ))}
      </Box>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fit, minmax(620px, 1fr))',
        }}
      >
        {SCHEME_NAMES.map((scheme) => (
          <SchemePanel key={scheme} scheme={scheme} background={background} glow={glow} />
        ))}
      </Box>
    </Box>
  );
}

function SchemePanel({
  scheme,
  background,
  glow,
}: {
  scheme: SchemeName;
  background: Background;
  glow: boolean;
}) {
  const t = SCHEMES[scheme];
  return (
    <Box
      component="section"
      aria-label={`${SCHEME_LABEL[scheme]} scheme`}
      data-scheme-panel={scheme}
      sx={{ bgcolor: t.background, color: t.text, borderRadius: 5, p: 2, display: 'grid', gap: 1 }}
    >
      <Typography variant="h5" component="h2" sx={{ color: t.text }}>
        {SCHEME_LABEL[scheme]}
      </Typography>
      {ILLUSTRATION_NAMES.map((name) => (
        <Row key={name} name={name} scheme={scheme} background={background} glow={glow} />
      ))}
    </Box>
  );
}

function Row({
  name,
  scheme,
  background,
  glow,
}: {
  name: IllustrationName;
  scheme: SchemeName;
  background: Background;
  glow: boolean;
}) {
  const t = SCHEMES[scheme];
  const { component: Component, category } = ILLUSTRATIONS[name];
  const tileColor = background === 'tint' ? t.category[category].bg : t.surface;
  return (
    <Box
      data-illustration-row={name}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: tileOf(96) + 8 }}
    >
      <Typography
        variant="caption"
        component="p"
        sx={{ width: 64, flexShrink: 0, color: t.textMuted, overflowWrap: 'anywhere' }}
      >
        {name}
      </Typography>
      {SIZES.map((size) => (
        <Box
          key={size}
          sx={{
            width: tileOf(size),
            height: tileOf(size),
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: size <= 32 ? '50%' : `${Math.round(size / 3)}px`,
            bgcolor: tileColor,
          }}
        >
          <Component
            size={size}
            scheme={scheme}
            glow={glow && size >= 64}
            title={size === 96 ? `${name} (${SCHEME_LABEL[scheme]})` : undefined}
          />
        </Box>
      ))}
    </Box>
  );
}
