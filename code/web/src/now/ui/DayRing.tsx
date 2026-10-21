import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, useTheme } from '@mui/material';
import type { BabyEvent, EventType } from '../../db/models';
import { formatTime } from '../../i18n/format';
import { palette } from '../../ui/form/styles';
import { ringDescription } from '../ringText';
import { arcPath, buildRing, polar, type RingSpanKind, type RingWindow } from '../ringGeometry';

const SIZE = 280;
const C = SIZE / 2;
const R = 88;
const STROKE = 16;
const LABEL_R = R + 20;
const HOURS = [0, 6, 12, 18] as const;
/** Two labels closer than this (degrees) share one text. */
const MERGE_DEGREES = 26;

export interface DayRingProps {
  events: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  /** Predicted nap window (ISO), when there is one. */
  window?: { earliest: string; latest: string };
  /** "Awake" / "Asleep · Nap" and the live duration, shown in the middle. */
  stateLabel: string;
  duration: string;
}

/** Which side of its point a label grows to, so labels stay clear of the ring. */
function textAnchor(x: number): 'start' | 'middle' | 'end' {
  if (x < C - 6) return 'end';
  return x > C + 6 ? 'start' : 'middle';
}

interface Label {
  key: string;
  angle: number;
  text: string;
  strong?: boolean;
}

/** Labels around the arc: the predicted windows, merged when their ends are too close. */
function windowLabels(windows: readonly RingWindow[]): Label[] {
  const labels: Label[] = [];
  for (const window of windows) {
    const ends = [
      { angle: window.from, text: formatTime(window.earliest) },
      { angle: window.to, text: formatTime(window.latest) },
    ];
    if (window.to - window.from < MERGE_DEGREES) {
      labels.push({
        key: window.id,
        angle: (window.from + window.to) / 2,
        text: `${formatTime(window.earliest)}–${formatTime(window.latest)}`,
        strong: true,
      });
    } else {
      ends.forEach((end, index) =>
        labels.push({
          key: `${window.id}-${index}`,
          angle: end.angle,
          text: end.text,
          strong: true,
        }),
      );
    }
  }
  return labels;
}

/**
 * The day rhythm ring: a 24 hour clock face (midnight at the top) with today's sleep so far as
 * coloured arcs, the wake-up and bedtime marks, the predicted nap window as a dotted arc with its
 * times around the ring, a "now" hand and the live duration in the middle. Static: nothing
 * animates, so reduced motion needs no special case; the night scheme draws it flat (one warm
 * tone, the meaning also carried by the dotted pattern and the labels). The picture is an image
 * for assistive technology, described by `ringDescription`.
 */
export function DayRing({ events, types, now, window, stateLabel, duration }: DayRingProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const colors = palette(theme);
  const ring = useMemo(
    () => buildRing({ events, types, now, ...(window ? { windows: [window] } : {}) }),
    [events, types, now, window],
  );
  const label = ringDescription(ring, t, now, stateLabel, duration);
  const spanColor: Record<RingSpanKind, string> = {
    night: colors.category.sleep.fg,
    nap: colors.category.sleep.fg,
    waking: colors.category.nightWaking.fg,
  };
  const labels: Label[] = [
    ...HOURS.map((hour) => ({
      key: `hour-${hour}`,
      angle: hour * 15,
      text: formatTime(new Date(2000, 0, 1, hour)),
    })),
    ...ring.markers.map((marker) => ({
      key: marker.id,
      angle: marker.angle,
      text: formatTime(marker.at),
      strong: true,
    })),
    ...windowLabels(ring.windows),
  ];
  const nowTip = polar(C, C, R + STROKE / 2 + 4, ring.nowAngle);
  const nowBase = polar(C, C, R - STROKE / 2 - 10, ring.nowAngle);

  return (
    <Box
      data-testid="day-ring"
      sx={{ position: 'relative', width: '100%', maxWidth: SIZE, mx: 'auto', aspectRatio: '1' }}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        height="100%"
        role="img"
        aria-label={label}
        focusable="false"
        style={{ overflow: 'visible' }}
      >
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke={colors.hairline}
          strokeWidth={STROKE}
          data-testid="ring-track"
        />
        {HOURS.map((hour) => {
          const from = polar(C, C, R - STROKE / 2 - 3, hour * 15);
          const to = polar(C, C, R - STROKE / 2 - 8, hour * 15);
          return (
            <line
              key={hour}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={colors.text.secondary}
              strokeWidth={1.5}
            />
          );
        })}
        {ring.spans.map((span) => (
          <path
            key={`${span.id}-${span.from}`}
            data-testid={`ring-span-${span.kind}`}
            d={arcPath(C, C, R, span.from, span.to)}
            fill="none"
            stroke={spanColor[span.kind]}
            strokeWidth={STROKE}
            strokeLinecap="butt"
            opacity={span.kind === 'nap' ? 0.75 : 1}
          />
        ))}
        {ring.windows.map((window) => (
          <path
            key={window.id}
            data-testid="ring-window"
            d={arcPath(C, C, R, window.from, window.to)}
            fill="none"
            stroke={colors.primary.main}
            strokeWidth={STROKE - 6}
            strokeLinecap="round"
            strokeDasharray="0.1 7"
          />
        ))}
        {ring.markers.map((marker) => {
          const point = polar(C, C, R, marker.angle);
          return (
            <circle
              key={marker.id}
              data-testid={`ring-marker-${marker.kind}`}
              cx={point.x}
              cy={point.y}
              r={7}
              fill={marker.kind === 'wake' ? colors.category.care.fg : colors.background.paper}
              stroke={marker.kind === 'wake' ? colors.background.paper : colors.category.sleep.fg}
              strokeWidth={2.5}
            />
          );
        })}
        <line
          data-testid="ring-now"
          x1={nowBase.x}
          y1={nowBase.y}
          x2={nowTip.x}
          y2={nowTip.y}
          stroke={colors.primary.main}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
        {labels.map((item) => {
          const point = polar(C, C, LABEL_R, item.angle);
          const anchor = textAnchor(point.x);
          return (
            <text
              key={item.key}
              x={point.x}
              y={point.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={item.strong ? 650 : 400}
              fill={item.strong ? colors.text.primary : colors.text.secondary}
              style={{ fontVariantNumeric: 'tabular-nums' }}
              aria-hidden
            >
              {item.text}
            </text>
          );
        })}
      </svg>
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: '27%',
          display: 'grid',
          alignContent: 'center',
          justifyItems: 'center',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {stateLabel}
        </Typography>
        <Typography
          variant="h4"
          component="p"
          sx={{ fontSize: 'clamp(1.25rem, 6vw, 1.75rem)', overflowWrap: 'anywhere' }}
        >
          {duration}
        </Typography>
      </Box>
    </Box>
  );
}
