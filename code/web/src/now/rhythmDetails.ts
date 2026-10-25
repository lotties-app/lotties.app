import type { TFunction } from 'i18next';
import type { BabyEvent, EventType } from '../db/models';
import { roundToStep } from '../events/bottleSuggestions';
import { formatDuration, formatList, formatTime } from '../i18n/format';
import { volumeNumberText, volumeText } from '../units/display';
import { dayPartPhrase } from '../medications/dayPartText';
import { readBasis } from '../predictions/predictionModel';
import { effectiveDurationMs } from '../timers/pauseMath';
import { MINUTE_MS, isSleepKind, sleepSessionKind, typeIdsForKey } from './eventFacts';
import { napGuidance } from './napGuidance';
import type { NapProjection } from './napProjection';
import { dayFrame } from './ringGeometry';
import type { FeedBasis, UpcomingItem } from './upcoming';

/*
 * The details behind the marks of the day ring and the ruler (docs/DESIGN.md "Now: rhythm
 * details"): what a tap, a hover or the arrow keys tell about one mark. Built only from what the
 * charts already show (the logged sleeps, the predicted nap window and its server basis, the
 * napGuidance phase, the overtired heads-up and the bed time estimate): no new heuristics, no
 * judgement of a length. The model is pure and language-free; `rhythmDetailText` writes it.
 */

/** The face of the "now" marker. */
export type FaceState = 'awake' | 'drowsy' | 'asleep' | 'tired';

/** What the baby is doing now, as the state card says it (minutes are pause-aware). */
export type RhythmNow =
  | { kind: 'awake'; since: string; minutes: number }
  | { kind: 'asleep'; since: string; minutes: number }
  | { kind: 'waking'; since: string; minutes: number }
  | { kind: 'unknown' };

export interface RhythmWindowInput {
  earliest: string;
  latest: string;
  /** The prediction's structured basis (see predictions/predictionModel.ts `readBasis`). */
  basis?: Record<string, unknown>;
}

export interface RhythmInput {
  events: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  /** The predicted nap window the chart draws, when there is one. */
  window?: RhythmWindowInput;
  state?: RhythmNow;
  /** The overtired heads-up is showing (`overtiredSuggestion` is not `null`). */
  overtired?: boolean;
  /** The next bedtime window (heuristic v1.1), when the server sent one. */
  bedTime?: { earliest: string; latest: string } | null;
  /** The naps still likely today (`projectNaps`), drawn as estimates. */
  projection?: NapProjection | null;
}

export type SleepMarkKind = 'night' | 'nap' | 'waking';

export interface SleepDetail {
  kind: 'sleep';
  /** The event id (the ring's span id). */
  key: string;
  sleepKind: SleepMarkKind;
  start: number;
  /** `null` while it runs. */
  end: number | null;
  /** Pause-aware length, until now while it runs. */
  durationMs: number;
}

export type WindowPhase = 'ahead' | 'open' | 'past';

export interface WindowDetail {
  kind: 'window';
  key: 'window';
  start: number;
  end: number;
  phase: WindowPhase;
  /** Until it opens (ahead) or closes (open); 0 once it has passed. */
  untilMs: number;
  basis: { kind: 'AwakeWindow' | 'StartInterval'; gapMinutes: number } | null;
}

/** A projected nap window (an estimate, see now/napProjection.ts). */
export interface ProjectedDetail {
  kind: 'projected';
  key: string;
  start: number;
  end: number;
  /** The first upcoming nap (no server window before it): "Next nap window". */
  first: boolean;
  /** 0 for the first upcoming nap, then 1, 2...: further ones are drawn fainter. */
  upcoming: number;
  basis: NapProjection['basis'];
}

/** While a nap runs: when she likely wakes (an estimate). */
export interface WakeDetail {
  kind: 'wake';
  key: 'wake';
  start: number;
  /** Where the dotted tail starts (now). */
  from: number;
  napMinutes: number;
}

export interface BedtimeDetail {
  kind: 'bedtime';
  key: 'bedtime';
  start: number;
  end: number;
}

