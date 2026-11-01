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
  type BedtimeDetail,
  type ProjectedDetail,
  type RhythmText,
  type RhythmWindowInput,
} from '../rhythmDetails';
import { rulerGeometry, type RulerInput } from '../rulerGeometry';
import { BabyFace } from './BabyFace';
import { projectedLook, ringSwatchColors, type RingLook } from './ringSwatch';
import { RhythmDetailStrip } from './RhythmDetailStrip';
import { RingLegend } from './RingLegend';
import { rhythmMarkSx } from './rhythmMarks';
import { useRhythmSelection } from './useRhythmSelection';

const MINUTE_MS = 60_000;
/** Height of the bar: the touch target of its marks. The track runs through its middle. */
const BAR = 32;
const FACE = 28;
const NOW_HIT = 32;
const WINDOW_HIT_MIN = 24;
/** The key of the "now" mark (rhythmDetails). */
const NOW_KEY = 'now';

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
  const { since, now, window, overtired = false, bedTime = null, projection = null } = props;
  const minutes =
    props.minutes ?? Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / MINUTE_MS));
  const details = useMemo(
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
  const estimates = details.filter(
    (detail): detail is ProjectedDetail | BedtimeDetail =>
      detail.kind === 'projected' || detail.kind === 'bedtime',
  );
  const until = Math.max(0, ...estimates.map((detail) => detail.end));
  const geometry = rulerGeometry({ since, now, ...(window ? { window } : {}), until });
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
      {estimates.length > 0 && (
        // Only with estimates on it: the bands need their names (the plain ruler has none).
        <Box sx={{ mt: 1 }}>
          <RingLegend
            label={t('now.ruler.legendLabel')}
            keys={[
              ...(band ? (['window'] as const) : []),
              ...(estimates.some((d) => d.kind === 'projected') ? (['projected'] as const) : []),
              ...(estimates.some((d) => d.kind === 'bedtime') ? (['bedtime'] as const) : []),
              'now',
            ]}
            face={face}
          />
        </Box>
      )}
    </Box>
  );
}
