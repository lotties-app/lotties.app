import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Paper, Typography, useTheme } from '@mui/material';
import { formatDate, formatNumber } from '../i18n/format';
import { CHART_WIDTH, labelSize } from './chartScale';
import type { MeasurementDto } from '../sync/contract';
import { useUnits } from '../units/useUnits';
import {
  axisValue,
  metricLabel,
  metricText,
  metricUnitLabel,
  seriesFor,
  valueAxis,
  type MetricInfo,
  type SeriesPoint,
} from './measurementModel';

const W = CHART_WIDTH;
const H = 220;

/**
 * Width the chart is drawn at, in CSS pixels (`null` until measured). The SVG scales with its
 * container, so label sizes are set in viewBox units from it.
 */
function useRenderedWidth() {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width;
      if (next) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function padding(font: number) {
  return { top: 16, right: 16, bottom: Math.round(font * 1.4 + 12), left: Math.round(font * 4) };
}

const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const shortDate = (date: string) => formatDate(date, 'dayMonth');
const valueText = (value: number) => formatNumber(value);

function Plot({ metric, points }: { metric: MetricInfo; points: SeriesPoint[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { ref, width } = useRenderedWidth();
  const font = labelSize(width);
  const PAD = padding(font);
  // The axis runs in the person's units (decimal pounds, inches); the points keep their stored value.
  const axis = valueAxis(points.map((p) => ({ ...p, value: axisValue(metric, p.value) })));
  const first = points[0];
  const last = points[points.length - 1];
  const t0 = dayMs(first.date);
  const t1 = dayMs(last.date);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (date: string) =>
    PAD.left + (t1 === t0 ? innerW / 2 : ((dayMs(date) - t0) / (t1 - t0)) * innerW);
  const y = (stored: number) => yAxis(axisValue(metric, stored));
  const yAxis = (v: number) => PAD.top + innerH - ((v - axis.min) / (axis.max - axis.min)) * innerH;
  const label = t('growth.chartDescription', {
    label: metricLabel(metric),
    from: shortDate(first.date),
    to: shortDate(last.date),
    points: points
      .map((p) =>
        t('growth.chartPoint', {
          value: metricText(metric, p.value),
          date: shortDate(p.date),
        }),
      )
      .join(', '),
  });
  const muted = theme.palette.text.secondary;
  const color = theme.palette.primary.main;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {axis.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yAxis(tick)}
            y2={yAxis(tick)}
            stroke={theme.palette.divider}
          />
          <text
            x={PAD.left - 6}
            y={yAxis(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={font}
            fill={muted}
          >
            {valueText(Math.round(tick * 10) / 10)}
          </text>
        </g>
      ))}
      <text x={PAD.left} y={H - 8} fontSize={font} fill={muted} textAnchor="start">
        {shortDate(first.date)}
      </text>
      {points.length > 1 && (
        <>
          <text x={W - PAD.right} y={H - 8} fontSize={font} fill={muted} textAnchor="end">
            {shortDate(last.date)}
          </text>
          <polyline
            points={points.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
      {points.map((p, i) => (
        <circle
          key={`${p.date}-${i}`}
          cx={x(p.date)}
          cy={y(p.value)}
          r="4.5"
          fill={color}
          stroke={theme.palette.background.paper}
          strokeWidth="2"
          data-testid="chart-point"
        >
          <title>
            {t('growth.pointTitle', {
              date: shortDate(p.date),
              value: metricText(metric, p.value),
            })}
          </title>
        </circle>
      ))}
    </svg>
  );
}

/** One dependency-free line chart for a single metric (the title names the series). */
export function GrowthChart({
  metric,
  measurements,
}: {
  metric: MetricInfo;
  measurements: MeasurementDto[];
}) {
  const { t } = useTranslation();
  const units = useUnits();
  const unit = metricUnitLabel(metric, units.labels.length);
  const points = seriesFor(measurements, metric.key);
  const label = metricLabel(metric);
  const latest = points[points.length - 1];
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2 }}
      component="section"
      aria-label={t('growth.chart', { label })}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography variant="subtitle1" component="h3">
          {t('growth.metricLabel', { label, unit })}
        </Typography>
        {latest && (
          <Typography variant="body2" color="text.secondary">
            {t('growth.latest', { value: metricText(metric, latest.value) })}
          </Typography>
        )}
      </Box>
      {points.length === 0 ? (
        <Typography color="text.secondary">
          {t('growth.noneForMetric', { label: label.toLocaleLowerCase() })}
        </Typography>
      ) : (
        <Plot metric={metric} points={points} />
      )}
    </Paper>
  );
}
