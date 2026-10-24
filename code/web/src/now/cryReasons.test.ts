import { describe, expect, it } from 'vitest';
import type { AgeNormSet } from '../ageNorms/ageNorms';
import type { BabyEvent, EventPayload, EventType } from '../db/models';
import { SHIPPED_AGE_NORMS } from '../test/ageNorms';
import type {
  DiaperPredictionsDto,
  PredictionsDto,
  TimeOfDayPatternDto,
  WakeWindowDto,
} from '../sync/contract';
import { eventType } from '../presets/presetFixtures';
import {
  BELLY_MASSAGE_TYPE,
  DIAPER_TYPE,
  FEEDING_TYPE,
  FUSSY_TYPE,
  SLEEP_TYPE,
} from '../test/builtInTypes';
import { BABY_ID } from '../test/fakeApi';
import {
  CRY_CAUSES,
  CRY_RED_FLAGS,
  CRY_WEIGHTS,
  cryAgeBand,
  cryOutcomeHistory,
  milkPopulationOf,
  normFeedGapMinutes,
  outcomeCause,
  rankCryReasons,
  type CryCause,
  type CryReasonResult,
} from './cryReasons';

/*
 * "Why is she crying?" ranking (docs/design/27-cry-reasons.md): pure, offline, language-free.
 * The clock is pinned by passing `now` (local times on 2026-10-21), as the other Now logic tests.
 */

const BURP_TYPE = eventType({ id: 't-burp', key: 'burp', name: 'Burp' });
const TYPES: EventType[] = [
  FEEDING_TYPE,
  SLEEP_TYPE,
  DIAPER_TYPE,
  FUSSY_TYPE,
  BELLY_MASSAGE_TYPE,
  BURP_TYPE,
];

/** Local time on 2026-10-21 (`day` shifts the date). */
const at = (hour: number, minute = 0, day = 21) => new Date(2026, 9, day, hour, minute);
const NOON = at(14, 0);

/** Birth dates for each age band on 2026-10-21. */
const NEWBORN = '2026-09-30'; // 3 weeks
const TWO_MONTHS = '2026-08-21';
const FOUR_MONTHS = '2026-06-21';
const EIGHT_MONTHS = '2026-02-21';

let counter = 0;
function ev(
  type: EventType,
  start: Date,
  end: Date | null = start,
  payload: EventPayload = {},
  extra: Partial<BabyEvent> = {},
): BabyEvent {
  counter += 1;
  return {
    id: `e-${String(counter).padStart(4, '0')}`,
    babyId: BABY_ID,
    typeId: type.id,
    startedAt: start.toISOString(),
    endedAt: end?.toISOString() ?? null,
    payload,
    notes: null,
    createdBy: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
    ...extra,
  };
}

/** `minutes` before `now`. */
const ago = (minutes: number, now = NOON) => new Date(now.getTime() - minutes * 60_000);

const feed = (startAgo: number, endAgo: number | null, payload: EventPayload = {}, now = NOON) =>
  ev(FEEDING_TYPE, ago(startAgo, now), endAgo === null ? null : ago(endAgo, now), {
    method: 'bottle',
    ...payload,
  });
const sleep = (startAgo: number, endAgo: number | null, kind = 'nap', now = NOON) =>
  ev(SLEEP_TYPE, ago(startAgo, now), endAgo === null ? null : ago(endAgo, now), { kind });
const diaper = (minutesAgo: number, content = 'WET', now = NOON) =>
  ev(DIAPER_TYPE, ago(minutesAgo, now), ago(minutesAgo, now), { content });
const massage = (startAgo: number, endAgo: number | null, now = NOON) =>
  ev(BELLY_MASSAGE_TYPE, ago(startAgo, now), endAgo === null ? null : ago(endAgo, now));

function predictions(over: Partial<PredictionsDto> = {}): PredictionsDto {
  return {
    babyId: BABY_ID,
    generatedAt: NOON.toISOString(),
    predictions: [],
    insufficientData: [],
    ...over,
  };
}

function wakeWindow(limitMinutes: number): WakeWindowDto {
  return {
    limitMinutes,
    sampleCount: 8,
    awakeSince: null,
    awakeMinutes: null,
    timeZone: 'America/Sao_Paulo',
    stretches: [],
    rule: {
      lookBackDays: 14,
      dayStartsAt: '05:00',
      dayEndsAt: '18:00',
      percentile: 75,
      minimumStretches: 5,
      leadMinutes: 15,
      graceMinutes: 30,
    },
  };
}

function pattern(typeKey: string, windowStart: string, typicalClock: string): TimeOfDayPatternDto {
  return {
    typeKey,
    typicalClock,
    windowStart,
    windowEnd: '00:00',
    windowMinutes: 60,
    spreadMinutes: 10,
    confidence: 'Medium',
    eventDayCount: 6,
    recentDayCount: 5,
    timeZone: 'America/Sao_Paulo',
    days: [],
    rule: {
      lookBackDays: 14,
      recentDays: 7,
      minimumRecentDays: 4,
      maximumSpreadMinutes: 45,
      minimumCoveragePercent: 60,
      leadMinutes: 45,
    },
  };
}

