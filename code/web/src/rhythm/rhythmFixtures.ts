/*
 * Synthetic rhythm answers (wire shape of docs/design/48-baby-rhythm.md section 6) for the tests
 * and the `/dev/rhythm` preview: invented numbers for an invented baby, no real log.
 */

export const RHYTHM_SCENARIOS = ['ok', 'partial', 'empty', 'varies'] as const;
export type RhythmScenario = (typeof RHYTHM_SCENARIOS)[number];

export const RHYTHM_RULE = {
  lookBackDays: 28,
  eveningDayStartsAt: '04:00',
  minimumNights: 5,
  minimumDays: 5,
  minimumFeedGaps: 10,
  maximumClockSpreadMinutes: 90,
  minimumNightMinutes: 180,
  maximumNightMinutes: 960,
  maximumFeedGapMinutes: 480,
  eveningFeedWindowMinutes: 240,
  minimumGroupNights: 7,
  minimumDifferenceMinutes: 20,
};

const NONE = { medianWithMinutes: null, medianWithoutMinutes: null, differenceMinutes: null };

function outcome(
  kind: string,
  status: string,
  nightsWith: number,
  nightsWithout: number,
  values: { with: number; without: number } | null = null,
  spreadMinutes: number | null = 15,
) {
  return {
    outcome: kind,
    status,
    nightsWith,
    nightsWithout,
    ...(values
      ? {
          medianWithMinutes: values.with,
          medianWithoutMinutes: values.without,
          differenceMinutes: values.with - values.without,
        }
      : NONE),
    spreadMinutes,
  };
}

const base = {
  babyId: '6f1c2a52-0000-4000-8000-000000000001',
  generatedAt: '2026-01-29T15:00:00+00:00',
  timeZone: 'America/Sao_Paulo',
  firstDay: '2026-01-01',
  lastDay: '2026-01-28',
  rule: RHYTHM_RULE,
};

const notEnoughClock = (nights: number) => ({
  status: 'not_enough_data',
  usual: null,
  spreadMinutes: null,
  nights,
});
const notEnoughRange = (count: number) => ({
  status: 'not_enough_data',
  count,
  p25Minutes: null,
  medianMinutes: null,
  p75Minutes: null,
});

function ok() {
  return {
    ...base,
    nights: 26,
    bedTime: { status: 'ok', usual: '19:45', spreadMinutes: 18, nights: 26 },
    wakeUp: { status: 'ok', usual: '06:35', spreadMinutes: 22, nights: 26 },
    nightLength: { status: 'ok', count: 26, p25Minutes: 600, medianMinutes: 625, p75Minutes: 645 },
    longestStretch: {
      status: 'ok',
      count: 26,
      p25Minutes: 230,
      medianMinutes: 280,
      p75Minutes: 330,
    },
    firstStretch: { status: 'ok', count: 26, p25Minutes: 200, medianMinutes: 240, p75Minutes: 300 },
    naps: {
      status: 'ok',
      count: 24,
      p25: 3,
      median: 3,
      p75: 3.5,
      usualStarts: [
        {
          usual: '09:05',
          windowStart: '08:35',
          windowEnd: '09:35',
          spreadMinutes: 12,
          days: 12,
          eventDays: 13,
        },
        {
          usual: '12:40',
          windowStart: '12:10',
          windowEnd: '13:10',
          spreadMinutes: 16,
          days: 11,
          eventDays: 13,
        },
        {
          usual: '16:15',
          windowStart: '15:45',
          windowEnd: '16:45',
          spreadMinutes: 20,
          days: 9,
          eventDays: 13,
        },
      ],
    },
    feeds: {
      status: 'ok',
      count: 27,
      p25: 7,
      median: 8,
      p75: 9,
      gap: { status: 'ok', count: 205, p25Minutes: 150, medianMinutes: 170, p75Minutes: 195 },
    },
    associations: [
      {
        factor: 'evening_feeds',
        threshold: 2,
        outcomes: [
          outcome('night_length', 'ok', 12, 10, { with: 640, without: 600 }),
          outcome('longest_stretch', 'no_clear_difference', 12, 10, null, 35),
          outcome('first_stretch', 'no_clear_difference', 12, 10, null, 30),
        ],
      },
      {
        factor: 'dirty_diaper_day',
        threshold: null,
        outcomes: [
          outcome('night_length', 'no_clear_difference', 15, 9),
          outcome('longest_stretch', 'ok', 15, 9, { with: 255, without: 290 }, 25),
          outcome('first_stretch', 'no_clear_difference', 15, 9, null, 28),
        ],
      },
    ],
  };
}

