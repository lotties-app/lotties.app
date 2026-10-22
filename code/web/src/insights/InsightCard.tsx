import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Typography } from '@mui/material';
import { RADIUS } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import type { InsightDefinition } from './catalogue';
import { insightName } from './insightText';

export interface Stat {
  key: string;
  label: string;
  value: string;
}

/** Small serif numbers on raised tiles, like the Now "Today" strip. */
export function StatTiles({ stats }: { stats: readonly Stat[] }) {
  if (stats.length === 0) return null;
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))',
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
          <Typography component="dt" variant="caption" color="text.secondary">
            {stat.label}
          </Typography>
          <Typography component="dd" variant="h5" sx={{ m: 0, fontWeight: 400 }}>
            {stat.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * An unlocked insight: header (category stamp, serif title), the range averages as serif headline
 * numbers ("6.4 diapers / day") under a caption that says what they average, the text summary,
 * optional stat tiles and legend, then the chart, or the same numbers as a table ("View as
 * table"). The summary is the chart's accessible description too.
 */
export function InsightCard({
  insight,
  headline,
  summary,
  stats,
  legend,
  chart,
  table,
  note,
}: {
  insight: InsightDefinition;
  /** Averages of the range as headline numbers, with a caption saying what they average. */
  headline?: { values: readonly string[]; caption: string } | null;
  summary: string;
  stats?: readonly Stat[];
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  note?: string;
}) {
  const { t } = useTranslation();
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  return (
    <Card
      component="section"
      aria-labelledby={titleId}
      data-insight={insight.id}
      sx={{ p: 2.5, display: 'grid', gap: 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CategoryIcon name={insight.icon} category={insight.category} size={20} />
        <Typography id={titleId} variant="h5" component="h2">
          {insightName(t, insight.id)}
        </Typography>
      </Box>
      {headline && headline.values.length > 0 && (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary" component="p">
            {headline.caption}
          </Typography>
          <Box
            sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 3, rowGap: 0.5 }}
            data-testid="insights-headline"
          >
            {headline.values.map((value) => (
              <Typography
                key={value}
                variant={headline.values.length > 1 ? 'h5' : 'h4'}
                component="p"
                sx={{ lineHeight: 1.15, fontWeight: 400 }}
              >
                {value}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
      <Typography variant="body2" color="text.secondary">
        {summary}
      </Typography>
      {stats && <StatTiles stats={stats} />}
      {!asTable && legend}
      <Box id={bodyId}>{asTable ? table : chart}</Box>
      {note && (
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      )}
      <Box>
        <Button
          size="small"
          onClick={() => setAsTable((value) => !value)}
          aria-controls={bodyId}
          startIcon={<Icon name={asTable ? 'chart' : 'note'} size={20} />}
          sx={{ minHeight: 44, px: 1.5, ml: -1.5 }}
        >
          {asTable ? t('insights.showChart') : t('insights.showTable')}
        </Button>
      </Box>
    </Card>
  );
}