const DIAPER_RULE: DiaperPredictionsDto['rule'] = {
  wetLookBackDays: 7,
  minimumWetEvents: 8,
  dirtyLookBackDays: 14,
  minimumDirtyEvents: 5,
  lowerPercentile: 25,
  upperPercentile: 75,
  feedWindowMinutes: 180,
  minimumFeedPairs: 5,
  maximumLagSpreadMinutes: 40,
  leadMinutes: 20,
  graceMinutes: 40,
};

function wetGap(medianGapMinutes: number, anchor: Date): DiaperPredictionsDto {
  return {
    wet: {
      anchorAt: anchor.toISOString(),
      nextStart: { earliest: '', expected: '', latest: '' },
      lowerGapMinutes: medianGapMinutes - 20,
      medianGapMinutes,
      upperGapMinutes: medianGapMinutes + 20,
      eventCount: 20,
      gapCount: 19,
      confidence: 'Medium',
    },
    dirty: null,
    rule: DIAPER_RULE,
  };
}

const AFTER_FEED: DiaperPredictionsDto = {
  wet: null,
  dirty: {
    lastDirtyAt: null,
    gap: null,
    afterFeed: {
      lowerLagMinutes: 20,
      medianLagMinutes: 30,
      upperLagMinutes: 40,
      pairCount: 6,
      confidence: 'Medium',
      latestFeedEndedAt: null,
    },
  },
  rule: DIAPER_RULE,
};

interface RankOptions {
  now?: Date;
  birthDate?: string | null;
  predictions?: PredictionsDto | null;
}

const rank = (events: BabyEvent[], options: RankOptions = {}) =>
  rankCryReasons({
    events,
    types: TYPES,
    now: options.now ?? NOON,
    birthDate: options.birthDate === undefined ? TWO_MONTHS : options.birthDate,
    predictions: options.predictions ?? null,
  });

const causeOf = (result: CryReasonResult, cause: CryCause) => {
  const found = result.causes.find((c) => c.cause === cause);
  if (!found) throw new Error(`missing ${cause}`);
  return found;
};

const order = (result: CryReasonResult) => result.causes.map((c) => c.cause);

/** A calm afternoon: nap ended 30 min ago, bottle 60 min ago, wet diaper 40 min ago. */
const calmDay = () => [sleep(120, 30), feed(60, 45), diaper(40)];

describe('rankCryReasons: shape', () => {
  it('always returns the five causes, the constant red flags and a generic basis', () => {
    const result = rank(calmDay());
    expect([...result.causes.map((c) => c.cause)].sort()).toEqual([...CRY_CAUSES].sort());
    expect(result.redFlags).toEqual([...CRY_RED_FLAGS]);
    expect(CRY_RED_FLAGS).toEqual([
      'fever',
      'inconsolable',
      'refusingFeeds',
      'unusualSleepiness',
      'bulgingOrStiffFontanelle',
    ]);
    expect(result.basis).toBe('generic');
    for (const c of result.causes) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
  });

  it('never produces free text: facts are structured and comfort claims nothing', () => {
    const result = rank([feed(200, 185), diaper(300), sleep(200, 100)]);
    expect(causeOf(result, 'comfort')).toEqual({
      cause: 'comfort',
      level: 'possible',
      score: 0.3,
      facts: [],
    });
    for (const c of result.causes) {
      for (const fact of c.facts) {
        for (const value of Object.values(fact)) {
          // Numbers, null, keys, clocks and instants only: never a sentence.
          if (typeof value === 'string') expect(value).toMatch(/^[A-Za-z0-9:.\-_]+$/);
          else expect(value === null || typeof value === 'number').toBe(true);
        }
      }
    }
  });
});