export type NextUp =
  | { kind: 'windowOpens'; at: number; estimate?: boolean }
  | { kind: 'windowCloses'; at: number }
  | { kind: 'wake'; at: number }
  | { kind: 'bedtime'; from: number; to: number };

export interface NowDetail {
  kind: 'now';
  key: 'now';
  start: number;
  face: FaceState;
  state: RhythmNow;
  next: NextUp | null;
}

/** One "next up" marker (now/upcoming.ts): a feed, a diaper, a pattern window or a dose. */
export interface UpcomingDetail {
  kind: 'upcoming';
  key: string;
  start: number;
  item: UpcomingItem;
}

/** Several "next up" markers too close to draw apart, as one marker. */
export interface UpcomingClusterDetail {
  kind: 'upcomingCluster';
  key: string;
  start: number;
  items: UpcomingItem[];
}

export type RhythmDetail =
  | SleepDetail
  | WindowDetail
  | NowDetail
  | ProjectedDetail
  | WakeDetail
  | BedtimeDetail
  | UpcomingDetail
  | UpcomingClusterDetail;

/** Order of marks that start at the same instant: sleep, the windows, now, the estimates. */
const RANK: Record<RhythmDetail['kind'], number> = {
  sleep: 0,
  window: 1,
  now: 2,
  wake: 3,
  projected: 4,
  bedtime: 5,
  upcoming: 6,
  upcomingCluster: 6,
};

/** The mark of one upcoming item. */
export function upcomingDetail(item: UpcomingItem): UpcomingDetail {
  return { kind: 'upcoming', key: `up-${item.key}`, start: item.at.getTime(), item };
}

/** One mark for several upcoming items (the earliest first), keyed by its first item. */
export function upcomingClusterDetail(items: readonly UpcomingItem[]): UpcomingClusterDetail {
  const sorted = [...items].sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    kind: 'upcomingCluster',
    key: `up-cluster-${sorted[0].key}`,
    start: sorted[0].at.getTime(),
    items: sorted,
  };
}

/** Marks in time order (the order of the arrow keys), ties in the fixed kind order. */
export function sortDetails<T extends RhythmDetail>(details: readonly T[]): T[] {
  return [...details].sort(
    (a, b) => a.start - b.start || RANK[a.kind] - RANK[b.kind] || a.key.localeCompare(b.key),
  );
}

/** Ahead, open or past, from the nap sheet's guidance (wind-down and soon are both ahead). */
export function windowPhase(window: { earliest: string; latest: string }, now: Date): WindowPhase {
  const guidance = napGuidance(window, now).kind;
  if (guidance === 'open' || guidance === 'past') return guidance;
  return 'ahead';
}

/** The face of the "now" marker: asleep, a tired face during the heads-up, drowsy in the window. */
export function faceState(
  state: RhythmNow | undefined,
  phase: WindowPhase | null,
  overtired = false,
): FaceState {
  if (state?.kind === 'asleep') return 'asleep';
  if (state?.kind === 'awake') {
    if (overtired) return 'tired';
    if (phase === 'open') return 'drowsy';
  }
  return 'awake';
}

/**
 * Today's sleep marks exactly as the ring draws them: naps, nights and night wakings that started
 * by now and overlap the local day by more than an instant (a night from yesterday included, with
 * its real start).
 */
function sleepDetails(input: RhythmInput): SleepDetail[] {
  const frame = dayFrame(input.now);
  const nowMs = input.now.getTime();
  const sleepIds = typeIdsForKey(input.types, 'sleep');
  const out: SleepDetail[] = [];
  for (const event of input.events) {
    if (event.deletedAt !== null || !sleepIds.has(event.typeId)) continue;
    const start = Date.parse(event.startedAt);
    if (start > nowMs) continue;
    const waking = isSleepKind(event, 'night_waking');
    const session = sleepSessionKind(event);
    if (session === null && !waking) continue;
    const running = event.endedAt === null;
    const finish = running ? nowMs : Math.min(Date.parse(event.endedAt as string), nowMs);
    if (!(Math.min(finish, frame.end) > Math.max(start, frame.start))) continue;
    out.push({
      kind: 'sleep',
      key: event.id,
      sleepKind: waking ? 'waking' : (session ?? 'nap'),
      start,
      end: running ? null : finish,
      durationMs: effectiveDurationMs(event, input.now),
    });
  }
  return out;
}

