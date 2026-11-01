import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { formatList, formatNumber, formatUnit } from '../i18n/format';
import { palette } from '../ui/form/styles';
import { chartColor } from './charts/chartStyle';
import { DataTable } from './charts/chartKit';
import {
  FORMULA_LOOK_BACK_DAYS,
  FORMULA_METRICS,
  formulaReadiness,
  type FormulaComparison,
  type FormulaMetric,
  type FormulaPeriod,
} from './formulaComparison';
import { FORMULAS_INSIGHT } from './catalogue';
import { InsightCard } from './InsightCard';
import { shortDay } from './insightText';
import { ReadinessRows } from './ReadinessRows';

/*
 * The Formulas card (docs/design/14-formulas.md): the numbers logged on the days of each formula,
 * as small bars per measure (one row per formula) or a table, the period of each formula, and
 * "While on Nan 2: 0.6 belly pains/day, on Nan 1: 1.2" statements, always followed by the plain
 * note that this compares what was logged and shows no cause. Never a recommendation, a target or a
 * threshold.
 */

const NONE = '–';
const SEPARATOR = ' · ';
const roundOne = (value: number) => Math.round(value * 10) / 10;

function metricLabel(t: TFunction, metric: FormulaMetric): string {
  switch (metric) {
    case 'bottlesPerDay':
      return t('insights.formulas.metrics.bottlesPerDay');
    case 'mlPerDay':
      return t('insights.formulas.metrics.mlPerDay');
    case 'mlPerKgPerDay':
      return t('insights.formulas.metrics.mlPerKgPerDay');
    case 'bellyPainsPerDay':
      return t('insights.formulas.metrics.bellyPainsPerDay');
    case 'bellyPainsAfterBottlePerDay':
      return t('insights.formulas.metrics.bellyPainsAfterBottlePerDay');
    case 'fussyPerDay':
      return t('insights.formulas.metrics.fussyPerDay');
    case 'dirtyPerDay':
      return t('insights.formulas.metrics.dirtyPerDay');
  }
}

/**
 * The number of a measure as the bars, the table and the statements show it ("6.4", "720 mL"; the
 * per-kg measure reads "130 mL" under its "per kg" label).
 */
function valueText(metric: FormulaMetric, value: number | null): string {
  if (value === null) return NONE;
  if (metric === 'mlPerDay' || metric === 'mlPerKgPerDay') {
    return formatUnit(Math.round(value), 'milliliter');
  }
  return formatNumber(roundOne(value));
}

/** The first value of a statement, with its unit ("0.6 belly pains/day"). */
function statementValue(
  t: TFunction,
  metric: 'bellyPainsPerDay' | 'fussyPerDay' | 'mlPerDay',
  value: number,
) {
  switch (metric) {
    case 'bellyPainsPerDay':
      return t('insights.formulas.values.bellyPains', { count: roundOne(value) });
    case 'fussyPerDay':
      return t('insights.formulas.values.fussy', { count: roundOne(value) });
    case 'mlPerDay':
      return t('insights.formulas.values.ml', {
        value: formatUnit(Math.round(value), 'milliliter'),
      });
  }
}

const STATEMENT_METRICS = ['bellyPainsPerDay', 'fussyPerDay', 'mlPerDay'] as const;

/** "While on Nan 2: 0.6 belly pains/day, on Nan 1: 1.2." for one measure, or `null` without data. */
function statement(
  t: TFunction,
  periods: readonly FormulaPeriod[],
  metric: (typeof STATEMENT_METRICS)[number],
): string | null {
  const known = periods.filter((p) => p.metrics[metric] !== null);
  const [first, ...rest] = known;
  if (!first) return null;
  const value = statementValue(t, metric, first.metrics[metric]!);
  if (rest.length === 0) return t('insights.formulas.statementOne', { name: first.name, value });
  const others = formatList(
    rest.map((p) =>
      t('insights.formulas.onOther', { name: p.name, value: valueText(metric, p.metrics[metric]) }),
    ),
  );
  return t('insights.formulas.statementMany', { name: first.name, value, others });
}

