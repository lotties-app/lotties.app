import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Tooltip, Typography, useTheme } from '@mui/material';
import { formatTime } from '../../i18n/format';
import { palette } from '../../ui/form/styles';
import type { NapProjection } from '../napProjection';
import {
  nowDetail,
  rhythmDetails,
  rhythmDetailText,
  rhythmLabel,
  sortDetails,
  upcomingText,
  type BedtimeDetail,
  type ProjectedDetail,
  type RhythmText,
  type RhythmWindowInput,
} from '../rhythmDetails';
import { rulerGeometry, type RulerInput } from '../rulerGeometry';
import { LAYER_OF, type UpcomingItem } from '../upcoming';
import { laneMarks, type LaneMark } from '../upcomingLane';
import { BabyFace } from './BabyFace';
import { LayerChips } from './LayerChips';
import { useRingLayers } from './useRingLayers';
import { projectedLook, ringSwatchColors, type RingLook } from './ringSwatch';
import { RhythmDetailStrip } from './RhythmDetailStrip';
import { RingLegend } from './RingLegend';
import { rhythmMarkSx } from './rhythmMarks';
import { UpcomingList } from './UpcomingList';
import { LaneStamp } from './LaneStamp';
import { CONFIDENCE_STRENGTH, upcomingVisual } from './upcomingVisual';
import { useRhythmSelection } from './useRhythmSelection';

const MINUTE_MS = 60_000;
/** Height of the bar: the touch target of its marks. The track runs through its middle. */
const BAR = 32;
const FACE = 28;
const NOW_HIT = 32;
const WINDOW_HIT_MIN = 24;
/** The key of the "now" mark (rhythmDetails). */
const NOW_KEY = 'now';
/** The "next up" lane under the bar: 28 px targets around 22 px stamps, at least 11 % apart. */
const LANE = 28;
const LANE_STAMP = 22;
const LANE_MIN_GAP = 11;

export interface DayRulerProps extends RulerInput {
  /** The predicted nap window and its basis, when there is one. */
  window?: RhythmWindowInput;
  /** Pause-aware minutes awake, as the state card shows them (default: since to now). */
  minutes?: number;
  /** The overtired heads-up is showing (the tired face). */
  overtired?: boolean;
  /** The next bedtime window, drawn as an estimate and named in the details of "now". */
  bedTime?: { earliest: string; latest: string } | null;
  /** The naps still likely today (`projectNaps`), drawn as faint dashed bands. */
  projection?: NapProjection | null;
  /** What is likely still to come today (`upcomingToday`): the lane under the bar and its list. */
  upcoming?: readonly UpcomingItem[];
}

/**
 * One band of the ruler (the nap window, a projected nap, the bedtime window): a button as tall
 * as the bar and at least 24 px wide, the band drawn in it, and its selection ring.
 */
function RulerBand({
  testId,
  left,
  right,
  look,
  tip,
  markProps,
  upcoming,
}: {
  testId: string;
  left: number;
  right: number;
  look: RingLook;
  tip: string;
  markProps: ReturnType<ReturnType<typeof useRhythmSelection>['markProps']>;
  upcoming?: number;
}) {
  const percent = (opacity: number | undefined) => `${Math.round((opacity ?? 1) * 100)}%`;
  return (
    <Tooltip title={tip} placement="top" disableInteractive disableTouchListener>
      <ButtonBase
        className="rhythm-mark"
        disableRipple
        data-testid={`rhythm-mark-${testId.replace('ruler-', '')}`}
        {...markProps}
        sx={{
          position: 'absolute',
          top: 0,
          height: BAR,
          left: `${left}%`,
          width: `${right - left}%`,
          minWidth: WINDOW_HIT_MIN,
          zIndex: 1,
        }}
      >
        <Box
          data-testid={testId}
          data-upcoming={upcoming}
          sx={{
            position: 'absolute',
            top: BAR / 2 - 7,
            height: 14,
            left: 0,
            right: 0,
            borderRadius: 7,
            boxSizing: 'border-box',
            backgroundColor: `color-mix(in srgb, ${look.fill} ${percent(look.fillOpacity)}, transparent)`,
            border: `1.5px dashed color-mix(in srgb, ${look.stroke} ${percent(look.strokeOpacity)}, transparent)`,
          }}
        />
        <Box
          className="rhythm-ring"
          sx={(theme) => ({
            position: 'absolute',
            top: BAR / 2 - 10,
            height: 20,
            left: -3,
            right: -3,
            borderRadius: 10,
            boxSizing: 'border-box',
            border: `2px solid ${palette(theme).primary.main}`,
          })}
        />
      </ButtonBase>
    </Tooltip>
  );
}