function windowDetail(window: RhythmWindowInput, now: Date): WindowDetail {
  const start = Date.parse(window.earliest);
  const end = Date.parse(window.latest);
  const phase = windowPhase(window, now);
  const nowMs = now.getTime();
  const basis = readBasis(window.basis);
  return {
    kind: 'window',
    key: 'window',
    start,
    end,
    phase,
    untilMs: phase === 'ahead' ? start - nowMs : phase === 'open' ? end - nowMs : 0,
    basis: basis ? { kind: basis.kind, gapMinutes: basis.medianGapMinutes } : null,
  };
}

/** What comes next for an awake baby: the nap window, else the bedtime window still ahead. */
function nextUp(input: RhythmInput, phase: WindowPhase | null): NextUp | null {
  const state = input.state;
  const projection = input.projection;
  if (state?.kind === 'asleep') {
    return projection?.wake ? { kind: 'wake', at: projection.wake.at } : null;
  }
  if (input.window && phase === 'ahead') {
    return { kind: 'windowOpens', at: Date.parse(input.window.earliest) };
  }
  if (input.window && phase === 'open') {
    return { kind: 'windowCloses', at: Date.parse(input.window.latest) };
  }
  const projected = projection?.windows.find((w) => w.earliest > input.now.getTime());
  if (projected) return { kind: 'windowOpens', at: projected.earliest, estimate: true };
  const bed = input.bedTime;
  if (bed && Date.parse(bed.latest) > input.now.getTime()) {
    return { kind: 'bedtime', from: Date.parse(bed.earliest), to: Date.parse(bed.latest) };
  }
  return null;
}

/** Every mark of the chart with its details, in time order (the order of the arrow keys). */
function estimateDetails(input: RhythmInput): RhythmDetail[] {
  const out: RhythmDetail[] = [];
  const nowMs = input.now.getTime();
  const projection = input.projection;
  if (projection?.wake) {
    out.push({
      kind: 'wake',
      key: 'wake',
      start: projection.wake.at,
      from: projection.wake.from,
      napMinutes: projection.basis.napMinutes,
    });
  }
  // With a server window the first projected nap is the second upcoming one.
  const offset = input.window ? 1 : 0;
  if (projection) {
    for (const window of projection.windows) {
      if (!(window.latest > nowMs)) continue;
      out.push({
        kind: 'projected',
        key: `projected-${window.index}`,
        start: window.earliest,
        end: window.latest,
        first: offset === 0 && window.index === 1,
        upcoming: offset + window.index - 1,
        basis: projection.basis,
      });
    }
  }
  const bed = input.bedTime;
  if (bed && Date.parse(bed.latest) > nowMs && Date.parse(bed.earliest) < dayFrame(input.now).end) {
    out.push({
      kind: 'bedtime',
      key: 'bedtime',
      start: Date.parse(bed.earliest),
      end: Date.parse(bed.latest),
    });
  }
  return out;
}

export function rhythmDetails(input: RhythmInput): RhythmDetail[] {
  const phase = input.window ? windowPhase(input.window, input.now) : null;
  const state = input.state ?? { kind: 'unknown' };
  const details: RhythmDetail[] = [
    ...sleepDetails(input),
    ...(input.window ? [windowDetail(input.window, input.now)] : []),
    ...estimateDetails(input),
    {
      kind: 'now',
      key: 'now',
      start: input.now.getTime(),
      face: faceState(state, phase, input.overtired),
      state,
      next: nextUp(input, phase),
    },
  ];
  return sortDetails(details);
}

/** The details of the "now" marker alone (the face and its name). */
export function nowDetail(details: readonly RhythmDetail[]): NowDetail | undefined {
  return details.find((detail): detail is NowDetail => detail.kind === 'now');
}

