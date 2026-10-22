import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Chip, Paper, Typography } from '@mui/material';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';

interface Props {
  to: string;
  title: string;
  /** A count of things waiting (shown as a chip, read out as "N new from your doctor"). */
  badge?: number;
}

/**
 * A settings entry that opens a page of its own (instead of expanding in place): the same surface
 * and title size as the collapsible groups, with a chevron pointing away. An optional badge counts
 * what is new (the doctor's suggestions).
 */
export function SettingsLinkRow({ to, title, badge = 0 }: Props) {
  const { t } = useTranslation();
  return (
    <Paper sx={{ borderRadius: `${RADIUS.card}px`, overflow: 'hidden' }}>
      <ButtonBase
        component={RouterLink}
        to={to}
        sx={{
          width: '100%',
          minHeight: 56,
          px: 2,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 1,
          textAlign: 'start',
        }}
      >
        <Typography variant="h6" component="span">
          {title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {badge > 0 && (
            <>
              <Chip aria-hidden size="small" color="primary" label={badge} />
              <Box component="span" sx={visuallyHidden}>
                {t('proposals.badgeLabel', { count: badge })}
              </Box>
            </>
          )}
          <Icon name="chevron-right" />
        </Box>
      </ButtonBase>
    </Paper>
  );
}
