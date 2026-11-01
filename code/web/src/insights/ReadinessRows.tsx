import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, LinearProgress, Typography } from '@mui/material';
import type { CategoryName } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { palette } from '../ui/form/styles';
import type { IconName } from '../ui/icons';
import { insightById } from './catalogue';
import { FORMULA_MIN_DAYS, type FormulaReadiness } from './formulaComparison';
import { estimateLine, formulaEstimateLine, insightName, progressText } from './insightText';
import type { Readiness } from './readiness';

interface ProgressRowProps {
  /** `data-insight` of the row (tests and screenshots find rows by it). */
  dataKey: string;
  icon: IconName;
  category: CategoryName;
  name: string;
  /** 0 to 1. */
  progress: number;
  /** "Day 3 of 7", shown and read as the bar's value. */
  progressLabel: string;
  line: string;
}

/**
 * One thing on its way: category stamp, name, a thin progress bar (read out as "Day 3 of 7") and
 * the friendly estimate line.
 */
function ProgressRow({
  dataKey,
  icon,
  category,
  name,
  progress,
  progressLabel,
  line,
}: ProgressRowProps) {
  return (
    <Box
      component="li"
      data-insight={dataKey}
      sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 1.5 }}
    >
      <CategoryIcon name={icon} category={category} size={20} />
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
          <Typography variant="subtitle1" component="h3" sx={{ overflowWrap: 'anywhere' }}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary" aria-hidden>
            {progressLabel}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={Math.round(progress * 100)}
          aria-label={name}
          aria-valuetext={progressLabel}
          sx={(theme) => ({
            height: 4,
            borderRadius: 2,
            backgroundColor: palette(theme).hairline,
            '& .MuiLinearProgress-bar': {
              borderRadius: 2,
              backgroundColor: palette(theme).category[category].fg,
            },
          })}
        />
        <Typography variant="body2" color="text.secondary">
          {line}
        </Typography>
      </Box>
    </Box>
  );
}

/** The rows separated by hairlines. */
function RowList({ children }: { children: ReactNode }) {
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
      {children}
    </Box>
  );
}

/**
 * The insights that are not open yet (and the formulas not shown yet, "Formula: Nan 1, day 4 of
 * 7"), as a list of progress rows separated by hairlines.
 */
export function ReadinessRows({
  items,
  formulas = [],
}: {
  items: readonly Readiness[];
  formulas?: readonly FormulaReadiness[];
}) {
  const { t } = useTranslation();
  return (
    <RowList>
      {items.map((item) => {
        const insight = insightById(item.id);
        return (
          <ProgressRow
            key={item.id}
            dataKey={item.id}
            icon={insight.icon}
            category={insight.category}
            name={insightName(t, item.id)}
            progress={item.progress}
            progressLabel={progressText(t, item)}
            line={estimateLine(t, item)}
          />
        );
      })}
      {formulas.map((item) => (
        <ProgressRow
          key={item.formulaId}
          dataKey="formula"
          icon="bottle"
          category="feeding"
          name={t('insights.formulas.rowTitle', { name: item.name })}
          progress={item.progress}
          progressLabel={t('insights.progress', {
            done: Math.min(item.days, FORMULA_MIN_DAYS),
            total: FORMULA_MIN_DAYS,
          })}
          line={formulaEstimateLine(t, item)}
        />
      ))}
    </RowList>
  );
}