export interface RhythmText {
  /** The first sentence, shown in bold in the detail strip. */
  title: string;
  /** Further sentences (status, basis, what is next). */
  lines: string[];
}

const SLEEP_KEYS = {
  night: ['now.rhythm.night', 'now.rhythm.nightRunning'],
  nap: ['now.rhythm.nap', 'now.rhythm.napRunning'],
  waking: ['now.rhythm.waking', 'now.rhythm.wakingRunning'],
} as const satisfies Record<SleepMarkKind, readonly [string, string]>;

const FACE_KEY = {
  awake: 'now.rhythm.faceAwake',
  drowsy: 'now.rhythm.faceDrowsy',
  asleep: 'now.rhythm.faceAsleep',
  tired: 'now.rhythm.faceTired',
} as const satisfies Record<FaceState, string>;

const FOR_KEY = {
  awake: 'now.rhythm.awakeFor',
  asleep: 'now.rhythm.asleepFor',
  waking: 'now.rhythm.wakingFor',
} as const;

function sleepText(detail: SleepDetail, t: TFunction): RhythmText {
  const [done, running] = SLEEP_KEYS[detail.sleepKind];
  const duration = formatDuration(detail.durationMs);
  if (detail.end === null) {
    return { title: t(running, { time: formatTime(detail.start), duration }), lines: [] };
  }
  return {
    title: t(done, {
      from: formatTime(detail.start),
      to: formatTime(detail.end),
      time: formatTime(detail.start),
      duration,
    }),
    lines: [],
  };
}

function windowText(detail: WindowDetail, t: TFunction): RhythmText {
  const lines = [
    detail.phase === 'ahead'
      ? t('now.rhythm.windowAhead', { duration: formatDuration(detail.untilMs) })
      : detail.phase === 'open'
        ? t('now.rhythm.windowOpen', { duration: formatDuration(detail.untilMs) })
        : t('now.rhythm.windowPast', { time: formatTime(detail.end) }),
  ];
  if (detail.basis) {
    const duration = formatDuration(detail.basis.gapMinutes * MINUTE_MS);
    lines.push(
      t(
        detail.basis.kind === 'AwakeWindow' ? 'now.rhythm.basisAwake' : 'now.rhythm.basisInterval',
        { duration },
      ),
    );
  }
  return {
    title: t('now.rhythm.window', { from: formatTime(detail.start), to: formatTime(detail.end) }),
    lines,
  };
}

function nextText(next: NextUp, t: TFunction): string {
  switch (next.kind) {
    case 'windowOpens':
      return t(next.estimate ? 'now.rhythm.nextWindowEstimate' : 'now.rhythm.nextWindow', {
        time: formatTime(next.at),
      });
    case 'windowCloses':
      return t('now.rhythm.nextWindowCloses', { time: formatTime(next.at) });
    case 'wake':
      return t('now.rhythm.nextWake', { time: formatTime(next.at) });
    case 'bedtime':
      return t('now.rhythm.nextBedtime', { from: formatTime(next.from), to: formatTime(next.to) });
  }
}

/** "Now, 15:21, awake": the name of the face marker. */
export function faceName(detail: NowDetail, t: TFunction): string {
  return t('now.rhythm.face', { time: formatTime(detail.start), state: t(FACE_KEY[detail.face]) });
}

function nowText(detail: NowDetail, t: TFunction): RhythmText {
  const lines: string[] = [];
  const { state } = detail;
  if (state.kind !== 'unknown') {
    lines.push(t(FOR_KEY[state.kind], { duration: formatDuration(state.minutes * MINUTE_MS) }));
  }
  if (detail.next) lines.push(nextText(detail.next, t));
  return { title: faceName(detail, t), lines };
}

function projectedText(detail: ProjectedDetail, t: TFunction): RhythmText {
  const range = { from: formatTime(detail.start), to: formatTime(detail.end) };
  const values = {
    gap: formatDuration(detail.basis.gapMinutes * MINUTE_MS),
    nap: formatDuration(detail.basis.napMinutes * MINUTE_MS),
  };
  return {
    title: t(detail.first ? 'now.rhythm.projectedNext' : 'now.rhythm.projectedLater', range),
    lines: [
      t(
        detail.basis.gapKind === 'awake'
          ? 'now.rhythm.projectedBasisAwake'
          : 'now.rhythm.projectedBasisInterval',
        values,
      ),
    ],
  };
}

