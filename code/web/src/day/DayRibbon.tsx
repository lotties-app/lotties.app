import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Tooltip, type Theme } from '@mui/material';
import type { BabyEvent, EventType, Medication, Prescription } from '../db/models';
import { useEventTypeText } from '../i18n/eventTypeText';
import { formatDuration } from '../i18n/format';
import { currentLocale } from '../i18n/i18n';
import type { EventPresentation } from '../timeline/eventPresentation';
import type { CategoryName } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { focusRing, palette } from '../ui/form/styles';
import { isCategoryShown, toggleShown } from './dayModel';
import { RibbonDetail, type RibbonDetailTarget } from './RibbonDetail';
import { RibbonLegend } from './RibbonLegend';
import {
  clusterMarks,
  FALLBACK_WIDTH_PX,
  hourTicks,
  labelFits,
  MARK_SIZE_PX,
  nextFocusIndex,
  type MarkCluster,
} from './ribbonGeometry';
import {
  ribbonCategories,
  visibleRibbon,
  type RibbonBlock,
  type RibbonMark,
  type RibbonModel,
} from './ribbonModel';
import { clusterName, eventName, eventWhen, presentSafely } from './ribbonText';
import { useElementWidth } from './useElementWidth';

/** Height of a lane: the touch target of everything in it. */
const LANE_PX = 44;
const LANE_GAP_PX = 4;
const TRACK_PX = 28;
const LANES_PX = LANE_PX * 2 + LANE_GAP_PX;
/** Width of the touch target of a mark; thin sleep stretches get at least this much too. */
const HIT_PX = 32;
const MIN_BLOCK_PX = 4;
const MIN_BLOCK_HIT_PX = 24;

const pct = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;

const HOURS = hourTicks();

function hourLabel(hour: number): string {
  const format = new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', hourCycle: 'h23' });
  return format.format(new Date(2000, 0, 1, hour));
}

type Entry =
  | { key: string; at: number; kind: 'block'; block: RibbonBlock; name: string }
  | {
      key: string;
      at: number;
      kind: 'mark';
      lane: RibbonMark['lane'];
      cluster: MarkCluster<RibbonMark>;
      name: string;
    };

interface Props {
  /** The whole ribbon of the day (the legend hides and shows parts of it). */
  model: RibbonModel;
  /** Text alternative of the ribbon (totals). */
  label: string;
  types: readonly EventType[];
  medications: Medication[];
  prescriptions?: Prescription[];
  /** Filter categories of the baby's types (what the legend can toggle). */
  categories: readonly CategoryName[];
  /** The Day filter selection (empty = everything); shared with the filter sheet. */
  selected: ReadonlySet<CategoryName>;
  onSelectedChange: (selected: ReadonlySet<CategoryName>) => void;
  /** The current time; marks "now" and shades the rest of the day only when `isToday`. */
  now: Date;
  isToday: boolean;
  /** Fraction of the day that is now (only meaningful for today). */
  nowAt: number;
  /** Events with a row in the list below. */
  listedIds: ReadonlySet<string>;
  /** Opens an event in the edit sheet; omitted for viewers. */
  onOpen?: (event: BabyEvent) => void;
  onShowInList: (event: BabyEvent) => void;
}

/**
 * The 24-hour ribbon of a day: a sleep lane (naps, nights with their length inside when it fits,
 * night wakings, woke-up and bedtime markers) and an events lane (one icon mark per event in its
 * category colour; marks that would overlap become one counted mark), over an hour grid with a
 * "now" line on today. Every stretch and mark is a button (arrow keys move between them in time
 * order) that opens its detail. Under it the legend, which toggles the
 * same category filter as the filter sheet.
 */