/**
 * The "day ruler" (docs/design/02-visual-identity.md, direction B): the awake window as an ink
 * line from waking up to now, the predicted nap window as a soft band with a dashed edge (as on the
 * ring), and "now" as a small baby face (awake, drowsy in the window, tired during the overtired
 * heads-up). The bar is a labelled group (`now.ruler.*`); only its two ends are labelled under it
 * (pinned to the edges, so they never meet), and the window times are in the line above it. The
 * naps still likely today and the bedtime window follow as fainter dashed estimates (the bar then
 * reaches the last of them, and a legend names them). The bands and the face are buttons with the
 * same hover, tap and keyboard details as the ring (docs/DESIGN.md "Now: rhythm details").
 */
export function DayRuler(props: DayRulerProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const swatch = ringSwatchColors(theme);
  const accent = palette(theme).primary.main;
  const {
    since,
    now,
    window,
    overtired = false,
    bedTime = null,
    projection = null,
    upcoming,
  } = props;
  const layers = useRingLayers();
  const withLayers = upcoming !== undefined;
  const showSleep = !withLayers || layers.has('sleep');
  const minutes =
    props.minutes ?? Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / MINUTE_MS));
  const sleepDetails = useMemo(
    () =>
      rhythmDetails({
        events: [],
        types: [],
        now,
        ...(window ? { window } : {}),
        state: { kind: 'awake', since, minutes },
        overtired,
        bedTime,
        projection,
      }),
    [now, window, since, minutes, overtired, bedTime, projection],
  );
  const shownSleep = sleepDetails.filter((detail) => showSleep || detail.kind === 'now');
  const estimates = shownSleep.filter(
    (detail): detail is ProjectedDetail | BedtimeDetail =>
      detail.kind === 'projected' || detail.kind === 'bedtime',
  );
  const visible = (upcoming ?? []).filter((item) => layers.has(LAYER_OF[item.kind]));
  // The bar reaches the last estimate and the last "next up" item, so every marker is on it.
  const until = Math.max(
    0,
    ...estimates.map((detail) => detail.end),
    ...visible.map((item) => (item.windowEnd ?? item.at).getTime()),
  );
  const geometry = rulerGeometry({
    since,
    now,
    ...(window && showSleep ? { window } : {}),
    until,
  });
  const lane = laneMarks(visible, (item) => geometry.at(item.at.getTime()), LANE_MIN_GAP, [0, 100]);
  const details = sortDetails([...shownSleep, ...lane.marks.map((mark) => mark.detail)]);
  const texts = new Map<string, RhythmText>(
    details.map((detail) => [detail.key, rhythmDetailText(detail, t)]),
  );
  const selection = useRhythmSelection(details.map((detail) => detail.key));
  const face = nowDetail(details)?.face ?? 'awake';
  const label = window
    ? t('now.ruler.withWindow', {
        since: formatTime(since),
        now: formatTime(now),
        from: formatTime(window.earliest),
        to: formatTime(window.latest),
      })
    : t('now.ruler.noWindow', { since: formatTime(since), now: formatTime(now) });

  const nameOf = (key: string) => {
    const text = texts.get(key);
    return text ? rhythmLabel(text) : '';
  };
  const tip = (key: string) => (selection.selected === key ? '' : nameOf(key));
  const selectedText = selection.selected ? (texts.get(selection.selected) ?? null) : null;
  const band = geometry.band;
  const rows = visible.map((item) => ({
    item,
    text: upcomingText(item, t),
    markKey: lane.markOf.get(item.key) ?? `up-${item.key}`,
  }));
  const laneLegend = (['feeds', 'diapers', 'patterns', 'medicine'] as const).filter((layer) =>
    visible.some((item) => LAYER_OF[item.kind] === layer),
  );
  const anyLane = layers.layers.some((layer) => layer !== 'sleep');

  const nowMark = (
    <Tooltip key="now" title={tip(NOW_KEY)} placement="top" disableInteractive disableTouchListener>
      <ButtonBase
        className="rhythm-mark"
        disableRipple
        data-testid="rhythm-mark-now"
        {...selection.markProps(NOW_KEY, nameOf(NOW_KEY))}
        sx={{
          position: 'absolute',
          top: (BAR - NOW_HIT) / 2,
          width: NOW_HIT,
          height: NOW_HIT,
          borderRadius: '50%',
          left: `clamp(0px, calc(${geometry.nowPercent}% - ${NOW_HIT / 2}px), calc(100% - ${NOW_HIT}px))`,
          zIndex: 3,
        }}
      >
        <Box
          data-testid="ruler-now"
          data-face={face}
          sx={(theme) => ({
            display: 'inline-flex',
            borderRadius: '50%',
            // A halo in the card colour keeps the face apart from the track and the band.
            boxShadow: `0 0 0 1.5px ${palette(theme).background.paper}`,
            backgroundColor: palette(theme).background.paper,
          })}
        >
          <BabyFace face={face} size={FACE} />
        </Box>
        <Box
          className="rhythm-ring"
          sx={(theme) => ({
            position: 'absolute',
            inset: -1,
            borderRadius: '50%',
            border: `2px solid ${palette(theme).primary.main}`,
          })}
        />
      </ButtonBase>
    </Tooltip>
  );

  return (
    <Box>
      <Box role="group" aria-label={label} onKeyDown={selection.onKeyDown}>
        <Box sx={{ position: 'relative', height: BAR, mt: 1, mb: 0.5, ...rhythmMarkSx }}>
          <Box
            sx={(theme) => ({
              position: 'absolute',
              left: 0,
              right: 0,
              top: BAR / 2 - 2,
              height: 4,
              borderRadius: 2,
              backgroundColor: palette(theme).hairline,
            })}
          />
          <Box
            data-testid="ruler-awake"
            sx={(theme) => ({
              position: 'absolute',
              left: 0,
              top: BAR / 2 - 2,
              height: 4,
              borderRadius: 2,
              width: `${geometry.nowPercent}%`,
              backgroundColor: palette(theme).selection,
              pointerEvents: 'none',
              zIndex: 2,
            })}
          />
          {/* The buttons in time order (reading order); z-index keeps "now" on top. */}
          {details.map((detail) => {
            if (detail.kind === 'now') return nowMark;
            if (detail.kind === 'window' && band) {
              return (
                <RulerBand
                  key={detail.key}
                  testId="ruler-window"
                  left={band.left}
                  right={band.right}
                  // The same band as the nap window on the ring: a soft accent fill, a dashed edge.
                  look={swatch.window}
                  tip={tip('window')}
                  markProps={selection.markProps('window', nameOf('window'))}
                />
              );
            }
            if (detail.kind === 'projected' || detail.kind === 'bedtime') {
              return (
                <RulerBand
                  key={detail.key}
                  testId={detail.kind === 'projected' ? 'ruler-projected' : 'ruler-bedtime'}
                  left={geometry.at(detail.start)}
                  right={geometry.at(detail.end)}
                  look={
                    detail.kind === 'projected'
                      ? projectedLook(accent, detail.upcoming)
                      : swatch.bedtime
                  }
                  tip={tip(detail.key)}
                  markProps={selection.markProps(detail.key, nameOf(detail.key))}
                  {...(detail.kind === 'projected' ? { upcoming: detail.upcoming } : {})}
                />
              );
            }
            return null;
          })}
        </Box>
        {lane.marks.length > 0 && (
          <Box
            data-testid="ruler-lane"
            sx={{ position: 'relative', height: LANE, mb: 0.5, ...rhythmMarkSx }}
          >
            {lane.marks.map((mark) => (
              <RulerLaneMark
                key={mark.detail.key}
                mark={mark}
                left={(ms) => geometry.at(ms)}
                nowMs={now.getTime()}
                tip={tip(mark.detail.key)}
                markProps={selection.markProps(mark.detail.key, nameOf(mark.detail.key))}
              />
            ))}
          </Box>
        )}
        <Box aria-hidden sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">
            {formatTime(geometry.start)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatTime(geometry.end)}
          </Typography>
        </Box>
      </Box>
      <RhythmDetailStrip text={selectedText} onClear={() => selection.clear(true)} />
      {withLayers && (
        <Box sx={{ mt: 1 }}>
          <LayerChips layers={layers.layers} onToggle={layers.toggle} />
        </Box>
      )}
      {(estimates.length > 0 || laneLegend.length > 0) && (
        // Only with estimates on it: the bands need their names (the plain ruler has none).
        <Box sx={{ mt: 1 }}>
          <RingLegend
            label={t('now.ruler.legendLabel')}
            keys={[
              ...(band && showSleep ? (['window'] as const) : []),
              ...(estimates.some((d) => d.kind === 'projected') ? (['projected'] as const) : []),
              ...(estimates.some((d) => d.kind === 'bedtime') ? (['bedtime'] as const) : []),
              ...laneLegend,
              'now',
            ]}
            face={face}
          />
        </Box>
      )}
      {withLayers && (rows.length > 0 || anyLane) && (
        <Box sx={{ mt: 1 }}>
          <UpcomingList rows={rows} selected={selection.selected} onSelect={selection.select} />
        </Box>
      )}
    </Box>
  );
}