describe('rankCryReasons: hunger', () => {
  it('rises with time since the last feed (age default gap)', () => {
    const scores = [60, 150, 200].map(
      (minutes) => causeOf(rank([feed(minutes, minutes - 10)]), 'hunger').score,
    );
    expect(scores[0]).toBeLessThan(scores[1]);
    expect(scores[1]).toBeLessThan(scores[2]);
    expect(causeOf(rank([feed(60, 50)]), 'hunger').level).toBe('unlikely');
    expect(causeOf(rank([feed(150, 140)]), 'hunger').level).toBe('possible');
    expect(causeOf(rank([feed(200, 190)]), 'hunger')).toMatchObject({
      level: 'likely',
      facts: [{ kind: 'sinceLastFeed', minutes: 200, usualGapMinutes: null }],
    });
  });

  it('uses her own median gap from recent feeds when there are at least 4 gaps', () => {
    const history = [600, 480, 360, 240, 120].map((m) => feed(m, m - 15));
    const own = causeOf(rank(history), 'hunger');
    expect(own.facts).toEqual([{ kind: 'sinceLastFeed', minutes: 120, usualGapMinutes: 120 }]);
    expect(own.level).toBe('likely');
    // The same 120 min with too little history falls back to the 2-month default (180 min).
    const generic = causeOf(rank(history.slice(-3)), 'hunger');
    expect(generic.facts).toEqual([{ kind: 'sinceLastFeed', minutes: 120, usualGapMinutes: null }]);
    expect(generic.level).toBe('unlikely');
  });

  it('expects a top-up sooner after a bottle she drank well under her usual amount', () => {
    const history = [600, 480, 360, 240].map((m) => feed(m, m - 15, { amount_ml: 120 }));
    // Full bottle 90 min ago: 90 of her usual 120 min.
    const full = causeOf(rank([...history, feed(90, 80, { amount_ml: 120 })]), 'hunger');
    expect(full).toMatchObject({
      level: 'possible',
      facts: [{ kind: 'sinceLastFeed', minutes: 90, usualGapMinutes: 120 }],
    });
    // 40 of 120 ml: the gap the ramp uses is 30% shorter (the cap), so hunger is likely.
    const partial = causeOf(
      rank([...history, feed(90, 80, { amount_ml: 120, amount_drunk_ml: 40 })]),
      'hunger',
    );
    expect(partial).toMatchObject({
      level: 'likely',
      facts: [{ kind: 'sinceLastFeed', minutes: 90, usualGapMinutes: 120, smallerFeed: true }],
    });
    // A sleep stopped it and nobody said how much: unknown, so nothing changes.
    const unknown = causeOf(
      rank([...history, feed(90, 80, { amount_ml: 120, ended_by: 'sleep' })]),
      'hunger',
    );
    expect(unknown).toEqual(full);
  });

  it('merges feeds closer than 30 min into one (a side switch is not a new feed)', () => {
    const history = [600, 590, 480, 360, 240, 230, 120].map((m) => feed(m, m - 5));
    expect(causeOf(rank(history), 'hunger').facts[0]).toMatchObject({ usualGapMinutes: 120 });
  });

  it("falls back to the server's feeding median gap without enough local history", () => {
    const server = predictions({
      predictions: [
        {
          typeKey: 'feeding',
          nextStart: { earliest: '', expected: '', latest: '' },
          expectedDuration: null,
          confidence: 'Medium',
          sampleCount: 20,
          reason: '',
          basis: { kind: 'StartInterval', medianGapMinutes: 100, lookBackDays: 7 },
        },
      ],
    });
    const hunger = causeOf(rank([feed(110, 100)], { predictions: server }), 'hunger');
    expect(hunger.facts[0]).toMatchObject({ usualGapMinutes: 100 });
    expect(hunger.level).toBe('likely');
  });

  it('ignores a malformed server gap', () => {
    const server = predictions({
      predictions: [
        {
          typeKey: 'feeding',
          nextStart: { earliest: '', expected: '', latest: '' },
          expectedDuration: null,
          confidence: 'Medium',
          sampleCount: 20,
          reason: '',
          basis: { medianGapMinutes: 'soon' },
        },
      ],
    });
    expect(
      causeOf(rank([feed(110, 100)], { predictions: server }), 'hunger').facts[0],
    ).toMatchObject({ usualGapMinutes: null });
  });

  it('is unlikely while a feeding timer runs', () => {
    const hunger = causeOf(rank([feed(400, 390), feed(12, null)]), 'hunger');
    expect(hunger).toMatchObject({
      level: 'unlikely',
      facts: [{ kind: 'feedingNow', minutes: 12 }],
    });
  });

  it('is capped right after a feed ended, even a long one', () => {
    const hunger = causeOf(rank([feed(200, 5)]), 'hunger');
    expect(hunger.score).toBeLessThanOrEqual(CRY_WEIGHTS.freshCap);
    expect(hunger.level).toBe('unlikely');
  });
});

describe('rankCryReasons: sleepy', () => {
  it('rises as awake time approaches and passes the age default window', () => {
    const levels = [30, 80, 110].map(
      (awake) => causeOf(rank([sleep(awake + 60, awake)]), 'sleepy').level,
    );
    expect(levels).toEqual(['unlikely', 'likely', 'likely']);
    expect(causeOf(rank([sleep(140, 80)]), 'sleepy').facts).toEqual([
      { kind: 'awakeFor', minutes: 80, windowMinutes: null },
    ]);
  });

  it('uses her wake window from the server and the overtired signal', () => {
    const server = predictions({ wakeWindow: wakeWindow(150) });
    const early = causeOf(rank([sleep(160, 100)], { predictions: server }), 'sleepy');
    expect(early).toMatchObject({
      level: 'unlikely',
      facts: [{ kind: 'awakeFor', minutes: 100, windowMinutes: 150 }],
    });
    const overtired = causeOf(rank([sleep(200, 140)], { predictions: server }), 'sleepy');
    const plain = CRY_WEIGHTS.bands.weeks6to3m.sleepy;
    const ramped = plain.floor + (plain.max - plain.floor) * ((140 / 150 - 0.6) / 0.4);
    expect(overtired.score).toBeCloseTo(ramped + plain.overtiredBoost, 2);
    expect(overtired.level).toBe('likely');
  });

  it('has nothing to go on without any sleep logged', () => {
    expect(causeOf(rank([feed(60, 50)]), 'sleepy')).toMatchObject({
      level: 'possible',
      facts: [{ kind: 'noData', reason: 'noLog' }],
    });
  });
});

