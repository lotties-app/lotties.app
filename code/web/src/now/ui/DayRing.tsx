import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import type { BabyEvent, EventType } from '../../db/models';
import { currentLocale } from '../../i18n/i18n';
import { palette } from '../../ui/form/styles';
import { ringDescription, ringWindowLine } from '../ringText';
import { formatTime } from '../../i18n/format';
import type { NapProjection } from '../napProjection';
import {
  angleOf,
  arcPath,
  buildRing,
  polar,
  spanAngles,
  RING_HOURS,
  ringHourLabels,
  ringLegendKeys,
  sectorPath,
  type Point,
  type RingSpanKind,
} from '../ringGeometry';
import {
  nowDetail,
  rhythmDetails,
  rhythmDetailText,
  rhythmLabel,
  type RhythmDetail,
  type RhythmNow,
  type RhythmWindowInput,
} from '../rhythmDetails';
import { BabyFace, FACE_HEAD_SHARE, FACE_HEAD_Y } from './BabyFace';
import { RhythmDetailStrip } from './RhythmDetailStrip';
import { RingLegend } from './RingLegend';
import { projectedLook, ringSwatchColors } from './ringSwatch';
import { rhythmMarkSx, virtualAnchor } from './rhythmMarks';
import { useRhythmSelection } from './useRhythmSelection';

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
const LABEL_R = TRACK_OUT + 15;
const TICK_IN = TRACK_IN - 13;
const TICK_OUT = TRACK_IN - 8;
/** The baby face of "now" (about 24 px on a 320 px phone) and its halo in the card colour. */
const FACE = 30;
const FACE_HALO = FACE * FACE_HEAD_SHARE + 1.5;
const FACE_R = BAND_OUT + FACE_HALO;
/** Touch targets: 8 units beyond the track each side, and at least 16 degrees (26 units) long. */
const HIT_IN = TRACK_IN - 8;
const HIT_OUT = TRACK_OUT + 8;
const HIT_MIN_DEGREES = 16;
const FACE_HIT = 16;

export interface DayRingProps {
  events: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  /** Predicted nap window (ISO) and its basis, when there is one. */
  window?: RhythmWindowInput;
  /** "Awake" / "Asleep · Nap" and the live duration, shown in the middle. */
  stateLabel: string;
  duration: string;
  /** What the baby is doing now, for the face and the details of "now". */
  state?: RhythmNow;
  /** The overtired heads-up is showing (the tired face). */
  overtired?: boolean;
  /** The next bedtime window, drawn as an estimate and named in the details of "now". */
  bedTime?: { earliest: string; latest: string } | null;
  /** The naps still likely today (`projectNaps`): faint dashed bands, the likely wake-up. */
  projection?: NapProjection | null;
}

/** Paint order: sleep under the estimates, the server's window over them, "now" on top. */
const Z_ORDER: Record<RhythmDetail['kind'], number> = {
  sleep: 0,
  bedtime: 1,
  projected: 1,
  window: 2,
  wake: 3,
  now: 4,
};

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

/** An arc widened to the least touch length, around its middle. */
function padded(from: number, to: number, min = HIT_MIN_DEGREES): [number, number] {
  const extra = Math.max(0, min - (to - from)) / 2;
  return [from - extra, to + extra];
}

interface Mark {
  detail: RhythmDetail;
  /** Where the tooltip points (viewBox units). */
  anchor: Point;
  /** The drawn mark, its touch target and its selection ring. */
  visual: ReactElement;
  hit: ReactElement;
  ring: ReactElement;
}

/**
 * The day rhythm ring: one question, where the baby is in today's sleep rhythm and when the next
 * nap window is. A 24 hour face (midnight at the top, clockwise) with today's sleep as blocks in
 * the Day ribbon's style (a night solid, a nap tinted with a rim, a night waking as a notch), the
 * predicted nap window as an outlined band on the ring, and "now" as the accent line ending in a
 * small baby face (awake, drowsy in the window, asleep, tired during the overtired heads-up). Only
 * four hour labels, outside the ring, one dropped when "now" sits on it; the window times go in the
 * line under the ring, and a legend names every mark.
 *
 * Every mark is a button (docs/DESIGN.md "Now: rhythm details"): hover shows its details in a
 * tooltip, a tap or Enter selects it and shows them in the strip under the ring, the arrow keys
 * move between marks in time order and Esc clears. Nothing extra shows while nothing is selected.
 * The ring is a labelled group (`ringDescription`); the legend is a list.
 */
