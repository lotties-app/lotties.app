import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Typography } from '@mui/material';
import type { EventType } from '../../db/models';
import { RADIUS, type CategoryName } from '../../theme/tokens';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { palette } from '../../ui/form/styles';
import type { IconName } from '../../ui/icons';
import { formatTileStatus, tileLabel } from '../nowText';
import type { QuickTile, TileId } from '../quickLog';
import { tileDetailText } from '../tileText';

const LOOK: Record<TileId, { icon: IconName; category: CategoryName }> = {
  feed: { icon: 'bottle', category: 'feeding' },
  diaper: { icon: 'diaper', category: 'diaper' },
  meds: { icon: 'pill', category: 'health' },
  more: { icon: 'add', category: 'custom' },
};

interface Props {
  tiles: readonly QuickTile[];
  types: readonly EventType[];
  now: Date;
  /** Viewers cannot log. */
  readOnly: boolean;
  onOpen: (id: TileId) => void;
}

/** The "last and log" tiles: Feed, Diaper, Meds, More. A tap opens the matching tray. */
export function LogTiles({ tiles, types, now, readOnly, onOpen }: Props) {
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
          const look = LOOK[tile.id];
          const status = formatTileStatus(tile, now);
          const detail = tile.id === 'more' ? t('now.tiles.moreHint') : tileDetailText(tile, types);
          return (
            <ButtonBase
              key={tile.id}
              disabled={readOnly}
              onClick={() => onOpen(tile.id)}
              sx={(theme) => ({
                minHeight: 96,
                p: 1.5,
                gap: 1.5,
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                textAlign: 'left',
                borderRadius: `${RADIUS.tile}px`,
                backgroundColor: palette(theme).background.paper,
                boxShadow: palette(theme).cardShadow,
                '&.Mui-disabled': { opacity: 0.6 },
              })}
            >
              <CategoryIcon name={look.icon} category={look.category} />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
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
