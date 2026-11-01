import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, useTheme } from '@mui/material';
import type { BabyEvent, EventType } from '../../db/models';
import { currentLocale } from '../../i18n/i18n';
import { palette } from '../../ui/form/styles';
import { ringDescription, ringWindowLine } from '../ringText';
import {
  buildRing,
  polar,
  RING_HOURS,
  ringHourLabels,
  ringLegendKeys,
  sectorPath,
  type RingSpanKind,
} from '../ringGeometry';
import { RingLegend } from './RingLegend';
import { ringSwatchColors } from './ringSwatch';

/*
 * Sizes in viewBox units. The face is 280 wide and everything, the hour labels included, stays
 * inside it: nothing is drawn outside the viewBox, so the ring never needs more room than its box.
 */
const SIZE = 280;
const C = SIZE / 2;
const R = 92;
const STROKE = 18;
const TRACK_IN = R - STROKE / 2;
const TRACK_OUT = R + STROKE / 2;
/** The nap window band is a little thicker than the track, so it reads as sitting on it. */
const BAND_IN = TRACK_IN - 3;
const BAND_OUT = TRACK_OUT + 3;
const NOW_IN = TRACK_IN - 5;
const NOW_OUT = TRACK_OUT + 5;
const LABEL_R = TRACK_OUT + 15;
const TICK_IN = TRACK_IN - 13;
const TICK_OUT = TRACK_IN - 8;

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

/** Two-digit hour of the clock ("06", "18"), like the axis of the Day ribbon. */
function hourText(hour: number): string {
  const format = new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', hourCycle: 'h23' });
  return format.format(new Date(2000, 0, 1, hour));
}

/** Which side of its point an hour label grows to, so it stays clear of the ring. */
function textAnchor(angle: number): 'start' | 'middle' | 'end' {
  if (angle === 90) return 'start';
  return angle === 270 ? 'end' : 'middle';
}

/** Radial extent of each kind of sleep: a night waking stands out of the night it interrupts. */
const SPAN_RADII: Record<RingSpanKind, [number, number]> = {
  night: [TRACK_IN, TRACK_OUT],
  nap: [TRACK_IN, TRACK_OUT],
  waking: [TRACK_IN - 3, TRACK_OUT + 3],
};

/**
 * The day rhythm ring: one question, where the baby is in today's sleep rhythm and when the next
 * nap window is. A 24 hour face (midnight at the top, clockwise) with today's sleep as blocks in
 * the Day ribbon's style (a night solid, a nap tinted with a rim, a night waking as a notch), the
 * predicted nap window as an outlined band on the ring, and "now" as the ribbon's accent line and
 * dot. Only four hour labels, outside the ring, and one dropped when "now" sits on it; the window
 * times go in the line under the ring, and a legend names every mark. Static (nothing animates,
 * so reduced motion needs no special case). The picture is an image for assistive technology,
 * described by `ringDescription`; the legend is a list.
 */
export function DayRing({ events, types, now, window, stateLabel, duration }: DayRingProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const colors = palette(theme);
  const swatch = ringSwatchColors(theme);
  const ring = useMemo(
    () => buildRing({ events, types, now, ...(window ? { windows: [window] } : {}) }),
    [events, types, now, window],
  );
  const label = ringDescription(ring, t, now, stateLabel, duration);
  const windowLine = ringWindowLine(ring, t, now);
  const hours = ringHourLabels(ring.nowAngle);
  const nowIn = polar(C, C, NOW_IN, ring.nowAngle);
  const nowOut = polar(C, C, NOW_OUT, ring.nowAngle);

  return (
    <Box data-testid="day-ring" sx={{ display: 'grid', justifyItems: 'center', gap: 1 }}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: SIZE,
          aspectRatio: '1',
          // The middle text is sized against the ring's own width, so it fits at any text size.
          containerType: 'inline-size',
        }}
      >
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width="100%"
          height="100%"
          role="img"
          aria-label={label}
          focusable="false"
          style={{ display: 'block' }}
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
          {RING_HOURS.map((hour) => {
            const from = polar(C, C, TICK_OUT, hour * 15);
            const to = polar(C, C, TICK_IN, hour * 15);
            return (
              <line
                key={hour}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={colors.text.secondary}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            );
          })}
          {ring.spans.map((span) => {
            const [inner, outer] = SPAN_RADII[span.kind];
            const look = swatch[span.kind];
            return (
              <path
                key={`${span.id}-${span.from}`}
                data-testid={`ring-span-${span.kind}`}
                d={sectorPath(C, C, inner, outer, span.from, span.to)}
                fill={look.fill}
                stroke={look.stroke}
                strokeWidth={look.stroke === 'none' ? 0 : 1.5}
                strokeLinejoin="round"
              />
            );
          })}
          {ring.windows.map((band) => (
            <path
              key={band.id}
              data-testid="ring-window"
              d={sectorPath(C, C, BAND_IN, BAND_OUT, band.from, band.to)}
              fill={swatch.window.fill}
              fillOpacity={swatch.window.fillOpacity}
              stroke={swatch.window.stroke}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinejoin="round"
            />
          ))}
          <g data-testid="ring-now">
            <line
              x1={nowIn.x}
              y1={nowIn.y}
              x2={nowOut.x}
              y2={nowOut.y}
              stroke={colors.primary.main}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={nowOut.x} cy={nowOut.y} r={4.5} fill={colors.primary.main} />
          </g>
          {hours.map((hour) => {
            const point = polar(C, C, LABEL_R, hour.angle);
            return (
              <text
                key={hour.key}
                data-testid="ring-hour"
                x={point.x}
                y={point.y}
                textAnchor={textAnchor(hour.angle)}
                dominantBaseline="central"
                fontSize={12}
                fill={colors.text.secondary}
                style={{ fontVariantNumeric: 'tabular-nums' }}
                aria-hidden
              >
                {hourText(hour.hour)}
              </text>
            );
          })}
        </svg>
        <Box
          aria-hidden
          data-testid="ring-middle"
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
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: 'min(0.8125rem, 4.6cqw)', lineHeight: 1.25 }}
          >
            {stateLabel}
          </Typography>
          <Typography
            variant="h4"
            component="p"
            sx={{
              fontSize: 'min(1.75rem, 9cqw)',
              lineHeight: 1.15,
              overflowWrap: 'anywhere',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {duration}
          </Typography>
        </Box>
      </Box>
      {windowLine && (
        <Typography
          variant="body2"
          data-testid="ring-window-line"
          sx={{ fontWeight: 600, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
        >
          {windowLine}
        </Typography>
      )}
      <RingLegend keys={ringLegendKeys(ring)} />
    </Box>
  );
}