export function DayRibbon(props: Props) {
  const { model, label, types, medications, prescriptions, now } = props;
  const { t } = useTranslation();
  const names = useEventTypeText();
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const widthPx = width ?? FALLBACK_WIDTH_PX;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<(RibbonDetailTarget & { key: string }) | null>(null);

  const views = useMemo(() => {
    const typeOf = new Map(types.map((type) => [type.id, type]));
    const map = new Map<string, { view: EventPresentation; name: string }>();
    const all = [...model.blocks.map((b) => b.event), ...model.marks.map((m) => m.event)];
    for (const event of all) {
      const type = typeOf.get(event.typeId);
      const view = presentSafely(event, type, medications, names, prescriptions);
      map.set(event.id, {
        view,
        name: eventName(view, type, names, eventWhen(event, type, t, now), t),
      });
    }
    return map;
  }, [model, types, medications, prescriptions, names, t, now]);

  const visible = visibleRibbon(model, (category) => isCategoryShown(props.selected, category));
  const entries: Entry[] = [
    ...visible.blocks.map((block) => ({
      key: block.id,
      at: block.from,
      kind: 'block' as const,
      block,
      name: views.get(block.id)?.name ?? '',
    })),
    ...(['sleep', 'events'] as const).flatMap((lane) =>
      clusterMarks(
        visible.marks.filter((mark) => mark.lane === lane),
        widthPx,
      ).map((cluster) => ({
        key: cluster.key,
        at: cluster.items[0].at,
        kind: 'mark' as const,
        lane,
        cluster,
        name:
          cluster.items.length === 1
            ? (views.get(cluster.items[0].id)?.name ?? '')
            : clusterName(
                cluster.items.map((item) => item.event),
                t,
              ),
      })),
    ),
  ].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  const tabKey = entries.some((entry) => entry.key === activeKey) ? activeKey : entries[0]?.key;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = entries.findIndex((entry) => buttons.current.get(entry.key) === event.target);
    if (current < 0) return;
    const next = nextFocusIndex(current, entries.length, event.key);
    if (next === null) return;
    event.preventDefault();
    const key = entries[next].key;
    setActiveKey(key);
    buttons.current.get(key)?.focus();
  };

  const open = (entry: Entry) => (event: MouseEvent<HTMLButtonElement>) => {
    setActiveKey(entry.key);
    const events =
      entry.kind === 'block' ? [entry.block.event] : entry.cluster.items.map((item) => item.event);
    setDetail({
      key: entry.key,
      anchor: event.currentTarget,
      events,
      index: events.length === 1 ? 0 : null,
    });
  };

  const buttonProps = (entry: Entry) => ({
    ref: (element: HTMLButtonElement | null) => {
      if (element) buttons.current.set(entry.key, element);
      else buttons.current.delete(entry.key);
    },
    'aria-label': entry.name,
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': detail?.key === entry.key,
    tabIndex: entry.key === tabKey ? 0 : -1,
    disableRipple: true,
    onClick: open(entry),
    onFocus: () => setActiveKey(entry.key),
  });

  const present = ribbonCategories(model);

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box role="group" aria-label={label} sx={{ display: 'grid', gap: 0.25 }}>
        <Box ref={ref} onKeyDown={onKeyDown} sx={{ position: 'relative', height: LANES_PX }}>
          <Grid />
          {props.isToday && <FutureShade at={props.nowAt} />}
          {entries.map((entry) => {
            const tip = detail ? '' : entry.name;
            if (entry.kind === 'block') {
              return (
                <Tooltip key={entry.key} title={tip} placement="top" disableInteractive>
                  <ButtonBase
                    {...buttonProps(entry)}
                    sx={(theme) => blockSx(theme, entry.block, widthPx)}
                  >
                    <BlockVisual block={entry.block} widthPx={widthPx} />
                  </ButtonBase>
                </Tooltip>
              );
            }
            return (
              <Tooltip key={entry.key} title={tip} placement="top" disableInteractive>
                <ButtonBase
                  {...buttonProps(entry)}
                  sx={(theme) => markSx(theme, entry.cluster.at, entry.lane)}
                >
                  <MarkVisual
                    cluster={entry.cluster}
                    lane={entry.lane}
                    icon={views.get(entry.cluster.items[0].id)?.view.icon}
                  />
                </ButtonBase>
              </Tooltip>
            );
          })}
          {props.isToday && <NowLine at={props.nowAt} />}
        </Box>
        <Axis />
      </Box>
      <RibbonLegend
        present={present}
        filterable={props.categories}
        selected={props.selected}
        onToggle={(category) =>
          props.onSelectedChange(toggleShown(props.selected, category, props.categories))
        }
      />
      {detail && (
        <RibbonDetail
          target={detail}
          onPick={(index) => setDetail({ ...detail, index })}
          onClose={() => setDetail(null)}
          types={types}
          medications={medications}
          {...(prescriptions ? { prescriptions } : {})}
          now={now}
          listedIds={props.listedIds}
          {...(props.onOpen ? { onOpen: props.onOpen } : {})}
          onShowInList={props.onShowInList}
        />
      )}
    </Box>
  );
}