/** A volume with its unit in the person's system, and the number alone (for the low end of a range). */
const ml = volumeText;
const mlNumber = volumeNumberText;
const range = (from: Date, to: Date) => ({ from: formatTime(from), to: formatTime(to) });

/** The sentences about the expected amount of a feed (never a number without its basis). */
function amountLines(item: UpcomingItem, basis: FeedBasis, t: TFunction): string[] {
  const amount = item.amountMl;
  const source = basis.amount;
  if (basis.method === 'breast') return [t('now.upcoming.mostlyNursing')];
  if (!amount || !source) return [];
  if (source.kind === 'ageNorm') {
    return [t('now.upcoming.amountNorm', { low: mlNumber(amount.low), high: ml(amount.high) })];
  }
  const typical = ml(amount.typical ?? amount.low);
  const spread = amount.low !== amount.high;
  const lines: string[] = [];
  if (source.kind === 'dayPart') {
    const part = dayPartPhrase(source.dayPart);
    lines.push(
      spread
        ? t('now.upcoming.amountPart', {
            ml: typical,
            part,
            low: mlNumber(amount.low),
            high: ml(amount.high),
          })
        : t('now.upcoming.amountPartExact', { ml: typical, part }),
    );
  } else {
    lines.push(
      spread
        ? t('now.upcoming.amountAll', {
            ml: typical,
            low: mlNumber(amount.low),
            high: ml(amount.high),
          })
        : t('now.upcoming.amountAllExact', { ml: typical }),
    );
  }
  const others = source.byPart.filter((p) => p.dayPart !== source.dayPart);
  if (others.length > 0) {
    lines.push(
      t('now.upcoming.amountOthers', {
        list: formatList(
          others.map((p) =>
            t('now.upcoming.amountOther', { ml: ml(p.typicalMl), part: dayPartPhrase(p.dayPart) }),
          ),
        ),
      }),
    );
  }
  lines.push(t('now.upcoming.amountBasis', { count: source.samples, days: source.days }));
  return lines;
}

function feedTimeLine(basis: FeedBasis, t: TFunction): string {
  const time = basis.time;
  switch (time.kind) {
    case 'prediction':
      return t('now.upcoming.feedPredicted', { count: time.samples });
    case 'ownGap':
      return time.dayPart
        ? t('now.upcoming.feedGapPart', {
            part: dayPartPhrase(time.dayPart),
            duration: formatDuration(time.gapMinutes * MINUTE_MS),
          })
        : t('now.upcoming.feedGap', { duration: formatDuration(time.gapMinutes * MINUTE_MS) });
    case 'serverGap':
      return t('now.upcoming.feedGap', { duration: formatDuration(time.gapMinutes * MINUTE_MS) });
    case 'ageNorm':
      return t('now.upcoming.feedGapNorm', {
        duration: formatDuration(time.gapMinutes * MINUTE_MS),
      });
  }
}