describe('rankCryReasons: diaper', () => {
  it('rises with time since the last diaper and is likely after several hours', () => {
    expect(causeOf(rank([diaper(30)]), 'diaper').level).toBe('unlikely');
    expect(causeOf(rank([diaper(150)]), 'diaper').level).toBe('possible');
    expect(causeOf(rank([diaper(250)]), 'diaper')).toMatchObject({
      level: 'likely',
      facts: [{ kind: 'sinceLastDiaper', minutes: 250, usualGapMinutes: null }],
    });
  });

  it('is likely past the stale limit even with a long usual gap', () => {
    const server = predictions({ diaper: wetGap(400, ago(250)) });
    const result = causeOf(rank([diaper(250)], { predictions: server }), 'diaper');
    expect(result.score).toBe(CRY_WEIGHTS.bands.weeks6to3m.diaper.staleFloor);
    expect(result.facts[0]).toMatchObject({ usualGapMinutes: 400 });
  });

  it('uses her usual wet gap from the server', () => {
    const server = predictions({ diaper: wetGap(90, ago(120)) });
    expect(causeOf(rank([diaper(120)], { predictions: server }), 'diaper')).toMatchObject({
      level: 'likely',
      facts: [{ kind: 'sinceLastDiaper', minutes: 120, usualGapMinutes: 90 }],
    });
  });

  it('rises when a dirty diaper is due after the latest feed', () => {
    const server = predictions({ diaper: AFTER_FEED });
    const events = [feed(45, 30), diaper(60)];
    const due = causeOf(rank(events, { predictions: server }), 'diaper');
    const plain = causeOf(rank(events), 'diaper');
    expect(due.score).toBeGreaterThan(plain.score);
    expect(due.facts).toContainEqual({
      kind: 'dirtyDue',
      signal: 'afterFeed',
      expectedAt: NOON.toISOString(),
    });
  });

  it('is capped right after a change', () => {
    const server = predictions({ diaper: AFTER_FEED });
    const fresh = causeOf(
      rank([feed(45, 30), diaper(400), diaper(5)], { predictions: server }),
      'diaper',
    );
    expect(fresh.level).toBe('unlikely');
    expect(fresh.score).toBeLessThanOrEqual(CRY_WEIGHTS.freshCap);
    expect(fresh.facts).toEqual([{ kind: 'sinceLastDiaper', minutes: 5, usualGapMinutes: null }]);
  });
});

describe('rankCryReasons: gas', () => {
  it('rises soon after a milk feed without a burp or massage', () => {
    const gas = causeOf(rank([feed(30, 10)]), 'gas');
    expect(gas.facts).toEqual([{ kind: 'recentFeedNoBurp', minutesSinceFeed: 10 }]);
    expect(gas.level).toBe('possible');
    expect(gas.score).toBeGreaterThan(causeOf(rank([feed(80, 60)]), 'gas').score);
  });

  it('is lower when a burp or belly massage was logged with the feed', () => {
    const plain = causeOf(rank([feed(30, 10)]), 'gas');
    const burped = causeOf(rank([feed(30, 10), ev(BURP_TYPE, ago(9))]), 'gas');
    const massaged = causeOf(rank([feed(30, 10), massage(8, 2)]), 'gas');
    expect(burped.facts).toEqual([{ kind: 'reliefAfterFeed', minutesSinceFeed: 10 }]);
    expect(burped.score).toBeLessThan(plain.score);
    expect(massaged.score).toBe(burped.score);
  });

  it('ignores solids and feeds that ended more than 30 min ago', () => {
    expect(causeOf(rank([feed(30, 10, { method: 'solid' })]), 'gas').facts).toEqual([]);
    expect(causeOf(rank([feed(60, 40)]), 'gas').facts).toEqual([]);
  });

  it('rises inside her belly pain window unless a massage was logged in it', () => {
    const server = predictions({ patterns: [pattern('belly_pain', '13:30', '14:00')] });
    const gas = causeOf(rank([feed(200, 190)], { predictions: server }), 'gas');
    expect(gas.facts).toEqual([{ kind: 'bellyPattern', typicalClock: '14:00' }]);
    expect(gas.score).toBeCloseTo(0.45, 3);
    const handled = causeOf(rank([feed(200, 190), massage(20, 5)], { predictions: server }), 'gas');
    expect(handled.facts).toEqual([]);
  });

  it('rises in her fussy window, and in a generic evening only under 3 months', () => {
    const server = predictions({ patterns: [pattern('fussy', '13:30', '14:00')] });
    expect(causeOf(rank([feed(200, 190)], { predictions: server }), 'gas').facts).toEqual([
      { kind: 'eveningFussy', typicalClock: '14:00' },
    ]);
    const evening = at(18, 0);
    const events = [feed(200, 190, {}, evening)];
    expect(causeOf(rank(events, { now: evening }), 'gas').facts).toEqual([
      { kind: 'eveningFussy', typicalClock: null },
    ]);
    expect(causeOf(rank(events, { now: evening, birthDate: EIGHT_MONTHS }), 'gas').facts).toEqual(
      [],
    );
  });
});