/** A measure as one bar per formula: name, a bar scaled to the largest value, the value. */
function MetricBars({
  metric,
  periods,
}: {
  metric: FormulaMetric;
  periods: readonly FormulaPeriod[];
}) {
  const { t } = useTranslation();
  const label = metricLabel(t, metric);
  const max = Math.max(0, ...periods.map((p) => p.metrics[metric] ?? 0));
  return (
    <Box role="group" aria-label={label} sx={{ display: 'grid', gap: 0.75 }}>
      <Typography variant="caption" color="text.secondary" component="p">
        {label}
      </Typography>
      {periods.map((period) => {
        const value = period.metrics[metric];
        const share = value !== null && max > 0 ? value / max : 0;
        return (
          <Box
            key={period.formulaId}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 7.5rem) minmax(0, 1fr) auto',
              alignItems: 'center',
              gap: 1.25,
            }}
          >
            <Typography variant="body2" noWrap title={period.name}>
              {period.name}
            </Typography>
            <Box
              aria-hidden
              sx={(theme) => ({
                height: 8,
                borderRadius: 4,
                backgroundColor: palette(theme).hairline,
                overflow: 'hidden',
              })}
            >
              <Box
                sx={(theme) => ({
                  height: '100%',
                  width: `${Math.round(share * 100)}%`,
                  minWidth: value ? 4 : 0,
                  borderRadius: 4,
                  backgroundColor: chartColor(theme, 'feed'),
                  '@media (forced-colors: active)': { backgroundColor: 'CanvasText' },
                })}
              />
            </Box>
            <Typography
              variant="body2"
              sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', minWidth: '3.5rem' }}
            >
              {valueText(metric, value)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/** "Nan 2 · 9 Oct to 21 Oct · 13 days · 78 bottles", one line per formula. */
function Periods({ periods }: { periods: readonly FormulaPeriod[] }) {
  const { t } = useTranslation();
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.5 }}>
      {periods.map((p) => (
        <Typography key={p.formulaId} component="li" variant="body2">
          <Box component="span" sx={{ fontWeight: 600 }}>
            {p.name}
          </Box>
          {SEPARATOR}
          {[
            t('insights.formulas.range', { from: shortDay(p.first), to: shortDay(p.last) }),
            t('insights.formulas.days', { count: p.days.length }),
            t('insights.formulas.bottles', { count: p.bottles }),
          ].join(SEPARATOR)}
        </Typography>
      ))}
    </Box>
  );
}

const shownMetrics = (periods: readonly FormulaPeriod[]) =>
  FORMULA_METRICS.filter((metric) => periods.some((p) => p.metrics[metric] !== null));

/**
 * The Formulas card for a comparison with at least one formula shown: one formula alone (its
 * averages as headline numbers), or two and more side by side. Formulas still collecting days are
 * listed under it with their progress.
 */
export function FormulaCard({ comparison }: { comparison: FormulaComparison }) {
  const { t } = useTranslation();
  const shown = comparison.qualified;
  const waiting = comparison.periods.filter((p) => !p.qualifies);
  const metrics = shownMetrics(shown);
  const statements = STATEMENT_METRICS.map((m) => statement(t, shown, m)).filter(
    (line): line is string => line !== null,
  );
  const summary = statements.length > 0 ? statements.join(' ') : t('insights.noData');
  const single = shown.length === 1 ? shown[0] : null;
  const headline = single
    ? {
        values: [
          t('insights.formulas.headlineBottles', {
            count: roundOne(single.metrics.bottlesPerDay ?? 0),
          }),
          ...(single.metrics.mlPerDay !== null
            ? [t('insights.perDay', { value: valueText('mlPerDay', single.metrics.mlPerDay) })]
            : []),
        ],
        caption: t('insights.formulas.singleCaption', {
          count: single.averagedDays,
          name: single.name,
        }),
      }
    : null;
  return (
    <InsightCard
      insight={FORMULAS_INSIGHT}
      headline={headline}
      summary={summary}
      intro={
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          <Typography variant="body2" color="text.secondary" data-testid="formula-note">
            {t('insights.formulas.note')}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            {t('insights.formulas.caption', { count: FORMULA_LOOK_BACK_DAYS })}
          </Typography>
          <Periods periods={shown} />
        </Box>
      }
      chart={
        <Box
          role="group"
          aria-label={t('insights.formulas.chartLabel', { summary })}
          sx={{ display: 'grid', gap: 2 }}
        >
          {metrics.map((metric) => (
            <MetricBars key={metric} metric={metric} periods={shown} />
          ))}
        </Box>
      }
      table={
        <DataTable
          caption={t('insights.names.formulas')}
          head={t('insights.formulas.tableMeasure')}
          columns={shown.map((p) => ({ key: p.formulaId, label: p.name }))}
          rows={metrics.map((metric) => ({
            key: metric,
            cells: [
              metricLabel(t, metric),
              ...shown.map((p) => valueText(metric, p.metrics[metric])),
            ],
          }))}
        />
      }
      extra={
        <>
          {metrics.includes('mlPerKgPerDay') && (
            <Typography variant="caption" color="text.secondary" component="p">
              {t('insights.formulas.weightNote')}
            </Typography>
          )}
          {waiting.length > 0 && (
            <Box sx={{ display: 'grid', gap: 0.5 }}>
              <Typography variant="overline" component="h3" color="text.secondary">
                {t('insights.formulas.collecting')}
              </Typography>
              <ReadinessRows items={[]} formulas={waiting.map(formulaReadiness)} />
            </Box>
          )}
        </>
      }
    />
  );
}
