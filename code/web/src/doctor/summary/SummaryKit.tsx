import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import type { CategoryName } from '../../theme/tokens';
import { RADIUS } from '../../theme/tokens';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { palette } from '../../ui/form/styles';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';

/*
 * Building blocks of the patient summary (docs/design/19-doctor-dashboard.md section 5.2): a card
 * per section, number tiles with a plain "how it is computed" note, and the empty states. Wording is
 * descriptive only: no colours or words that interpret a value.
 */

export function SummarySection({
  id,
  title,
  icon,
  category,
  children,
}: {
  id: string;
  title: string;
  icon: IconName;
  category: CategoryName;
  children: ReactNode;
}) {
  const headingId = `summary-${id}`;
  return (
    <Paper
      component="section"
      aria-labelledby={headingId}
      sx={{
        borderRadius: `${RADIUS.card}px`,
        p: 2,
        display: 'grid',
        // A column of the card's width, never its widest content's (no sideways push).
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: 1.5,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <CategoryIcon name={icon} category={category} size={20} />
        <Typography id={headingId} variant="h6" component="h2">
          {title}
        </Typography>
      </Box>
      {children}
    </Paper>
  );
}

export interface SummaryStat {
  key: string;
  label: string;
  value: string;
  /** How the number is computed, in plain words. */
  help?: string;
}

/** The "how it is computed" note of a number: a tap or focus shows it. */
function HelpButton({ label, help }: { label: string; help: string }) {
  const { t } = useTranslation();
  return (
    <Tooltip title={help} enterTouchDelay={0} leaveTouchDelay={8000} describeChild>
      <IconButton
        size="small"
        aria-label={t('doctorDashboard.summary.howComputed', { label })}
        sx={{ p: 0.5, ml: -0.25 }}
      >
        <Icon name="info" size={16} />
      </IconButton>
    </Tooltip>
  );
}

/** Number tiles: the label (with its note) above the value. */
export function StatGrid({ stats }: { stats: readonly SummaryStat[] }) {
  if (stats.length === 0) return null;
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 1,
      }}
    >
      {stats.map((stat) => (
        <Box
          key={stat.key}
          sx={(theme) => ({
            px: 1.5,
            py: 1,
            borderRadius: `${RADIUS.tile}px`,
            backgroundColor: palette(theme).surfaceRaised,
            minWidth: 0,
          })}
        >
          <Box
            component="dt"
            // Tiles with and without a note line up (the note button is 26px high).
            sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minHeight: 26 }}
          >
            <Typography variant="caption" color="text.secondary" component="span">
              {stat.label}
            </Typography>
            {stat.help && <HelpButton label={stat.label} help={stat.help} />}
          </Box>
          <Typography
            component="dd"
            variant="h6"
            sx={{ m: 0, fontWeight: 500, fontVariantNumeric: 'lining-nums tabular-nums' }}
          >
            {stat.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function NoData() {
  const { t } = useTranslation();
  return <Typography color="text.secondary">{t('doctorDashboard.summary.noData')}</Typography>;
}

/** A small caption line (what an average is taken over). */
export function Caption({ children }: { children: ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" component="p">
      {children}
    </Typography>
  );
}

/** A plain list of rows (title, detail, trailing value). */
export function RowList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack component="ul" aria-label={label} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {children}
    </Stack>
  );
}

export function Row({
  title,
  detail,
  trailing,
}: {
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Box
      component="li"
      sx={(theme) => ({
        display: 'flex',
        // A trailing value too long for the row (large text) goes under the title.
        flexWrap: 'wrap',
        columnGap: 1.5,
        alignItems: 'baseline',
        py: 1,
        borderBottom: `1px solid ${palette(theme).hairline}`,
        '&:last-of-type': { borderBottom: 'none' },
      })}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</Typography>
        {detail && (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {detail}
          </Typography>
        )}
      </Box>
      {trailing && (
        <Typography
          variant="body2"
          sx={{ flexShrink: 0, maxWidth: '100%', fontVariantNumeric: 'lining-nums tabular-nums' }}
        >
          {trailing}
        </Typography>
      )}
    </Box>
  );
}
