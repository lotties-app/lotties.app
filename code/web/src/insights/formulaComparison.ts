import type { BabyEvent, EventType, Formula } from '../db/models';
import { formulaIdOf, FORMULA_NAME_KEY } from '../formulas/formulaModel';
import { HOUR_MS, payloadNumber, payloadString, typeIdsForKey } from '../now/eventFacts';
import { getOwn } from '../util/ownProperty';
import { completedDaysWithData, dayKeyOf, lastDays, mean, type LocalDay } from './days';

/*
 * The Formulas insight (docs/design/14-formulas.md), pure: what was logged on the days each formula
 * was given, side by side. A formula's period is the local days with at least one bottle naming
 * it (a day with bottles of two formulas counts for both, each with its own bottles). Over its
 * finished days (today only when it is the only one) it averages per day: bottles, bottle ml,
 * ml per kg (with a weight logged within 14 days of the day), belly pains, belly pains starting
 * within 2 hours after one of its bottles, fussy spells and dirty diapers (a kind the family never
 * logged in the look-back has no average). It compares what was logged; it never says a formula
 * causes anything.
 */

/** A formula shows once it was given on this many days ... */
export const FORMULA_MIN_DAYS = 7;
/** ... and in this many bottles. */
export const FORMULA_MIN_BOTTLES = 20;
/** A belly pain starting this long after a bottle (its end) counts as "after a bottle". */
export const AFTER_BOTTLE_MS = 2 * HOUR_MS;
/** A weight counts for a day when it was measured this many days before or after it. */
export const WEIGHT_WINDOW_DAYS = 14;
/** The days looked at, today included. */
export const FORMULA_LOOK_BACK_DAYS = 30;

/** A measured weight (`yyyy-mm-dd`, kg). */
export interface WeightPoint {
  date: string;
  kg: number;
}

/** One day of a formula's period. */
export interface FormulaDay {
  key: string;
  start: Date;
  /** Bottles naming the formula. */
  bottles: number;
  /** Sum of their amounts (ml); `null` when none had an amount. */
  ml: number | null;
  /** Belly pain episodes that day (any). */
  bellyPains: number;
  /** Belly pains starting within 2 h after one of the formula's bottles of that day. */
  bellyPainsAfterBottle: number;
  /** Fussy / crying spells that day. */
  fussy: number;
  /** Dirty diapers that day (`DIRTY` or `MIXED`). */
  dirty: number;
  /** The weight used for ml per kg; `null` without one within 14 days. */
  kg: number | null;
}

export interface FormulaMetrics {
  bottlesPerDay: number | null;
  mlPerDay: number | null;
  mlPerKgPerDay: number | null;
  bellyPainsPerDay: number | null;
  bellyPainsAfterBottlePerDay: number | null;
  fussyPerDay: number | null;
  dirtyPerDay: number | null;
}

export type FormulaMetric = keyof FormulaMetrics;

export const FORMULA_METRICS: readonly FormulaMetric[] = [
  'bottlesPerDay',
  'mlPerDay',
  'mlPerKgPerDay',
  'bellyPainsPerDay',
  'bellyPainsAfterBottlePerDay',
  'fussyPerDay',
  'dirtyPerDay',
];

export interface FormulaPeriod {
  formulaId: string;
  /** The formula's name on the device, else the name the newest bottle recorded. */
  name: string;
  /** Days with a bottle of it, oldest first. */
  days: FormulaDay[];
  /** Bottles naming it in the look-back. */
  bottles: number;
  first: Date;
  last: Date;
  /** At least 7 days and 20 bottles: shown in the card. */
  qualifies: boolean;
  /** Averages over its finished days. */
  metrics: FormulaMetrics;
  /** Finished days the averages are taken over. */
  averagedDays: number;
}

export type FormulaView =
  /** No bottle names a formula. */
  | 'none'
  /** Formulas were used, none enough yet: readiness rows. */
  | 'collecting'
  /** One formula qualifies. */
  | 'single'
  /** Two or more qualify: side by side. */
  | 'compare';

export interface FormulaComparison {
  /** Every formula given in the look-back, most recently given first. */
  periods: FormulaPeriod[];
  qualified: FormulaPeriod[];
  view: FormulaView;
}

export interface FormulaComparisonInput {
  events: readonly BabyEvent[];
  types: readonly EventType[];
  formulas: readonly Formula[];
  weights: readonly WeightPoint[];
  now: Date;
}

interface Bottle {
  formulaId: string;
  start: number;
  end: number;
  dayKey: string;
  ml: number | null;
  snapshot: string | null;
}

const live = (events: readonly BabyEvent[], nowIso: string, from: string) =>
  events.filter((e) => e.deletedAt === null && e.startedAt >= from && e.startedAt <= nowIso);