/** Focus and hover rings go on the visible part (`.ribbon-mark`), not the larger touch target. */
const interactiveSx = (theme: Theme) => ({
  position: 'absolute' as const,
  height: LANE_PX,
  borderRadius: '8px',
  '&.Mui-focusVisible .ribbon-mark, &[aria-expanded="true"] .ribbon-mark': {
    outline: focusRing(theme),
    outlineOffset: 2,
  },
  '@media (hover: hover)': {
    '&:hover .ribbon-mark': {
      outline: `1.5px solid ${palette(theme).text.secondary}`,
      outlineOffset: 1,
    },
  },
  '@media (forced-colors: active)': { '& .ribbon-mark': { border: '1px solid ButtonText' } },
});

function blockSx(theme: Theme, block: RibbonBlock, widthPx: number) {
  const visual = Math.max(MIN_BLOCK_PX, (block.to - block.from) * widthPx);
  const hit = Math.max(visual, MIN_BLOCK_HIT_PX);
  return {
    ...interactiveSx(theme),
    top: 0,
    width: `${hit}px`,
    left: `clamp(0px, calc(${pct(block.from)} - ${(hit - visual) / 2}px), calc(100% - ${hit}px))`,
    zIndex: block.kind === 'nightWaking' ? 2 : 1,
  };
}

function blockColors(theme: Theme, kind: RibbonBlock['kind']) {
  const sleep = palette(theme).category.sleep;
  const waking = palette(theme).category.nightWaking;
  if (kind === 'night') return { bg: sleep.fg, fg: sleep.bg, ring: 'none' };
  if (kind === 'nap') return { bg: sleep.bg, fg: sleep.fg, ring: `inset 0 0 0 1.5px ${sleep.fg}` };
  return { bg: waking.bg, fg: waking.fg, ring: `inset 0 0 0 1.5px ${waking.fg}` };
}

/** A stretch of sleep: a night solid, a nap tinted with a rim, a night waking as a notch. */
function BlockVisual({ block, widthPx }: { block: RibbonBlock; widthPx: number }) {
  const text = formatDuration(block.durationMs);
  const fits = block.kind !== 'nightWaking' && labelFits(text, block.to - block.from, widthPx);
  const inset = block.kind === 'nightWaking' ? 4 : 0;
  const visual = Math.max(MIN_BLOCK_PX, (block.to - block.from) * widthPx);
  return (
    <Box
      className="ribbon-mark"
      sx={(theme) => {
        const colors = blockColors(theme, block.kind);
        return {
          position: 'absolute',
          top: (LANE_PX - TRACK_PX) / 2 - inset,
          height: TRACK_PX + inset * 2,
          left: '50%',
          width: `${visual}px`,
          transform: 'translateX(-50%)',
          borderRadius: block.kind === 'nightWaking' ? '5px' : '7px',
          backgroundColor: colors.bg,
          boxShadow: colors.ring,
          color: colors.fg,
          // A running stretch fades into "now" instead of ending on a hard edge.
          ...(block.running
            ? { maskImage: 'linear-gradient(to right, #000 calc(100% - 10px), transparent)' }
            : {}),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        };
      }}
    >
      {fits && (
        <Box
          component="span"
          aria-hidden
          sx={{
            fontSize: '0.75rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'lining-nums tabular-nums',
          }}
        >
          {text}
        </Box>
      )}
    </Box>
  );
}

function markSx(theme: Theme, at: number, lane: RibbonMark['lane']) {
  return {
    ...interactiveSx(theme),
    top: lane === 'sleep' ? 0 : LANE_PX + LANE_GAP_PX,
    width: `${HIT_PX}px`,
    left: `clamp(0px, calc(${pct(at)} - ${HIT_PX / 2}px), calc(100% - ${HIT_PX}px))`,
    zIndex: 3,
  };
}

/**
 * An event mark: its icon on the category tint. Several close ones show the first one's icon with
 * a count badge (a neutral tint when they mix categories).
 */
