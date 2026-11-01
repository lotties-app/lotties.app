import { Box, useTheme } from '@mui/material';
import { formatDate, formatTime } from '../../i18n/format';
import { CHART_WIDTH, labelSize } from '../../measurements/chartScale';
import { palette } from '../../ui/form/styles';
import { estimateTextWidth, rhythmRowHeight, spanRect } from '../chartGeometry';
import { RHYTHM_START_HOUR, type RhythmKind, type RhythmRow } from '../sleepModel';
import { chartColor, fadeIn, useRenderedWidth, type SeriesColor } from './chartStyle';

const KIND_COLOR: Record<Exclude<RhythmKind, 'waking'>, SeriesColor> = {
  night: 'night',
  nap: 'nap',
};

/** Hour marks along the row: 06, 12, 18, 00, 06. */
const HOUR_MARKS = [0, 0.25, 0.5, 0.75, 1];

/**
 * The sleep rhythm (an actogram): one row per day, newest on top, from 06:00 to 06:00 the next
 * morning so a night is never split. Night in the strong sleep tone, naps in the light one, night
 * wakings as gaps in the surface colour. Rows are labelled every day for a week, every 7th day
 * otherwise; the numbers are in the card's table view.
 */
export function RhythmChart({
  rows,
  label,
  todayKey,
}: {
  rows: readonly RhythmRow[];
  label: string;
  todayKey: string;
}) {
  const theme = useTheme();
  const colors = palette(theme);
  const { ref, width } = useRenderedWidth<SVGSVGElement>();
  const font = labelSize(width);
  const rowHeight = rhythmRowHeight(rows.length);
  const everyRow = rowHeight >= font + 2;
  const dayLabel = (row: RhythmRow) => formatDate(row.start, 'dayMonth');
  const labelWidth = Math.max(...rows.map((row) => estimateTextWidth(dayLabel(row), font)), 0);
  const W = CHART_WIDTH;
  const pad = {
    top: 4,
    right: Math.ceil(estimateTextWidth('00:00', font) / 2),
    left: Math.ceil(labelWidth + 10),
  };
  const axisBand = Math.round(font * 1.5 + 6);
  const H = pad.top + rows.length * rowHeight + axisBand;
  const innerW = W - pad.left - pad.right;
  const bar = Math.max(4, Math.round(rowHeight * 0.62));
  const markTime = (fraction: number) =>
    formatTime(new Date(2000, 0, 1, (RHYTHM_START_HOUR + fraction * 24) % 24));

  return (
    <Box sx={fadeIn}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
      >
        {HOUR_MARKS.map((fraction) => {
          const x = pad.left + fraction * innerW;
          return (
            <g key={fraction}>
              <line
                x1={x}
                x2={x}
                y1={pad.top}
                y2={pad.top + rows.length * rowHeight}
                style={{ stroke: colors.hairline }}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={x}
                y={H - 4}
                textAnchor="middle"
                fontSize={font}
                style={{ fill: colors.text.secondary }}
              >
                {markTime(fraction)}
              </text>
            </g>
          );
        })}
        {rows.map((row, index) => {
          const top = pad.top + index * rowHeight;
          const barY = top + (rowHeight - bar) / 2;
          const today = row.key === todayKey;
          return (
            <g key={row.key} data-testid="insights-rhythm-row">
              {(everyRow || index % 7 === 0) && (
                <text
                  x={pad.left - 10}
                  y={top + rowHeight / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={font}
                  fontWeight={today ? 600 : 400}
                  style={{ fill: today ? colors.text.primary : colors.text.secondary }}
                >
                  {dayLabel(row)}
                </text>
              )}
              {row.spans.map((span) => {
                const rect = spanRect(span.from, span.to, pad.left, innerW);
                const waking = span.kind === 'waking';
                return (
                  <rect
                    key={`${span.id}-${span.kind}`}
                    x={rect.x}
                    y={waking ? barY - 1 : barY}
                    width={rect.width}
                    height={waking ? bar + 2 : bar}
                    rx={waking ? 0 : Math.min(3, bar / 2)}
                    style={{
                      fill:
                        span.kind === 'waking'
                          ? colors.background.paper
                          : chartColor(theme, KIND_COLOR[span.kind]),
                    }}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </Box>
  );
}
