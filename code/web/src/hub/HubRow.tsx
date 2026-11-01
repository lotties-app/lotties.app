import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Chip, Typography } from '@mui/material';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import type { HubEntry } from './hubEntries';
import { recordHubUse } from './hubUsage';

/** The icon on a soft tinted disc: the same stamp on rows and shortcut tiles. */
export function EntryStamp({ entry, size = 40 }: { entry: HubEntry; size?: number }) {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        flex: '0 0 auto',
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        backgroundColor: `color-mix(in srgb, ${palette(theme).primary.main} 14%, transparent)`,
        color: palette(theme).primary.main,
      })}
    >
      <Icon name={entry.icon} size={size >= 44 ? 24 : 20} />
    </Box>
  );
}

/** The attention count: a chip for the eye and a sentence for a screen reader. */
export function AttentionBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <>
      <Chip aria-hidden size="small" color="primary" label={count} data-testid="hub-badge" />
      <Box component="span" sx={visuallyHidden}>
        {t('hub.badge', { count })}
      </Box>
    </>
  );
}

interface RowProps {
  entry: HubEntry;
  attention: number;
}

/** One Hub entry: icon, title, hint, attention badge and a chevron, as a full-width link. */
export function HubRow({ entry, attention }: RowProps) {
  const { t } = useTranslation();
  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <ButtonBase
        component={RouterLink}
        to={entry.to}
        onClick={() => recordHubUse(entry.id)}
        data-testid={`hub-row-${entry.id}`}
        sx={(theme) => ({
          width: '100%',
          minHeight: 56,
          px: 2,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          textAlign: 'start',
          '&:focus-visible': {
            outline: `2px solid ${palette(theme).primary.main}`,
            outlineOffset: -2,
          },
        })}
      >
        <EntryStamp entry={entry} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {t(`hub.entries.${entry.id}.title`)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {t(`hub.entries.${entry.id}.hint`)}
          </Typography>
        </Box>
        <AttentionBadge count={attention} />
        <Icon name="chevron-right" size={20} />
      </ButtonBase>
    </Box>
  );
}

/** A shortcut tile: the icon above the title, the badge in the corner. */
export function ShortcutTile({ entry, attention }: RowProps) {
  const { t } = useTranslation();
  return (
    <ButtonBase
      component={RouterLink}
      to={entry.to}
      onClick={() => recordHubUse(entry.id)}
      data-testid={`hub-shortcut-${entry.id}`}
      sx={(theme) => ({
        position: 'relative',
        minHeight: 88,
        p: 1.5,
        gap: 1,
        flexDirection: 'column',
        justifyContent: 'center',
        borderRadius: `${RADIUS.card}px`,
        backgroundColor: palette(theme).background.paper,
        boxShadow: `inset 0 0 0 1px ${palette(theme).hairline}`,
        '[data-dark] &': { backgroundColor: palette(theme).surfaceRaised },
        '&:focus-visible': {
          outline: `2px solid ${palette(theme).primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      <EntryStamp entry={entry} size={44} />
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, textAlign: 'center', overflowWrap: 'anywhere' }}
      >
        {t(`hub.entries.${entry.id}.title`)}
      </Typography>
      {attention > 0 && (
        <Box sx={{ position: 'absolute', top: 8, insetInlineEnd: 8, display: 'flex' }}>
          <AttentionBadge count={attention} />
        </Box>
      )}
    </ButtonBase>
  );
}
