import { useTranslation } from 'react-i18next';
import { Box, LinearProgress, Typography } from '@mui/material';
import { CategoryIcon } from '../ui/CategoryIcon';
import { palette } from '../ui/form/styles';
import { insightById } from './catalogue';
import { estimateLine, insightName, progressText } from './insightText';
import type { Readiness } from './readiness';

/**
 * One insight on its way: category stamp, name, a thin progress bar (days with data of the days
 * needed, read out as "Day 3 of 7") and the friendly estimate line.
 */
function ReadinessRow({ readiness }: { readiness: Readiness }) {
  const { t } = useTranslation();
  const insight = insightById(readiness.id);
  const name = insightName(t, readiness.id);
  const progress = progressText(t, readiness);
  return (
    <Box
      component="li"
      data-insight={readiness.id}
      sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 1.5 }}
    >
      <CategoryIcon name={insight.icon} category={insight.category} size={20} />
      <Box sx={{ flex: 1, minWidth: 0, display: 'grid', gap: 0.75 }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="subtitle1" component="h3">
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary" aria-hidden>
            {progress}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={Math.round(readiness.progress * 100)}
          aria-label={name}
          aria-valuetext={progress}
          sx={(theme) => ({
            height: 4,
            borderRadius: 2,
            backgroundColor: palette(theme).hairline,
            '& .MuiLinearProgress-bar': {
              borderRadius: 2,
              backgroundColor: palette(theme).category[insight.category].fg,
            },
          })}
        />
        <Typography variant="body2" color="text.secondary">
          {estimateLine(t, readiness)}
        </Typography>
      </Box>
    </Box>
  );
}

/** The insights that are not open yet, as a list of progress rows separated by hairlines. */
export function ReadinessRows({ items }: { items: readonly Readiness[] }) {
  return (
    <Box
      component="ul"
      sx={(theme) => ({
        m: 0,
        p: 0,
        listStyle: 'none',
        '& > li + li': { borderTop: `1px solid ${palette(theme).hairline}` },
      })}
    >
      {items.map((item) => (
        <ReadinessRow key={item.id} readiness={item} />
      ))}
    </Box>
  );
}