describe('rankCryReasons: no data, timers, night', () => {
  it('a new baby with nothing logged: every cause possible with noData, comfort last', () => {
    const result = rank([], { birthDate: NEWBORN });
    expect(order(result)).toEqual(['hunger', 'sleepy', 'diaper', 'gas', 'comfort']);
    for (const c of result.causes.slice(0, 4)) {
      expect(c).toMatchObject({ level: 'possible', facts: [{ kind: 'noData', reason: 'noLog' }] });
    }
    expect(causeOf(result, 'comfort').score).toBeLessThan(result.causes[0].score);
  });

  it('crying while a sleep timer runs: every cause possible with an asleep noData fact', () => {
    const result = rank([feed(300, 290), diaper(300), sleep(40, null)]);
    for (const c of result.causes.slice(0, 4)) {
      expect(c).toMatchObject({ level: 'possible', facts: [{ kind: 'noData', reason: 'asleep' }] });
    }
    expect(result.causes.every((c) => c.level === 'possible')).toBe(true);
    expect(order(result).at(-1)).toBe('comfort');
  });

  it('a night waking running inside the night is ranked as awake at night', () => {
    const night = at(3, 0);
    const events = [
      feed(200, 185, {}, night),
      sleep(300, null, 'night', night),
      sleep(10, null, 'night_waking', night),
    ];
    const result = rank(events, { now: night });
    expect(causeOf(result, 'sleepy').facts).toEqual([
      { kind: 'awakeFor', minutes: 10, windowMinutes: null },
      { kind: 'nightTime' },
    ]);
    expect(causeOf(result, 'hunger').level).toBe('likely');
  });

  it('overnight: woke from the night sleep, last feed hours ago', () => {
    const night = at(3, 0);
    const events = [
      feed(210, 195, {}, night),
      sleep(200, 10, 'night', night),
      diaper(215, 'WET', night),
    ];
    const result = rank(events, { now: night });
    expect(order(result)[0]).toBe('hunger');
    expect(causeOf(result, 'sleepy').score).toBe(CRY_WEIGHTS.bands.weeks6to3m.sleepy.nightFloor);
    expect(causeOf(result, 'sleepy').facts).toContainEqual({ kind: 'nightTime' });
  });

  it('works offline: null and missing predictions give the same generic ranking', () => {
    const events = calmDay();
    const offline = rank(events, { predictions: null });
    const missing = rankCryReasons({
      events,
      types: TYPES,
      now: NOON,
      birthDate: TWO_MONTHS,
      predictions: undefined,
    });
    expect(missing).toEqual(offline);
    expect(causeOf(offline, 'hunger').facts[0]).toMatchObject({ usualGapMinutes: null });
    expect(causeOf(offline, 'sleepy').facts[0]).toMatchObject({ windowMinutes: null });
  });

  it('ignores deleted and future events', () => {
    const events = [
      feed(300, 290),
      feed(20, 5, {}, NOON),
      ev(FEEDING_TYPE, ago(-30), ago(-40), { method: 'bottle' }),
    ];
    events[1] = { ...events[1], deletedAt: NOON.toISOString() };
    expect(causeOf(rank(events), 'hunger').facts[0]).toMatchObject({ minutes: 300 });
  });
});

describe('rankCryReasons: age bands', () => {
  it('maps birth dates to bands', () => {
    expect(cryAgeBand('2026-09-10', NOON)).toBe('newborn'); // 41 days
    expect(cryAgeBand('2026-09-09', NOON)).toBe('weeks6to3m'); // 42 days
    expect(cryAgeBand('2026-07-22', NOON)).toBe('weeks6to3m');
    expect(cryAgeBand('2026-07-21', NOON)).toBe('months3to6');
    expect(cryAgeBand('2026-04-22', NOON)).toBe('months3to6');
    expect(cryAgeBand('2026-04-21', NOON)).toBe('months6plus');
    expect(cryAgeBand(null, NOON)).toBeNull();
    expect(cryAgeBand('soon', NOON)).toBeNull();
    expect(cryAgeBand('2026-12-01', NOON)).toBeNull();
  });

  it('the same two hours since a feed: likely for a newborn, unlikely at 8 months', () => {
    const events = [feed(120, 110)];
    expect(causeOf(rank(events, { birthDate: NEWBORN }), 'hunger').level).toBe('likely');
    expect(causeOf(rank(events, { birthDate: FOUR_MONTHS }), 'hunger').level).toBe('unlikely');
    expect(causeOf(rank(events, { birthDate: EIGHT_MONTHS }), 'hunger').level).toBe('unlikely');
  });

  it('the same awake hour: likely for a newborn, unlikely at 8 months', () => {
    const events = [sleep(120, 60)];
    expect(causeOf(rank(events, { birthDate: NEWBORN }), 'sleepy').level).toBe('likely');
    expect(causeOf(rank(events, { birthDate: EIGHT_MONTHS }), 'sleepy').level).toBe('unlikely');
  });

  it('without a birth date uses the default band', () => {
    const events = calmDay();
    expect(rank(events, { birthDate: null })).toEqual(rank(events, { birthDate: TWO_MONTHS }));
  });
});