/** The sentences of one upcoming item (the strip, the marker's name and the "Next up" row). */
export function upcomingText(item: UpcomingItem, t: TFunction): RhythmText {
  const time = formatTime(item.at);
  const window =
    item.windowStart && item.windowEnd ? range(item.windowStart, item.windowEnd) : null;
  const low = item.confidence === 'low' ? [t('now.upcoming.lowConfidence')] : [];
  const basis = item.basis;
  switch (basis.kind) {
    case 'feed': {
      const bottle = basis.method === 'bottle';
      const title = basis.due
        ? t(bottle ? 'now.upcoming.bottleDue' : 'now.upcoming.feedDue')
        : t(bottle ? 'now.upcoming.bottle' : 'now.upcoming.feed', { time });
      return {
        title,
        lines: [
          ...(window ? [t('now.upcoming.window', window)] : []),
          ...amountLines(item, basis, t),
          ...(basis.partialFeed
            ? [
                t('now.upcoming.feedPartial', {
                  drunk: mlNumber(Math.round(basis.partialFeed.drunkMl)),
                  usual: ml(roundToStep(basis.partialFeed.usualMl)),
                }),
              ]
            : []),
          feedTimeLine(basis, t),
          ...low,
        ],
      };
    }
    case 'diaper': {
      const duration = formatDuration(basis.medianMinutes * MINUTE_MS);
      if (item.kind === 'diaperDirty' && window) {
        const usual =
          basis.signal === 'afterFeed'
            ? t('now.upcoming.dirtyAfterFeed', { duration })
            : basis.daily
              ? t('now.upcoming.dirtyDaily')
              : t('now.upcoming.dirtyGap', { duration });
        return { title: t('now.upcoming.dirty', window), lines: [usual, ...low] };
      }
      return {
        title: basis.due ? t('now.upcoming.wetDue') : t('now.upcoming.wet', { time }),
        lines: [
          ...(window ? [t('now.upcoming.window', window)] : []),
          t('now.upcoming.wetBasis', { duration }),
          ...low,
        ],
      };
    }
    case 'pattern': {
      const belly = item.kind === 'bellyPain';
      const to = item.windowEnd ? formatTime(item.windowEnd) : time;
      const title = basis.due
        ? t(belly ? 'now.upcoming.bellyNow' : 'now.upcoming.fussyNow', { to })
        : t(belly ? 'now.upcoming.belly' : 'now.upcoming.fussy', { time });
      return {
        title,
        lines: [...(window ? [t('now.upcoming.patternBasis', window)] : []), ...low],
      };
    }
    case 'medicine': {
      const name = basis.name.trim() || t('now.upcoming.medicineFallback');
      const lines: string[] = [];
      let title: string;
      if (basis.schedule === 'dayPart' && basis.dayPart) {
        title = t('now.upcoming.medicinePart', { name, part: dayPartPhrase(basis.dayPart) });
        if (window) lines.push(t('now.upcoming.medicineWindow', window));
        if (basis.reminderAt) {
          lines.push(t('now.upcoming.medicineReminder', { time: formatTime(basis.reminderAt) }));
        }
      } else {
        title = t('now.upcoming.medicineAt', { name, time });
        if (basis.schedule === 'interval' && basis.everyMinutes) {
          lines.push(
            t('now.upcoming.medicineEvery', {
              duration: formatDuration(basis.everyMinutes * MINUTE_MS),
            }),
          );
        }
      }
      lines.push(t('now.upcoming.fromPrescription'));
      return { title, lines };
    }
  }
}

/** The sentences of a cluster: how many, from when, then each item's first sentence. */
function clusterText(detail: UpcomingClusterDetail, t: TFunction): RhythmText {
  return {
    title: t('now.upcoming.cluster', {
      count: detail.items.length,
      time: formatTime(detail.start),
    }),
    lines: detail.items.map((item) => upcomingText(item, t).title),
  };
}

/** The sentences of one mark in the active language. */
export function rhythmDetailText(detail: RhythmDetail, t: TFunction): RhythmText {
  switch (detail.kind) {
    case 'upcoming':
      return upcomingText(detail.item, t);
    case 'upcomingCluster':
      return clusterText(detail, t);
    case 'sleep':
      return sleepText(detail, t);
    case 'window':
      return windowText(detail, t);
    case 'now':
      return nowText(detail, t);
    case 'projected':
      return projectedText(detail, t);
    case 'wake':
      return {
        title: t('now.rhythm.wake', { time: formatTime(detail.start) }),
        lines: [
          t('now.rhythm.wakeBasis', { duration: formatDuration(detail.napMinutes * MINUTE_MS) }),
        ],
      };
    case 'bedtime':
      return {
        title: t('now.rhythm.bedtime', {
          from: formatTime(detail.start),
          to: formatTime(detail.end),
        }),
        lines: [],
      };
  }
}

/** The whole detail as one text (accessible name, live region): the sentences, each closed. */
export function rhythmLabel(text: RhythmText): string {
  return [text.title, ...text.lines]
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');
}
