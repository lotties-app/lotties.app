import type { TFunction } from 'i18next';
import type { BabyEvent, EventType } from '../db/models';
import { formatDuration, formatTime } from '../i18n/format';
import { readBasis } from '../predictions/predictionModel';
import { effectiveDurationMs } from '../timers/pauseMath';
import { MINUTE_MS, isSleepKind, sleepSessionKind, typeIdsForKey } from './eventFacts';
import { napGuidance } from './napGuidance';
import type { NapProjection } from './napProjection';
import { dayFrame } from './ringGeometry';

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

export type RhythmDetail =
  SleepDetail | WindowDetail | NowDetail | ProjectedDetail | WakeDetail | BedtimeDetail;

/** Order of marks that start at the same instant: sleep, the windows, now, the estimates. */
const RANK: Record<RhythmDetail['kind'], number> = {
  sleep: 0,
  window: 1,
  now: 2,
  wake: 3,
  projected: 4,
  bedtime: 5,
};

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
  return details.sort(
    (a, b) => a.start - b.start || RANK[a.kind] - RANK[b.kind] || a.key.localeCompare(b.key),
  );
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

/** The sentences of one mark in the active language. */
export function rhythmDetailText(detail: RhythmDetail, t: TFunction): RhythmText {
  switch (detail.kind) {
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