function MarkVisual({
  cluster,
  lane,
  icon,
}: {
  cluster: MarkCluster<RibbonMark>;
  lane: RibbonMark['lane'];
  icon: EventPresentation['icon'] | undefined;
}) {
  const count = cluster.items.length;
  const categories = new Set(cluster.items.map((item) => item.category));
  const single = categories.size === 1 ? cluster.items[0].category : null;
  return (
    <Box
      className="ribbon-mark"
      sx={(theme) => {
        const p = palette(theme);
        const pair = single ? p.category[single] : null;
        const sleepLane = lane === 'sleep';
        const bg = sleepLane ? p.background.paper : (pair?.bg ?? p.surfaceRaised);
        const fg = pair?.fg ?? p.text.primary;
        // Sleep markers sit on the track: a halo in the page colour keeps them apart from it.
        const halo = sleepLane ? `, 0 0 0 2px ${p.background.paper}` : '';
        return {
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: MARK_SIZE_PX,
          height: MARK_SIZE_PX,
          borderRadius: '50%',
          backgroundColor: bg,
          color: fg,
          boxShadow: `inset 0 0 0 ${sleepLane || !pair ? 1.5 : 1}px ${pair?.fg ?? p.text.secondary}${halo}`,
        };
      }}
    >
      <Icon name={icon ?? 'event'} size={16} />
      {count > 1 && (
        <Box
          component="span"
          aria-hidden
          sx={(theme) => ({
            position: 'absolute',
            top: -7,
            right: -9,
            minWidth: 15,
            height: 15,
            px: '3px',
            borderRadius: '8px',
            fontSize: '0.6875rem',
            lineHeight: '15px',
            fontWeight: 700,
            textAlign: 'center',
            fontVariantNumeric: 'lining-nums tabular-nums',
            backgroundColor: palette(theme).text.primary,
            color: palette(theme).background.paper,
            boxShadow: `0 0 0 1.5px ${palette(theme).background.paper}`,
          })}
        >
          {count}
        </Box>
      )}
    </Box>
  );
}

/** Faint lines at 06, 12 and 18 through both lanes, the sleep track and the events baseline. */
function Grid() {
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <Box
        sx={(theme) => ({
          position: 'absolute',
          left: 0,
          right: 0,
          top: (LANE_PX - TRACK_PX) / 2,
          height: TRACK_PX,
          borderRadius: '8px',
          backgroundColor: palette(theme).surfaceRaised,
        })}
      />
      <Box
        sx={(theme) => ({
          position: 'absolute',
          left: 0,
          right: 0,
          top: LANE_PX + LANE_GAP_PX + LANE_PX / 2,
          height: '1px',
          backgroundColor: palette(theme).hairline,
        })}
      />
      {HOURS.filter((tick) => tick.major).map((tick) => (
        <Box
          key={tick.hour}
          sx={(theme) => ({
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: pct(tick.at),
            width: '1px',
            backgroundColor: palette(theme).hairline,
          })}
        />
      ))}
    </Box>
  );
}

/** The rest of today, not lived yet: a veil in the page colour. */
function FutureShade({ at }: { at: number }) {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: pct(at),
        right: 0,
        pointerEvents: 'none',
        backgroundColor: `color-mix(in srgb, ${palette(theme).background.default} 70%, transparent)`,
      })}
    />
  );
}

function NowLine({ at }: { at: number }) {
  return (
    <Box
      aria-hidden
      data-testid="ribbon-now"
      sx={(theme) => ({
        position: 'absolute',
        top: 2,
        bottom: 0,
        left: pct(at),
        width: '2px',
        ml: '-1px',
        // Above the sleep stretches, under the marks (a mark logged just now stays readable).
        zIndex: 2,
        pointerEvents: 'none',
        borderRadius: '1px',
        backgroundColor: palette(theme).primary.main,
        '&::before': {
          content: '""',
          position: 'absolute',
          top: -3,
          left: -2,
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: palette(theme).primary.main,
        },
      })}
    />
  );
}

/** Hour ticks every hour (stronger at 06, 12, 18) and labels every three hours. */
function Axis() {
  useTranslation();
  return (
    <Box
      aria-hidden
      sx={{
        position: 'relative',
        height: 22,
        fontSize: '0.75rem',
        color: 'text.secondary',
        fontVariantNumeric: 'lining-nums tabular-nums',
      }}
    >
      {HOURS.map((tick) => (
        <Box
          key={tick.hour}
          sx={(theme) => ({
            position: 'absolute',
            top: 0,
            left: pct(tick.at),
            width: '1px',
            height: tick.major ? 7 : tick.labelled ? 5 : 3,
            backgroundColor: tick.major ? palette(theme).text.secondary : palette(theme).hairline,
          })}
        />
      ))}
      {HOURS.filter((tick) => tick.labelled).map((tick) => (
        <Box
          key={`label-${tick.hour}`}
          component="span"
          sx={{
            position: 'absolute',
            top: 7,
            lineHeight: 1.2,
            left: pct(tick.at),
            transform: tick.hour === 0 ? 'none' : 'translateX(-50%)',
            fontWeight: tick.major ? 600 : 400,
          }}
        >
          {hourLabel(tick.hour)}
        </Box>
      ))}
    </Box>
  );
}