function bottlesOf(events: readonly BabyEvent[], types: readonly EventType[]): Bottle[] {
  const feeding = typeIdsForKey(types, 'feeding');
  return events.flatMap((e) => {
    const formulaId = formulaIdOf(e.payload);
    if (!feeding.has(e.typeId) || !formulaId || payloadString(e, 'method') !== 'bottle') return [];
    const ml = payloadNumber(e, 'amount_ml');
    const snapshot = getOwn(e.payload, FORMULA_NAME_KEY);
    const start = Date.parse(e.startedAt);
    return [
      {
        formulaId,
        start,
        end: e.endedAt ? Math.max(start, Date.parse(e.endedAt)) : start,
        dayKey: dayKeyOf(e.startedAt),
        ml: ml !== undefined && ml > 0 ? ml : null,
        snapshot: typeof snapshot === 'string' && snapshot.trim() !== '' ? snapshot : null,
      },
    ];
  });
}

/** How many of the events of the given types started on each local day. */
function dayCounts(events: readonly BabyEvent[], ids: ReadonlySet<string>) {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (!ids.has(e.typeId)) continue;
    const key = dayKeyOf(e.startedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function dirtyCounts(events: readonly BabyEvent[], types: readonly EventType[]) {
  const ids = typeIdsForKey(types, 'diaper');
  const dirty = events.filter((e) => {
    const content = payloadString(e, 'content')?.toUpperCase();
    return content === 'DIRTY' || content === 'MIXED';
  });
  return dayCounts(dirty, ids);
}

/** Calendar days between two `yyyy-mm-dd` keys (`b - a`), whatever the zone. */
function dayDistance(a: string, b: string): number {
  const stamp = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((stamp(b) - stamp(a)) / (24 * HOUR_MS));
}

/**
 * The weight for a day: the nearest one measured on or before it within 14 days, else the nearest
 * one after it within 14 days; `null` without either.
 */
export function weightForDay(weights: readonly WeightPoint[], dayKey: string): number | null {
  let before: { gap: number; kg: number } | null = null;
  let after: { gap: number; kg: number } | null = null;
  for (const weight of weights) {
    if (!(weight.kg > 0)) continue;
    const gap = dayDistance(weight.date, dayKey);
    if (gap >= 0 && gap <= WEIGHT_WINDOW_DAYS && (!before || gap < before.gap)) {
      before = { gap, kg: weight.kg };
    }
    if (gap < 0 && -gap <= WEIGHT_WINDOW_DAYS && (!after || -gap < after.gap)) {
      after = { gap: -gap, kg: weight.kg };
    }
  }
  return before?.kg ?? after?.kg ?? null;
}

/**
 * Belly pains starting within 2 h after a bottle of the formula, per day of the bottle: an episode
 * counts once, on the day of the newest such bottle (a bottle at 23:30 and a pain at 00:30 count on
 * the bottle's day). "After" runs from the bottle's start to 2 h after its end.
 */
function painsAfterBottles(pains: readonly BabyEvent[], bottles: readonly Bottle[]) {
  const counts = new Map<string, number>();
  for (const pain of pains) {
    const at = Date.parse(pain.startedAt);
    let latest: Bottle | null = null;
    for (const bottle of bottles) {
      const within = bottle.start <= at && at <= bottle.end + AFTER_BOTTLE_MS;
      if (within && (!latest || bottle.start > latest.start)) latest = bottle;
    }
    if (latest) counts.set(latest.dayKey, (counts.get(latest.dayKey) ?? 0) + 1);
  }
  return counts;
}

/** The average of a count, or `null` when that kind was not logged at all in the look-back. */
const countMean = (logged: boolean, values: readonly number[]) => (logged ? mean(values) : null);

function metricsOf(days: readonly FormulaDay[], logged: Logged): FormulaMetrics {
  const withMl = days.filter((d) => d.ml !== null);
  const withKg = withMl.filter((d) => d.kg !== null);
  return {
    bottlesPerDay: mean(days.map((d) => d.bottles)),
    mlPerDay: mean(withMl.map((d) => d.ml!)),
    mlPerKgPerDay: mean(withKg.map((d) => d.ml! / d.kg!)),
    bellyPainsPerDay: countMean(
      logged.bellyPain,
      days.map((d) => d.bellyPains),
    ),
    bellyPainsAfterBottlePerDay: countMean(
      logged.bellyPain,
      days.map((d) => d.bellyPainsAfterBottle),
    ),
    fussyPerDay: countMean(
      logged.fussy,
      days.map((d) => d.fussy),
    ),
    dirtyPerDay: countMean(
      logged.diaper,
      days.map((d) => d.dirty),
    ),
  };
}

interface DayCounts {
  bellyPains: ReadonlyMap<string, number>;
  fussy: ReadonlyMap<string, number>;
  dirty: ReadonlyMap<string, number>;
}

/**
 * Which kinds the family logs at all in the look-back: a kind never logged has no average (a
 * family that does not log fussy spells is not told "0 fussy spells a day").
 */
interface Logged {
  bellyPain: boolean;
  fussy: boolean;
  diaper: boolean;
}

interface PeriodContext {
  days: ReadonlyMap<string, LocalDay>;
  logged: Logged;
  formulas: readonly Formula[];
  input: FormulaComparisonInput;
  todayKey: string;
}

function periodOf(
  formulaId: string,
  bottles: readonly Bottle[],
  pains: readonly BabyEvent[],
  counts: DayCounts,
  context: PeriodContext,
): FormulaPeriod {
  const after = painsAfterBottles(pains, bottles);
  const keys = [...new Set(bottles.map((b) => b.dayKey))].filter((key) => context.days.has(key));
  const days: FormulaDay[] = keys.sort().map((key) => {
    const own = bottles.filter((b) => b.dayKey === key);
    const amounts = own.map((b) => b.ml).filter((ml): ml is number => ml !== null);
    return {
      key,
      start: context.days.get(key)!.start,
      bottles: own.length,
      ml: amounts.length > 0 ? amounts.reduce((sum, ml) => sum + ml, 0) : null,
      bellyPains: counts.bellyPains.get(key) ?? 0,
      bellyPainsAfterBottle: after.get(key) ?? 0,
      fussy: counts.fussy.get(key) ?? 0,
      dirty: counts.dirty.get(key) ?? 0,
      kg: weightForDay(context.input.weights, key),
    };
  });
  const finished = completedDaysWithData(days, () => true, context.todayKey);
  const newest = [...bottles].sort((a, b) => b.start - a.start);
  const name =
    context.formulas.find((f) => f.id === formulaId)?.name ??
    newest.find((b) => b.snapshot)?.snapshot ??
    '';
  const total = days.reduce((sum, d) => sum + d.bottles, 0);
  return {
    formulaId,
    name,
    days,
    bottles: total,
    first: days[0]?.start ?? new Date(context.input.now),
    last: days[days.length - 1]?.start ?? new Date(context.input.now),
    qualifies: days.length >= FORMULA_MIN_DAYS && total >= FORMULA_MIN_BOTTLES,
    metrics: metricsOf(finished, context.logged),
    averagedDays: finished.length,
  };
}

function viewOf(
  periods: readonly FormulaPeriod[],
  qualified: readonly FormulaPeriod[],
): FormulaView {
  if (qualified.length >= 2) return 'compare';
  if (qualified.length === 1) return 'single';
  return periods.length > 0 ? 'collecting' : 'none';
}

/** The formula periods of the last 30 local days and which of them show (see the file comment). */
export function compareFormulas(input: FormulaComparisonInput): FormulaComparison {
  const window = lastDays(input.now, FORMULA_LOOK_BACK_DAYS);
  const days = new Map(window.map((day) => [day.key, day]));
  const todayKey = window[window.length - 1].key;
  const events = live(input.events, input.now.toISOString(), window[0].start.toISOString());
  const bottles = bottlesOf(events, input.types).filter((b) => days.has(b.dayKey));
  const pains = events.filter((e) => typeIdsForKey(input.types, 'belly_pain').has(e.typeId));
  const counts: DayCounts = {
    bellyPains: dayCounts(pains, typeIdsForKey(input.types, 'belly_pain')),
    fussy: dayCounts(events, typeIdsForKey(input.types, 'fussy')),
    dirty: dirtyCounts(events, input.types),
  };
  const has = (key: string) => {
    const ids = typeIdsForKey(input.types, key);
    return events.some((e) => ids.has(e.typeId));
  };
  const logged: Logged = {
    bellyPain: pains.length > 0,
    fussy: has('fussy'),
    diaper: has('diaper'),
  };
  const context: PeriodContext = { days, logged, formulas: input.formulas, input, todayKey };
  const ids = [...new Set(bottles.map((b) => b.formulaId))];
  const periods = ids
    .map((id) =>
      periodOf(
        id,
        bottles.filter((b) => b.formulaId === id),
        pains,
        counts,
        context,
      ),
    )
    .sort((a, b) => b.last.getTime() - a.last.getTime() || a.name.localeCompare(b.name));
  const qualified = periods.filter((p) => p.qualifies);
  return { periods, qualified, view: viewOf(periods, qualified) };
}

/** How far a formula is from showing: days of use and bottles, as the readiness rows show them. */
export interface FormulaReadiness {
  formulaId: string;
  name: string;
  days: number;
  bottles: number;
  /** Days of use / days needed, 0 to 1. */
  progress: number;
  /** Days of use still missing (0 once there are enough). */
  daysLeft: number;
  /** Bottles still missing (0 once there are enough). */
  bottlesLeft: number;
}

export function formulaReadiness(period: FormulaPeriod): FormulaReadiness {
  const days = period.days.length;
  return {
    formulaId: period.formulaId,
    name: period.name,
    days,
    bottles: period.bottles,
    progress: Math.min(1, days / FORMULA_MIN_DAYS),
    daysLeft: Math.max(0, FORMULA_MIN_DAYS - days),
    bottlesLeft: Math.max(0, FORMULA_MIN_BOTTLES - period.bottles),
  };
}
