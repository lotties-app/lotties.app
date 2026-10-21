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

interface Props {
  tiles: readonly QuickTile[];
  types: readonly EventType[];
  now: Date;
  /** Viewers cannot log. */
  readOnly: boolean;
  /** Where the prescriptions stand ("Next allowed 18:00", "Due now"), shown on the Meds tile. */
  medsLine?: StateLine | null;
  onOpen: (id: TileId) => void;
}

/** The "last and log" tiles: Feed, Diaper, Meds, More. A tap opens the matching tray. */
export function LogTiles({ tiles, types, now, readOnly, medsLine = null, onOpen }: Props) {
  const { t } = useTranslation();
  return (
    <Box component="section" aria-label={t('now.tiles.region')}>
      <Typography
        variant="overline"
        component="h2"
        color="text.secondary"
        sx={{ display: 'block', mb: 1 }}
      >
        {t('now.tiles.title')}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
        {tiles.map((tile) => {
          const status = formatTileStatus(tile, now);
          const detail = tile.id === 'more' ? t('now.tiles.moreHint') : tileDetailText(tile, types);
          return (
            <ButtonBase
              key={tile.id}
              disabled={readOnly}
              onClick={() => onOpen(tile.id)}
              sx={(theme) => ({
                minHeight: 120,
                p: 1.5,
                gap: 1,
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                textAlign: 'left',
                borderRadius: `${RADIUS.tile}px`,
                backgroundColor: palette(theme).background.paper,
                boxShadow: palette(theme).cardShadow,
                '&.Mui-disabled': { opacity: 0.6 },
              })}
            >
              <Illustration name={ART[tile.id]} size={48} />
              <Box sx={{ minWidth: 0, width: '100%' }}>
                <Typography variant="subtitle1" component="span" sx={{ display: 'block' }}>
                  {tileLabel(tile.id)}
                </Typography>
                {status && (
                  <Typography
                    variant="caption"
                    component="span"
                    color={tile.status === 'running' ? 'primary' : 'text.secondary'}
                    sx={{ display: 'block' }}
                  >
                    {status}
                  </Typography>
                )}
                {tile.id === 'meds' && medsLine && (
                  <Typography
                    variant="caption"
                    component="span"
                    color={medsLine.tone === 'due' ? 'warning.main' : 'text.secondary'}
                    sx={{ display: 'block', fontWeight: medsLine.tone === 'due' ? 600 : 400 }}
                  >
                    {medsLine.text}
                  </Typography>
                )}
                {detail && (
                  <Typography
                    variant="caption"
                    component="span"
                    color="text.secondary"
                    sx={{ display: 'block' }}
                  >
                    {detail}
                  </Typography>
                )}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}