export function DayRing({
  events,
  types,
  now,
  window,
  stateLabel,
  duration,
  state,
  overtired = false,
  bedTime = null,
  projection = null,
}: DayRingProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const colors = palette(theme);
  const swatch = ringSwatchColors(theme);
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const ring = useMemo(
    () => buildRing({ events, types, now, ...(window ? { windows: [window] } : {}) }),
    [events, types, now, window],
  );
  const details = useMemo(
    () =>
      rhythmDetails({
        events,
        types,
        now,
        ...(window ? { window } : {}),
        ...(state ? { state } : {}),
        overtired,
        bedTime,
        projection,
      }),
    [events, types, now, window, state, overtired, bedTime, projection],
  );
  const label = ringDescription(ring, t, now, stateLabel, duration);
  // Without the server's window ahead (she is asleep), the line names the first projected nap.
  const firstProjected = details.find((d) => d.kind === 'projected' && d.first);
  const windowLine =
    ringWindowLine(ring, t, now) ??
    (firstProjected && firstProjected.kind === 'projected'
      ? t('now.ring.nextWindow', {
          from: formatTime(firstProjected.start),
          to: formatTime(firstProjected.end),
        })
      : null);
  const hours = ringHourLabels(ring.nowAngle);
  const nowIn = polar(C, C, NOW_IN, ring.nowAngle);
  const faceAt = polar(C, C, FACE_R, ring.nowAngle);
  const lineEnd = polar(C, C, FACE_R - FACE_HALO, ring.nowAngle);
  const face = nowDetail(details)?.face ?? 'awake';

  const marks: Mark[] = [];
  for (const detail of details) {
    if (detail.kind === 'sleep') {
      const span = ring.spans.find((candidate) => candidate.id === detail.key);
      if (!span) continue;
      const [inner, outer] = SPAN_RADII[span.kind];
      const look = swatch[span.kind];
      const [hitFrom, hitTo] = padded(span.from, span.to);
      marks.push({
        detail,
        anchor: polar(C, C, outer, (span.from + span.to) / 2),
        visual: (
          <path
            data-testid={`ring-span-${span.kind}`}
            d={sectorPath(C, C, inner, outer, span.from, span.to)}
            fill={look.fill}
            stroke={look.stroke}
            strokeWidth={look.stroke === 'none' ? 0 : 1.5}
            strokeLinejoin="round"
          />
        ),
        hit: <path d={sectorPath(C, C, HIT_IN, HIT_OUT, hitFrom, hitTo)} fill="transparent" />,
        ring: (
          <path
            className="rhythm-ring"
            d={sectorPath(C, C, inner - 3, outer + 3, span.from - 1.5, span.to + 1.5)}
            fill="none"
            stroke={colors.primary.main}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ),
      });
    } else if (detail.kind === 'window') {
      const band = ring.windows[0];
      if (!band) continue;
      const [hitFrom, hitTo] = padded(band.from, band.to);
      marks.push({
        detail,
        anchor: polar(C, C, BAND_OUT, (band.from + band.to) / 2),
        visual: (
          <path
            data-testid="ring-window"
            d={sectorPath(C, C, BAND_IN, BAND_OUT, band.from, band.to)}
            fill={swatch.window.fill}
            fillOpacity={swatch.window.fillOpacity}
            stroke={swatch.window.stroke}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />
        ),
        hit: <path d={sectorPath(C, C, HIT_IN, HIT_OUT, hitFrom, hitTo)} fill="transparent" />,
        ring: (
          <path
            className="rhythm-ring"
            d={sectorPath(C, C, BAND_IN - 3, BAND_OUT + 3, band.from - 1.5, band.to + 1.5)}
            fill="none"
            stroke={colors.primary.main}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ),
      });
    } else if (detail.kind === 'projected' || detail.kind === 'bedtime') {
      const arc = spanAngles(detail.start, detail.end, ring.frame)[0];
      if (!arc) continue;
      const look =
        detail.kind === 'projected'
          ? projectedLook(colors.primary.main, detail.upcoming)
          : swatch.bedtime;
      const [hitFrom, hitTo] = padded(arc.from, arc.to);
      marks.push({
        detail,
        anchor: polar(C, C, BAND_OUT, (arc.from + arc.to) / 2),
        visual: (
          <path
            data-testid={detail.kind === 'projected' ? 'ring-projected' : 'ring-bedtime'}
            data-upcoming={detail.kind === 'projected' ? detail.upcoming : undefined}
            d={sectorPath(C, C, BAND_IN, BAND_OUT, arc.from, arc.to)}
            fill={look.fill}
            fillOpacity={look.fillOpacity}
            stroke={look.stroke}
            strokeOpacity={look.strokeOpacity ?? 1}
            strokeWidth={1.5}
            strokeDasharray={look.dash}
            strokeLinejoin="round"
          />
        ),
        hit: <path d={sectorPath(C, C, HIT_IN, HIT_OUT, hitFrom, hitTo)} fill="transparent" />,
        ring: (
          <path
            className="rhythm-ring"
            d={sectorPath(C, C, BAND_IN - 3, BAND_OUT + 3, arc.from - 1.5, arc.to + 1.5)}
            fill="none"
            stroke={colors.primary.main}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ),
      });
    } else if (detail.kind === 'wake') {
      const at = angleOf(detail.start, ring.frame);
      const point = polar(C, C, R, at);
      const [hitFrom, hitTo] = padded(at, at);
      marks.push({
        detail,
        anchor: polar(C, C, TRACK_OUT, at),
        visual: (
          <g data-testid="ring-wake">
            <path
              d={arcPath(C, C, R, ring.nowAngle, at)}
              fill="none"
              stroke={swatch.wake.stroke}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={swatch.wake.dash}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={5}
              fill={colors.background.paper}
              stroke={swatch.wake.stroke}
              strokeWidth={2}
            />
          </g>
        ),
        hit: <path d={sectorPath(C, C, HIT_IN, HIT_OUT, hitFrom, hitTo)} fill="transparent" />,
        ring: (
          <circle
            className="rhythm-ring"
            cx={point.x}
            cy={point.y}
            r={9}
            fill="none"
            stroke={colors.primary.main}
            strokeWidth={2}
          />
        ),
      });
    } else {
      marks.push({
        detail,
        anchor: { x: faceAt.x, y: faceAt.y - FACE_HALO },
        visual: (
          <g data-testid="ring-now" data-face={face}>
            <line
              x1={nowIn.x}
              y1={nowIn.y}
              x2={lineEnd.x}
              y2={lineEnd.y}
              stroke={colors.primary.main}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={faceAt.x} cy={faceAt.y} r={FACE_HALO} fill={colors.background.paper} />
            <g transform={`translate(${faceAt.x - FACE / 2} ${faceAt.y - FACE * FACE_HEAD_Y})`}>
              <BabyFace face={face} size={FACE} />
            </g>
          </g>
        ),
        hit: <circle cx={faceAt.x} cy={faceAt.y} r={FACE_HIT} fill="transparent" />,
        ring: (
          <circle
            className="rhythm-ring"
            cx={faceAt.x}
            cy={faceAt.y}
            r={FACE_HALO + 2}
            fill="none"
            stroke={colors.primary.main}
            strokeWidth={2}
          />
        ),
      });
    }
  }

  const texts = new Map(marks.map((mark) => [mark.detail.key, rhythmDetailText(mark.detail, t)]));
  const keys = marks.map((mark) => mark.detail.key);
  const selection = useRhythmSelection(keys);
  const selectedText = selection.selected ? (texts.get(selection.selected) ?? null) : null;

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
          ...rhythmMarkSx,
        }}
      >
        <svg
          ref={setSvg}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width="100%"
          height="100%"
          role="group"
          aria-label={label}
          focusable="false"
          style={{ display: 'block' }}
          onKeyDown={selection.onKeyDown}
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
          {/* The drawing in paint order; the buttons over it come in time order (reading order). */}
          <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
            {[...marks]
              .sort((a, b) => Z_ORDER[a.detail.kind] - Z_ORDER[b.detail.kind])
              .map((mark) => (
                <g key={mark.detail.key}>{mark.visual}</g>
              ))}
          </g>
          {marks.map((mark) => {
            const key = mark.detail.key;
            const text = texts.get(key);
            const name = text ? rhythmLabel(text) : '';
            return (
              <Tooltip
                key={key}
                title={selection.selected === key ? '' : name}
                placement="top"
                disableInteractive
                disableTouchListener
                slotProps={{ popper: { anchorEl: virtualAnchor(svg, mark.anchor, SIZE) } }}
              >
                <g
                  className="rhythm-mark"
                  role="button"
                  data-testid={`rhythm-mark-${mark.detail.kind}`}
                  {...selection.markProps(key, name)}
                >
                  {mark.hit}
                  {mark.ring}
                </g>
              </Tooltip>
            );
          })}
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
                style={{ fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}
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
      <RhythmDetailStrip text={selectedText} onClear={() => selection.clear(true)} />
      {windowLine && (
        <Typography
          variant="body2"
          data-testid="ring-window-line"
          sx={{ fontWeight: 600, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
        >
          {windowLine}
        </Typography>
      )}
      <RingLegend
        keys={ringLegendKeys(ring, {
          projected: marks.some((mark) => mark.detail.kind === 'projected'),
          wake: marks.some((mark) => mark.detail.kind === 'wake'),
          bedtime: marks.some((mark) => mark.detail.kind === 'bedtime'),
        })}
        face={face}
      />
    </Box>
  );
}