/**
 * One marker of the ruler's "next up" lane: a 28 px button at its time with the item's stamp (or
 * a cluster's count) and, for a window, a thin dashed line across it in the item's colour.
 */
function RulerLaneMark({
  mark,
  left,
  nowMs,
  tip,
  markProps,
}: {
  mark: LaneMark;
  left: (ms: number) => number;
  nowMs: number;
  tip: string;
  markProps: ReturnType<ReturnType<typeof useRhythmSelection>['markProps']>;
}) {
  const single = mark.items.length === 1 ? mark.items[0] : null;
  const visual = single ? upcomingVisual(single) : undefined;
  const span =
    single?.windowStart && single.windowEnd
      ? {
          from: left(Math.max(single.windowStart.getTime(), nowMs)),
          to: left(single.windowEnd.getTime()),
        }
      : null;
  return (
    <>
      {span && visual && span.to > span.from && (
        <Box
          aria-hidden
          data-testid="ruler-upcoming-window"
          sx={(theme) => ({
            position: 'absolute',
            top: LANE / 2 - 1.5,
            height: 3,
            left: `${span.from}%`,
            width: `${span.to - span.from}%`,
            borderTop: `3px dashed ${palette(theme).category[visual.category].fg}`,
            opacity: 0.55 * CONFIDENCE_STRENGTH[single?.confidence ?? 'high'],
            pointerEvents: 'none',
          })}
        />
      )}
      <Tooltip title={tip} placement="top" disableInteractive disableTouchListener>
        <ButtonBase
          className="rhythm-mark"
          disableRipple
          data-testid={single ? `ruler-upcoming-${single.kind}` : 'ruler-upcoming-cluster'}
          {...markProps}
          sx={{
            position: 'absolute',
            top: 0,
            width: LANE,
            height: LANE,
            borderRadius: '50%',
            left: `clamp(0px, calc(${mark.pos}% - ${LANE / 2}px), calc(100% - ${LANE}px))`,
            zIndex: 1,
          }}
        >
          {single ? (
            <LaneStamp visual={visual} confidence={single.confidence} size={LANE_STAMP} />
          ) : (
            <LaneStamp count={mark.items.length} size={LANE_STAMP} />
          )}
          <Box
            className="rhythm-ring"
            sx={(theme) => ({
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `2px solid ${palette(theme).primary.main}`,
            })}
          />
        </ButtonBase>
      </Tooltip>
    </>
  );
}
