import { Box, Paper, Typography, useTheme } from '@mui/material';
import type { MeasurementDto } from '../sync/contract';
import { seriesFor, valueAxis, type MetricInfo, type SeriesPoint } from './measurementModel';

const W = 480;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };

const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const shortDate = (date: string) =>
  new Date(dayMs(date)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

function Plot({ metric, points }: { metric: MetricInfo; points: SeriesPoint[] }) {
  const theme = useTheme();
  const axis = valueAxis(points);
  const first = points[0];
  const last = points[points.length - 1];
  const t0 = dayMs(first.date);
  const t1 = dayMs(last.date);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (date: string) =>
    PAD.left + (t1 === t0 ? innerW / 2 : ((dayMs(date) - t0) / (t1 - t0)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - axis.min) / (axis.max - axis.min)) * innerH;
  const label = `${metric.label} from ${shortDate(first.date)} to ${shortDate(last.date)}: ${points
    .map((p) => `${p.value} ${metric.unit} on ${shortDate(p.date)}`)
    .join(', ')}.`;
  const muted = theme.palette.text.secondary;
  const color = theme.palette.primary.main;

  return (
    <svg
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
            y1={y(tick)}
            y2={y(tick)}
            stroke={theme.palette.divider}
          />
          <text
            x={PAD.left - 6}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize="11"
            fill={muted}
          >
            {Math.round(tick * 10) / 10}
          </text>
        </g>
      ))}
      <text x={PAD.left} y={H - 8} fontSize="11" fill={muted} textAnchor="start">
        {shortDate(first.date)}
      </text>
      {points.length > 1 && (
        <>
          <text x={W - PAD.right} y={H - 8} fontSize="11" fill={muted} textAnchor="end">
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
          <title>{`${shortDate(p.date)}: ${p.value} ${metric.unit}`}</title>
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
  const points = seriesFor(measurements, metric.key);
  const latest = points[points.length - 1];
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2 }}
      component="section"
      aria-label={`${metric.label} chart`}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography variant="subtitle1" component="h3">
          {metric.label} ({metric.unit})
        </Typography>
        {latest && (
          <Typography variant="body2" color="text.secondary">
            Latest {latest.value} {metric.unit}
          </Typography>
        )}
      </Box>
      {points.length === 0 ? (
        <Typography color="text.secondary">
          No {metric.label.toLowerCase()} measurements yet.
        </Typography>
      ) : (
        <Plot metric={metric} points={points} />
      )}
    </Paper>
  );
}
