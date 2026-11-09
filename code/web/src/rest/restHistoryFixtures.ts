import type { RestGroup, RestHistory, RestHistoryNight, RestPart } from './restApi';

/*
 * Synthetic rest histories for the tests and the `/dev/rest-history` preview: invented nights in
 * the viewer's zone, no real person. The summaries are computed from the nights the way the
 * contract describes them (docs/design/41-caregiver-rest.md section 12), so a preview reads true.
 */

export const HISTORY_SCENARIOS = [
  'ok',
  'long',
  'belowMinimum',
  'notEnoughLog',
  'disabled',
] as const;
export type HistoryScenario = (typeof HISTORY_SCENARIOS)[number];

const LAST_NIGHT = '2026-01-10';
const MINIMUM = 4;
const NIGHT_START_HOUR = 19;

/** [start, end] in hours from the night's local midnight (25.5 = 01:30 the next day), low? */
type PartSpec = [number, number, boolean?];

const PATTERNS: PartSpec[][] = [
  [
    [21 + 20 / 60, 25 + 50 / 60],
    [27, 30.5],
  ],
  [[21 + 40 / 60, 30 + 10 / 60]],
  [
    [22, 26 + 15 / 60],
    [26 + 55 / 60, 29 + 40 / 60],
  ],
  [[21 + 20 / 60, 30.5, true]],
  [
    [22 + 10 / 60, 26 + 20 / 60],
    [27 + 10 / 60, 31],
  ],
  [
    [21 + 50 / 60, 24 + 40 / 60],
    [25 + 30 / 60, 28 + 45 / 60, true],
  ],
];

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function instant(date: string, hours: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const whole = Math.floor(hours);
  return new Date(y, m - 1, d, whole, Math.round((hours - whole) * 60)).toISOString();
}

function nightOf(date: string, index: number, total: number): RestHistoryNight {
  const fromEnd = total - 1 - index;
  if (fromEnd % 7 === 4) {
    return {
      night: date,
      status: 'notEnoughLog',
      parts: [],
      confidence: null,
      workOverlap: false,
      counted: false,
    };
  }
  const parts: RestPart[] = PATTERNS[index % PATTERNS.length].map(([from, to, low]) => ({
    start: instant(date, from),
    end: instant(date, to),
    startSource: 'babyLog',
    endSource: low ? 'babyFinalWake' : 'ownEvent',
    confidence: low ? 'low' : 'normal',
  }));
  const workOverlap = fromEnd % 7 === 2;
  return {
    night: date,
    status: 'ok',
    parts,
    confidence: parts.some((p) => p.confidence === 'low') ? 'low' : 'normal',
    workOverlap,
    counted: !workOverlap,
  };
}

const minutesOf = (night: RestHistoryNight) =>
  night.parts.reduce((sum, p) => sum + (Date.parse(p.end!) - Date.parse(p.start)) / 60_000, 0);

function percentile(sorted: number[], p: number): number {
  const rank = p * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

const round5 = (value: number) => Math.round(value / 5) * 5;

function group(nights: RestHistoryNight[]): RestGroup {
  const minutes = nights.map(minutesOf).sort((a, b) => a - b);
  return {
    countedNights: minutes.length,
    restedMinutes:
      minutes.length >= MINIMUM
        ? {
            p25: round5(percentile(minutes, 0.25)),
            median: round5(percentile(minutes, 0.5)),
            p75: round5(percentile(minutes, 0.75)),
          }
        : null,
  };
}

/** ISO weekday of a calendar date: Saturday and Sunday nights are weekend nights. */
const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

function typicalHours(counted: RestHistoryNight[]) {
  if (counted.length < MINIMUM) return [];
  return Array.from({ length: 24 }, (_, offset) => {
    const hour = NIGHT_START_HOUR + offset;
    const asleep = counted.filter((night) => {
      const from = Date.parse(instant(night.night, hour));
      const to = from + 3_600_000;
      const covered = night.parts.reduce((sum, p) => {
        const overlap = Math.min(to, Date.parse(p.end!)) - Math.max(from, Date.parse(p.start));
        return sum + Math.max(0, overlap);
      }, 0);
      return covered >= 30 * 60_000;
    }).length;
    return { hour: hour % 24, share: Math.round((asleep / counted.length) * 100) / 100 };
  });
}

function build(total: number, keep: (night: RestHistoryNight) => RestHistoryNight): RestHistory {
  const nights = Array.from({ length: total }, (_, index) =>
    keep(nightOf(shift(LAST_NIGHT, index - (total - 1)), index, total)),
  );
  const counted = nights.filter((n) => n.counted);
  return {
    status: 'ok',
    nightsRequested: total,
    nights,
    weekdayWeekend: {
      weekday: group(counted.filter((n) => !isWeekend(n.night))),
      weekend: group(counted.filter((n) => isWeekend(n.night))),
    },
    typicalNight: { countedNights: counted.length, hours: typicalHours(counted) },
    constants: { minimumNights: MINIMUM },
  };
}

const EMPTY_GROUP: RestGroup = { countedNights: 0, restedMinutes: null };

export function restHistoryFixture(scenario: HistoryScenario): RestHistory {
  switch (scenario) {
    case 'ok':
      return build(14, (n) => n);
    case 'long':
      return build(28, (n) => n);
    case 'belowMinimum':
      return build(5, (n) => n);
    case 'notEnoughLog':
      return build(14, (n) => ({
        ...n,
        status: 'notEnoughLog',
        parts: [],
        confidence: null,
        workOverlap: false,
        counted: false,
      }));
    case 'disabled':
      return {
        status: 'disabled',
        nightsRequested: 14,
        nights: [],
        weekdayWeekend: { weekday: EMPTY_GROUP, weekend: EMPTY_GROUP },
        typicalNight: { countedNights: 0, hours: [] },
        constants: { minimumNights: MINIMUM },
      };
  }
}
