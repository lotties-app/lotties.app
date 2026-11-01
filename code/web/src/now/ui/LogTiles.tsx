import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Typography } from '@mui/material';
import type { EventType } from '../../db/models';
import { RADIUS } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';
import { Illustration } from '../../ui/illustrations';
import type { StateLine } from '../../medications/statusText';
import { formatTileStatus, tileLabel } from '../nowText';
import type { QuickTile, TileId } from '../quickLog';
import { tileDetailText } from '../tileText';

/** The illustration of each tile (`illustrationFor` keys). */
const ART: Record<TileId, string> = {
  feed: 'bottle',
  diaper: 'diaper',
  meds: 'medication',
  more: 'custom',
};

/** Read by screen readers, not drawn: the longer detail the compact tile has no room for. */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

interface Props {
  tiles: readonly QuickTile[];
  types: readonly EventType[];
  now: Date;
  /** Viewers cannot log. */
  readOnly: boolean;
  /** Where the prescriptions stand ("Next allowed 18:00", "Due now"), shown on the Meds tile. */
  medsLine?: StateLine | null;
  /** Tiles that still open for a reader who cannot log (the Doctor reads the Meds tray). */
  viewable?: readonly TileId[];
  onOpen: (id: TileId) => void;
}

/**
 * "Quick log": Feed, Diaper, Meds, More in one compact row of four (two by two when the column or
 * the text size leaves no room), each with its drawing, a short label and "Last 2h ago". A due
 * dose shows on the Meds tile instead. A tap opens the matching tray.
 */
export function LogTiles({
  tiles,
  types,
  now,
  readOnly,
  medsLine = null,
  viewable = [],
  onOpen,
}: Props) {
  const { t } = useTranslation();
  return (
    <Box
      component="section"
      aria-label={t('now.tiles.region')}
      sx={{ containerType: 'inline-size' }}
    >
      <Typography
        variant="overline"
        component="h2"
        color="text.secondary"
        sx={{ display: 'block', mb: 1 }}
      >
        {t('nowLayout.quickLog.title')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 1,
          // Four tiles under ~4.6rem each stop fitting their labels: two by two instead.
          '@container (max-width: 20rem)': {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          },
        }}
      >
        {tiles.map((tile) => {
          const due = tile.id === 'meds' && medsLine !== null && medsLine.tone === 'due';
          const status =
            tile.id === 'meds' && medsLine ? medsLine.text : formatTileStatus(tile, now);
          const detail =
            tile.id === 'more'
              ? t('now.tiles.moreHint')
              : [
                  tileDetailText(tile, types),
                  tile.id === 'meds' && medsLine ? formatTileStatus(tile, now) : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
          return (
            <ButtonBase
              key={tile.id}
              disabled={readOnly && !viewable.includes(tile.id)}
              onClick={() => onOpen(tile.id)}
              data-testid={`tile-${tile.id}`}
              sx={(theme) => ({
                minHeight: 104,
                px: 0.75,
                py: 1.25,
                gap: 0.5,
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-start',
                textAlign: 'center',
                borderRadius: `${RADIUS.tile}px`,
                backgroundColor: palette(theme).background.paper,
                boxShadow: palette(theme).cardShadow,
                '&:focus-visible': {
                  outline: `2px solid ${palette(theme).primary.main}`,
                  outlineOffset: 2,
                },
                '&.Mui-disabled': { opacity: 0.6 },
              })}
            >
              <Illustration name={ART[tile.id]} size={40} />
              <Typography
                variant="body2"
                component="span"
                sx={{
                  display: 'block',
                  width: '100%',
                  fontWeight: 600,
                  lineHeight: 1.25,
                  overflowWrap: 'break-word',
                  textWrap: 'balance',
                  hyphens: 'auto',
                }}
              >
                {tileLabel(tile.id)}
              </Typography>
              {status && (
                <Typography
                  variant="caption"
                  component="span"
                  color={
                    due ? 'warning.main' : tile.status === 'running' ? 'primary' : 'text.secondary'
                  }
                  sx={{
                    display: 'block',
                    width: '100%',
                    lineHeight: 1.25,
                    fontWeight: due ? 600 : 400,
                    overflowWrap: 'break-word',
                    textWrap: 'balance',
                  }}
                >
                  {status}
                </Typography>
              )}
              {detail && (
                <Box component="span" sx={VISUALLY_HIDDEN}>
                  {`, ${detail}`}
                </Box>
              )}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}