describe('rankCryReasons: ordering', () => {
  it('ties keep the order of CRY_CAUSES', () => {
    const result = rank([], { birthDate: null });
    expect(order(result)).toEqual([...CRY_CAUSES]);
  });

  it('does not depend on the order of the events', () => {
    const events = [feed(200, 190), sleep(260, 100), diaper(150), massage(500, 490), feed(30, 10)];
    const forward = rank(events);
    expect(rank([...events].reverse())).toEqual(forward);
    expect(rank([events[2], events[0], events[4], events[1], events[3]])).toEqual(forward);
  });

  it('keeps the fallback under a strongly supported cause even with replaced weights', () => {
    const weights = {
      ...CRY_WEIGHTS,
      bands: {
        ...CRY_WEIGHTS.bands,
        weeks6to3m: { ...CRY_WEIGHTS.bands.weeks6to3m, comfort: 0.95 },
      },
    };
    const result = rankCryReasons({
      events: [feed(300, 290)],
      types: TYPES,
      now: NOON,
      birthDate: TWO_MONTHS,
      predictions: null,
      weights,
    });
    expect(order(result)[0]).toBe('hunger');
    expect(causeOf(result, 'comfort').score).toBeLessThan(weights.noDataScore);
  });
});

describe('rankCryReasons: golden scenarios', () => {
  interface Scenario {
    name: string;
    now?: Date;
    birthDate?: string;
    predictions?: PredictionsDto;
    events: () => BabyEvent[];
    /** Expected `cause:level` in rank order. */
    expected: string[];
  }

  const NIGHT = at(3, 0);
  const EVENING = at(18, 30);
  const scenarios: Scenario[] = [
    {
      name: 'calm afternoon: everything handled, comfort first',
      events: calmDay,
      expected: [
        'comfort:possible',
        'gas:unlikely',
        'hunger:unlikely',
        'sleepy:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: 'long since the last bottle',
      events: () => [sleep(150, 40), feed(210, 195), diaper(50)],
      expected: [
        'hunger:likely',
        'comfort:possible',
        'gas:unlikely',
        'sleepy:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: 'right after a bottle, no burp',
      events: () => [sleep(150, 40), feed(25, 8), diaper(50)],
      expected: [
        'gas:possible',
        'comfort:possible',
        'hunger:unlikely',
        'sleepy:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: 'right after a bottle, burped',
      events: () => [sleep(150, 40), feed(25, 8), ev(BURP_TYPE, ago(6)), diaper(50)],
      expected: [
        'comfort:possible',
        'gas:unlikely',
        'hunger:unlikely',
        'sleepy:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: 'awake well past the window',
      events: () => [sleep(200, 110), feed(100, 85), diaper(60)],
      expected: [
        'sleepy:likely',
        'comfort:possible',
        'gas:unlikely',
        'hunger:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: 'overtired by her own wake window',
      predictions: predictions({ wakeWindow: wakeWindow(120) }),
      events: () => [sleep(200, 125), feed(90, 75), diaper(60)],
      expected: [
        'sleepy:likely',
        'comfort:possible',
        'gas:unlikely',
        'hunger:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: 'no diaper for hours',
      events: () => [sleep(150, 40), feed(80, 65), diaper(280)],
      expected: [
        'diaper:likely',
        'comfort:possible',
        'gas:unlikely',
        'hunger:unlikely',
        'sleepy:unlikely',
      ],
    },
    {
      name: 'dirty diaper due after the feed',
      predictions: predictions({ diaper: AFTER_FEED }),
      events: () => [sleep(150, 40), feed(50, 35), diaper(100)],
      expected: [
        'diaper:possible',
        'comfort:possible',
        'gas:unlikely',
        'hunger:unlikely',
        'sleepy:unlikely',
      ],
    },
    {
      name: 'feeding timer running',
      events: () => [sleep(150, 40), feed(10, null), diaper(50)],
      expected: [
        'comfort:possible',
        'gas:unlikely',
        'hunger:unlikely',
        'sleepy:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: 'sleep timer running',
      events: () => [sleep(30, null), feed(200, 185), diaper(300)],
      expected: [
        'hunger:possible',
        'sleepy:possible',
        'diaper:possible',
        'gas:possible',
        'comfort:possible',
      ],
    },
    {
      name: 'new baby, nothing logged',
      birthDate: NEWBORN,
      events: () => [],
      expected: [
        'hunger:possible',
        'sleepy:possible',
        'diaper:possible',
        'gas:possible',
        'comfort:possible',
      ],
    },
    {
      name: 'newborn two hours after a feed',
      birthDate: NEWBORN,
      events: () => [sleep(100, 40), feed(125, 110), diaper(45)],
      expected: [
        'hunger:likely',
        'comfort:possible',
        'sleepy:unlikely',
        'gas:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: 'eight months, same two hours',
      birthDate: EIGHT_MONTHS,
      events: () => [sleep(100, 40), feed(125, 110), diaper(45)],
      expected: [
        'comfort:possible',
        'gas:unlikely',
        'hunger:unlikely',
        'sleepy:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: 'evening inside her belly pain and fussy windows',
      now: EVENING,
      predictions: predictions({
        patterns: [pattern('belly_pain', '18:00', '18:30'), pattern('fussy', '18:00', '18:30')],
      }),
      events: () => [
        sleep(100, 40, 'nap', EVENING),
        feed(90, 75, {}, EVENING),
        diaper(50, 'WET', EVENING),
      ],
      expected: [
        'gas:likely',
        'comfort:possible',
        'hunger:unlikely',
        'sleepy:unlikely',
        'diaper:unlikely',
      ],
    },
    {
      name: '3 am after the night sleep, last feed hours ago',
      now: NIGHT,
      events: () => [
        feed(220, 205, {}, NIGHT),
        sleep(200, 5, 'night', NIGHT),
        diaper(225, 'WET', NIGHT),
      ],
      expected: [
        'hunger:likely',
        'diaper:likely',
        'sleepy:possible',
        'comfort:possible',
        'gas:unlikely',
      ],
    },
  ];

  it.each(scenarios)('$name', (scenario) => {
    const result = rankCryReasons({
      events: scenario.events(),
      types: TYPES,
      now: scenario.now ?? NOON,
      birthDate: scenario.birthDate ?? TWO_MONTHS,
      predictions: scenario.predictions ?? null,
    });
    expect(result.causes.map((c) => `${c.cause}:${c.level}`)).toEqual(scenario.expected);
    // Invariants: comfort never above a likely cause; scores sorted.
    const comfortAt = order(result).indexOf('comfort');
    result.causes.forEach((c, i) => {
      if (c.level === 'likely') expect(i).toBeLessThan(comfortAt);
      if (i > 0) expect(result.causes[i - 1].score).toBeGreaterThanOrEqual(c.score);
    });
  });
});

describe('cryOutcomeHistory', () => {
  const fussy = (minutesAgo: number, whatHelped?: unknown, extra: Partial<BabyEvent> = {}) =>
    ev(
      FUSSY_TYPE,
      ago(minutesAgo),
      ago(minutesAgo - 10),
      whatHelped === undefined ? {} : { what_helped: whatHelped as string },
      extra,
    );

  it('maps what helped to causes, including the new option keys', () => {
    expect(outcomeCause('feeding')).toBe('hunger');
    expect(outcomeCause('sleep')).toBe('sleepy');
    expect(outcomeCause('diaper_change')).toBe('diaper');
    expect(outcomeCause('burping')).toBe('gas');
    expect(outcomeCause('massage')).toBe('gas');
    expect(outcomeCause('rocking')).toBe('comfort');
    expect(outcomeCause('pacifier')).toBe('comfort');
    expect(outcomeCause('holding')).toBe('comfort');
    expect(outcomeCause('other')).toBe('none');
    expect(outcomeCause('nothing')).toBe('none');
  });

  it('maps unknown and prototype names safely to none', () => {
    for (const value of ['swaddle', '__proto__', 'constructor', 'toString', '', 'FEEDING']) {
      expect(outcomeCause(value)).toBe('none');
    }
  });

  it('counts the last N answered spells per cause', () => {
    const events = [
      fussy(60, 'feeding'),
      fussy(120, 'rocking'),
      fussy(180), // no answer: skipped
      fussy(240, 'feeding'),
      fussy(300, 'swaddle'), // unknown: none
      fussy(360, 'burping'),
      fussy(420, 'sleep'), // beyond the limit of 5
      feed(30, 20),
    ];
    const history = cryOutcomeHistory(events, TYPES, NOON, 5);
    expect(history.spells).toBe(5);
    expect(history.none).toBe(1);
    expect(history.byCause).toEqual({
      hunger: { helped: 2, total: 5 },
      sleepy: { helped: 0, total: 5 },
      diaper: { helped: 0, total: 5 },
      gas: { helped: 1, total: 5 },
      comfort: { helped: 1, total: 5 },
    });
  });

  it('skips deleted, future and non-string answers; accepts a list of answers', () => {
    const events = [
      fussy(60, 'feeding', { deletedAt: NOON.toISOString() }),
      fussy(-30, 'feeding'),
      fussy(90, 42),
      fussy(100, { feeding: true }),
      fussy(120, ['holding', 'pacifier', 'diaper_change']),
    ];
    const history = cryOutcomeHistory(events, TYPES, NOON, 10);
    expect(history.spells).toBe(1);
    expect(history.byCause.comfort).toEqual({ helped: 1, total: 1 });
    expect(history.byCause.diaper).toEqual({ helped: 1, total: 1 });
    expect(history.byCause.hunger).toEqual({ helped: 0, total: 1 });
  });

  it('leaves out cry monitor spells a parent marked "Not crying", keeps the confirmed ones', () => {
    const events = [
      ev(FUSSY_TYPE, ago(60), ago(50), {
        what_helped: 'feeding',
        auto_detected: true,
        cry_confirmed: false,
      }),
      ev(FUSSY_TYPE, ago(120), ago(110), {
        what_helped: 'rocking',
        auto_detected: true,
        cry_confirmed: true,
      }),
      ev(FUSSY_TYPE, ago(180), ago(170), { what_helped: 'sleep', auto_detected: true }),
    ];
    const history = cryOutcomeHistory(events, TYPES, NOON, 10);
    expect(history.spells).toBe(2);
    expect(history.byCause.hunger.helped).toBe(0);
    expect(history.byCause.comfort.helped).toBe(1);
    expect(history.byCause.sleepy.helped).toBe(1);
  });

  it('is empty without fussy spells or with a zero limit', () => {
    const empty = cryOutcomeHistory([feed(30, 20)], TYPES, NOON);
    expect(empty.spells).toBe(0);
    expect(empty.byCause.hunger).toEqual({ helped: 0, total: 0 });
    expect(cryOutcomeHistory([fussy(60, 'feeding')], TYPES, NOON, 0).spells).toBe(0);
  });
});

describe('published feed norms as the default gap (docs/design/28-age-norms.md section 15.2)', () => {
  const breast = (startAgo: number, endAgo: number) => feed(startAgo, endAgo, { method: 'breast' });
  const formula = (startAgo: number, endAgo: number) =>
    feed(startAgo, endAgo, { bottle_feeding_type: 'formula' });
  const hungerWith = (events: BabyEvent[], birthDate: string, ageNorms: AgeNormSet | null) =>
    causeOf(
      rankCryReasons({
        events,
        types: TYPES,
        now: NOON,
        birthDate,
        predictions: null,
        ageNorms,
      }),
      'hunger',
    ).score;

  it('the default gap: breastfed under 4 weeks 120 min; from 4 weeks the band default stays (no norm)', () => {
    expect(normFeedGapMinutes(SHIPPED_AGE_NORMS, NEWBORN, NOON, [breast(60, 40)])).toBe(120);
    const expressedNewborn = feed(60, 50, { bottle_feeding_type: 'breast_milk' });
    expect(normFeedGapMinutes(SHIPPED_AGE_NORMS, NEWBORN, NOON, [expressedNewborn])).toBe(120);
    // The flat 131 min (11 feeds a day) for 4 weeks to 6 months was too short for 3 to 6 months.
    expect(normFeedGapMinutes(SHIPPED_AGE_NORMS, TWO_MONTHS, NOON, [breast(60, 40)])).toBeNull();
    expect(normFeedGapMinutes(SHIPPED_AGE_NORMS, FOUR_MONTHS, NOON, [breast(60, 40)])).toBeNull();
  });

  it('no default from the norms: formula (ranges only, or under review), mixed, unknown milk, 6 months and over, no norms', () => {
    const norms = SHIPPED_AGE_NORMS;
    expect(normFeedGapMinutes(norms, NEWBORN, NOON, [formula(60, 50)])).toBeNull();
    expect(normFeedGapMinutes(norms, TWO_MONTHS, NOON, [formula(60, 50)])).toBeNull();
    expect(normFeedGapMinutes(norms, TWO_MONTHS, NOON, [formula(90, 80), breast(60, 40)])).toBe(
      null,
    );
    expect(normFeedGapMinutes(norms, TWO_MONTHS, NOON, [feed(60, 50)])).toBeNull();
    expect(normFeedGapMinutes(norms, TWO_MONTHS, NOON, [])).toBeNull();
    expect(normFeedGapMinutes(norms, EIGHT_MONTHS, NOON, [breast(60, 40)])).toBeNull();
    expect(normFeedGapMinutes(null, TWO_MONTHS, NOON, [breast(60, 40)])).toBeNull();
    expect(normFeedGapMinutes(norms, null, NOON, [breast(60, 40)])).toBeNull();
  });

  it('reads the milk of the logged feeds; solids do not count', () => {
    expect(milkPopulationOf([breast(60, 40), feed(30, 20, { method: 'solid' })])).toBe('breastfed');
    expect(milkPopulationOf([formula(60, 50), feed(30, 30, { formula_name: 'Nan' })])).toBe(
      'formula',
    );
    expect(milkPopulationOf([breast(60, 40), formula(30, 20)])).toBeNull();
  });

  it('golden: breastfed newborn, 120 min since the feed: 0.633 before, 0.9 after', () => {
    const events = [breast(120, 110)];
    expect(hungerWith(events, NEWBORN, null)).toBeCloseTo(0.633, 3);
    expect(hungerWith(events, NEWBORN, SHIPPED_AGE_NORMS)).toBeCloseTo(0.9, 3);
  });

  it('golden: breastfed 2 months, 120 min since the feed: 0.286, the same with or without norms', () => {
    const events = [breast(120, 110)];
    expect(hungerWith(events, TWO_MONTHS, null)).toBeCloseTo(0.286, 3);
    expect(hungerWith(events, TWO_MONTHS, SHIPPED_AGE_NORMS)).toBeCloseTo(0.286, 3);
  });

  it('unchanged: formula, 8 months, her own usual gap, a flagged norm', () => {
    expect(hungerWith([formula(120, 110)], TWO_MONTHS, SHIPPED_AGE_NORMS)).toBe(
      hungerWith([formula(120, 110)], TWO_MONTHS, null),
    );
    expect(hungerWith([breast(120, 110)], EIGHT_MONTHS, SHIPPED_AGE_NORMS)).toBe(
      hungerWith([breast(120, 110)], EIGHT_MONTHS, null),
    );
    const own = [breast(600, 590), breast(450, 440), breast(300, 290), breast(240, 230)];
    own.push(breast(120, 110));
    expect(hungerWith(own, TWO_MONTHS, SHIPPED_AGE_NORMS)).toBe(hungerWith(own, TWO_MONTHS, null));
    const flagged = {
      ...SHIPPED_AGE_NORMS,
      norms: SHIPPED_AGE_NORMS.norms.map((norm) =>
        norm.id === 'feeds_per_24h.breastfed.28-183' ? { ...norm, confidence: 'low' } : norm,
      ),
    } as AgeNormSet;
    expect(hungerWith([breast(120, 110)], TWO_MONTHS, flagged)).toBe(
      hungerWith([breast(120, 110)], TWO_MONTHS, null),
    );
  });
});
