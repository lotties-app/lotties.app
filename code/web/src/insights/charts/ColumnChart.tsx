import { useTranslation } from 'react-i18next';
import { Box, useTheme } from '@mui/material';
import { formatDate, formatList } from '../../i18n/format';
import { CHART_WIDTH, labelSize } from '../../measurements/chartScale';
import { palette } from '../../ui/form/styles';
import {
  bands,
  clampLabel,
  columnPath,
  estimateTextWidth,
  labelledColumns,
  nonOverlapping,
  stackSegments,
  type ValueAxis,
} from '../chartGeometry';
import { chartColor, fadeIn, useRenderedWidth, type SeriesColor } from './chartStyle';

const FALLBACK_COLOR: SeriesColor = 'neutral';

export interface ColumnSeries {
  key: string;
  label: string;
  color: SeriesColor;
}

export interface ColumnDay {
  key: string;
  start: Date;
  /** One value per series, stacked bottom to top in series order. */
  values: number[];
}

export interface ColumnChartProps {
  days: readonly ColumnDay[];
  series: readonly ColumnSeries[];
  axis: ValueAxis;
  formatTick: (value: number) => string;
  formatValue: (value: number) => string;
  /** The chart's text summary (the image's accessible name). */
  label: string;
  todayKey: string;
  height?: number;
  /** The average, drawn as a solid reference line across the columns. */
  reference?: number | null;
  /** Tooltip values of a column, when they are more than the plotted series (wet and dirty). */
  describe?: (index: number) => string;
}

/**
 * Columns per day (stacked when there are several series), hand-built SVG: hairline grid with
 * round ticks, columns at most 24 units wide with a 4-unit rounded data end and a 2-unit surface
 * gap between stacked segments, a date under every column for a week and every 7th otherwise.
 * Each column carries a native tooltip; the numbers are also in the card's table view.
 */
export function ColumnChart({
  days,
  series,
  axis,
  formatTick,
  formatValue,
  label,
  todayKey,
  height = 188,
  reference = null,
  describe,
}: ColumnChartProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const colors = palette(theme);
  const { ref, width } = useRenderedWidth<SVGSVGElement>();
  const font = labelSize(width);
  const W = CHART_WIDTH;
  const H = height;
  const tickWidth = Math.max(
    ...axis.ticks.map((tick) => estimateTextWidth(formatTick(tick), font)),
  );
  const pad = {
    top: 8,
    right: 4,
    bottom: Math.round(font * 1.5 + 6),
    left: Math.ceil(tickWidth + 8),
  };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const baseY = pad.top + innerH;
  const y = (value: number) => baseY - (value / axis.max) * innerH;
  const scale = (value: number) => (value / axis.max) * innerH;
  const layout = bands(days.length, pad.left, innerW);
  const dayLabel = (day: ColumnDay) =>
    days.length <= 7 ? formatDate(day.start, 'dayNumber') : formatDate(day.start, 'dayMonth');
  // Newest first: today keeps its label when two would touch.
  const labels = new Map(
    nonOverlapping(
      labelledColumns(days.length)
        .reverse()
        .map((index) => {
          const width = estimateTextWidth(dayLabel(days[index]), font);
          return { index, width, x: clampLabel(layout[index].center, width, pad.left - 4, W) };
        }),
    ).map((label) => [label.index, label.x]),
  );

  return (
    <Box sx={fadeIn}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
      >
        {axis.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              style={{ stroke: colors.hairline }}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={pad.left - 8}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={font}
              style={{ fill: colors.text.secondary }}
            >
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {days.map((day, index) => {
          const band = layout[index];
          const segments = stackSegments(day.values, scale, baseY);
          const values =
            describe?.(index) ??
            formatList(
              series.map((s, i) =>
                t('insights.seriesValue', {
                  label: s.label,
                  value: formatValue(day.values[i] ?? 0),
                }),
              ),
            );
          return (
            <g key={day.key} data-testid="insights-column">
              <title>
                {t('insights.columnTitle', {
                  day: formatDate(day.start, 'weekdayDayMonth'),
                  values,
                })}
              </title>
              {/* A hit area taller than the marks, so the tooltip is easy to reach. */}
              <rect
                x={band.center - Math.max(band.bar, 12) / 2}
                y={pad.top}
                width={Math.max(band.bar, 12)}
                height={innerH}
                fill="transparent"
              />
              {segments.map((segment) => {
                const color = series[segment.index]?.color ?? FALLBACK_COLOR;
                const fill = { fill: chartColor(theme, color) };
                return segment.isTop ? (
                  <path
                    key={segment.index}
                    d={columnPath(band.x, band.bar, segment.top, segment.bottom)}
                    style={fill}
                  />
                ) : (
                  <rect
                    key={segment.index}
                    x={band.x}
                    y={segment.top}
                    width={band.bar}
                    height={segment.bottom - segment.top}
                    style={fill}
                  />
                );
              })}
              {labels.has(index) && (
                <text
                  x={labels.get(index)}
                  y={H - 4}
                  textAnchor="middle"
                  fontSize={font}
                  fontWeight={day.key === todayKey ? 600 : 400}
                  style={{
                    fill: day.key === todayKey ? colors.text.primary : colors.text.secondary,
                  }}
                >
                  {dayLabel(day)}
                </text>
              )}
            </g>
          );
        })}
        {reference !== null && reference > 0 && (
          <line
            data-testid="insights-reference"
            x1={pad.left}
            x2={W - pad.right}
            y1={y(Math.min(reference, axis.max))}
            y2={y(Math.min(reference, axis.max))}
            style={{ stroke: colors.text.secondary }}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        )}
      </svg>
    </Box>
  );
}