/** A baby with two weeks of logging, sparse feeds and too few nights to compare. */
function partial() {
  const answer = ok();
  return {
    ...answer,
    nights: 9,
    bedTime: { status: 'ok', usual: '20:05', spreadMinutes: 25, nights: 9 },
    wakeUp: { status: 'ok', usual: '06:50', spreadMinutes: 30, nights: 9 },
    nightLength: { status: 'ok', count: 9, p25Minutes: 585, medianMinutes: 610, p75Minutes: 640 },
    longestStretch: {
      status: 'ok',
      count: 9,
      p25Minutes: 180,
      medianMinutes: 215,
      p75Minutes: 250,
    },
    firstStretch: notEnoughRange(3),
    naps: {
      status: 'not_enough_data',
      count: 3,
      p25: null,
      median: null,
      p75: null,
      usualStarts: [],
    },
    feeds: {
      status: 'ok',
      count: 8,
      p25: 6,
      median: 7,
      p75: 8,
      gap: notEnoughRange(6),
    },
    associations: [
      {
        factor: 'evening_feeds',
        threshold: 2,
        outcomes: ['night_length', 'longest_stretch', 'first_stretch'].map((k) =>
          outcome(k, 'not_enough_data', 5, 4),
        ),
      },
      {
        factor: 'dirty_diaper_day',
        threshold: null,
        outcomes: ['night_length', 'longest_stretch', 'first_stretch'].map((k) =>
          outcome(k, 'not_enough_data', 6, 1),
        ),
      },
    ],
  };
}

/** Nothing logged yet. */
function empty() {
  return {
    ...base,
    nights: 0,
    bedTime: notEnoughClock(0),
    wakeUp: notEnoughClock(0),
    nightLength: notEnoughRange(0),
    longestStretch: notEnoughRange(0),
    firstStretch: notEnoughRange(0),
    naps: {
      status: 'not_enough_data',
      count: 0,
      p25: null,
      median: null,
      p75: null,
      usualStarts: [],
    },
    feeds: {
      status: 'not_enough_data',
      count: 0,
      p25: null,
      median: null,
      p75: null,
      gap: notEnoughRange(0),
    },
    associations: [
      {
        factor: 'evening_feeds',
        threshold: null,
        outcomes: ['night_length', 'longest_stretch', 'first_stretch'].map((k) =>
          outcome(k, 'not_enough_data', 0, 0, null, null),
        ),
      },
      {
        factor: 'dirty_diaper_day',
        threshold: null,
        outcomes: ['night_length', 'longest_stretch', 'first_stretch'].map((k) =>
          outcome(k, 'not_enough_data', 0, 0, null, null),
        ),
      },
    ],
  };
}

/** Bed time and wake-up spread too widely; the comparisons found no clear difference. */
function varies() {
  const answer = ok();
  return {
    ...answer,
    bedTime: { status: 'varies', usual: null, spreadMinutes: 104, nights: 26 },
    wakeUp: { status: 'varies', usual: null, spreadMinutes: 95, nights: 26 },
    naps: { ...answer.naps, usualStarts: [] },
    associations: answer.associations.map((a) => ({
      ...a,
      outcomes: a.outcomes.map((o) => ({ ...o, status: 'no_clear_difference', ...NONE })),
    })),
  };
}

export function rhythmFixture(scenario: RhythmScenario): unknown {
  switch (scenario) {
    case 'ok':
      return ok();
    case 'partial':
      return partial();
    case 'empty':
      return empty();
    case 'varies':
      return varies();
  }
}
