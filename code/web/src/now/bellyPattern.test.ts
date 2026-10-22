import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import type { PredictionsDto, TimeOfDayPatternDto } from '../sync/contract';
import { BABY_ID } from '../test/fakeApi';
import { eventType } from '../presets/presetFixtures';
import {
  bellyPainPattern,
  bellySuggestion,
  clockMinutes,
  localDateKey,
  windowAround,
} from './bellyPattern';

const PAIN = eventType({ id: 't-pain', key: 'belly_pain', name: 'Belly pain' });
const MASSAGE = eventType({
  id: 't-massage',
  key: 'belly_massage',
  name: 'Belly massage',
  hasDuration: true,
});
const FEED = eventType({ id: 't-feed', key: 'feeding', name: 'Feeding' });
const TYPES = [PAIN, MASSAGE, FEED];

/** Local time on 2026-10-21. */
const at = (hour: number, minute = 0, day = 21) => new Date(2026, 9, day, hour, minute);

function pattern(over: Partial<TimeOfDayPatternDto> = {}): TimeOfDayPatternDto {
  return {
    typeKey: 'belly_pain',
    typicalClock: '18:00',
    windowStart: '17:30',
    windowEnd: '18:30',
    windowMinutes: 60,
    spreadMinutes: 10,
    confidence: 'Medium',
    eventDayCount: 6,
    recentDayCount: 5,
    timeZone: 'America/Sao_Paulo',
    days: [{ date: '2026-10-20', times: ['18:05'] }],
    rule: {
      lookBackDays: 14,
      recentDays: 7,
      minimumRecentDays: 4,
      maximumSpreadMinutes: 45,
      minimumCoveragePercent: 60,
      leadMinutes: 45,
    },
    ...over,
  };
}

const predictions = (patterns: TimeOfDayPatternDto[] | undefined): PredictionsDto => ({
  babyId: BABY_ID,
  generatedAt: '2026-10-21T12:00:00Z',
  predictions: [],
  insufficientData: [],
  ...(patterns ? { patterns } : {}),
});

let counter = 0;
function event(typeId: string, startedAt: Date, extra: Partial<BabyEvent> = {}): BabyEvent {
  counter += 1;
  const iso = startedAt.toISOString();
  return {
    id: `e-${counter}`,
    babyId: BABY_ID,
    typeId,
    startedAt: iso,
    endedAt: iso,
    payload: {},
    notes: null,
    createdBy: null,
    createdAt: iso,
    updatedAt: iso,
    deletedAt: null,
    ...extra,
  };
}

const suggest = (
  now: Date,
  events: BabyEvent[] = [],
  dismissedDate: string | null = null,
  p = pattern(),
) => bellySuggestion({ predictions: predictions([p]), events, types: TYPES, now, dismissedDate });

describe('the belly pain pattern from the server', () => {
  it('reads the belly pain entry and rejects malformed ones', () => {
    expect(bellyPainPattern(predictions([pattern()]))?.typicalClock).toBe('18:00');
    expect(bellyPainPattern(predictions(undefined))).toBeNull();
    expect(bellyPainPattern(predictions([pattern({ typeKey: 'diaper' })]))).toBeNull();
    expect(bellyPainPattern(predictions([pattern({ windowStart: '25:00' })]))).toBeNull();
    expect(bellyPainPattern(predictions([pattern({ windowMinutes: 0 })]))).toBeNull();
    expect(bellyPainPattern(predictions([pattern({ windowMinutes: 181 })]))).toBeNull();
    expect(bellyPainPattern(null)).toBeNull();
  });

  it('reads clocks as minutes after midnight', () => {
    expect(clockMinutes('18:05')).toBe(1085);
    expect(clockMinutes('00:00')).toBe(0);
    expect(clockMinutes('7:05')).toBeUndefined();
    expect(clockMinutes(undefined)).toBeUndefined();
  });
});

describe('the window around now', () => {
  it('opens 45 minutes before the window and closes at its end', () => {
    expect(windowAround(pattern(), at(16, 44))).toBeNull();
    const open = windowAround(pattern(), at(16, 45));
    expect(open).toEqual({
      date: '2026-10-21',
      showFrom: at(16, 45),
      start: at(17, 30),
      end: at(18, 30),
      typical: at(18, 0),
    });
    expect(windowAround(pattern(), at(18, 29))?.date).toBe('2026-10-21');
    expect(windowAround(pattern(), at(18, 30))).toBeNull();
  });

  it('handles a window across midnight from both sides', () => {
    const late = pattern({ typicalClock: '00:00', windowStart: '23:30', windowEnd: '00:30' });
    expect(windowAround(late, at(22, 50))?.date).toBe('2026-10-21');
    const afterMidnight = windowAround(late, at(0, 10, 22));
    expect(afterMidnight?.date).toBe('2026-10-21');
    expect(afterMidnight?.typical).toEqual(at(0, 0, 22));
    expect(windowAround(late, at(0, 30, 22))).toBeNull();
  });

  it('uses the lead the server sends', () => {
    const shortLead = pattern({ rule: { ...pattern().rule, leadMinutes: 10 } });
    expect(windowAround(shortLead, at(17, 19))).toBeNull();
    expect(windowAround(shortLead, at(17, 20))).not.toBeNull();
  });

  it('names dates as local yyyy-mm-dd', () => {
    expect(localDateKey(at(0, 5, 3))).toBe('2026-10-03');
  });
});

describe('the suggestion', () => {
  it('shows within the lead window when nothing was logged', () => {
    expect(suggest(at(17, 0))?.window.date).toBe('2026-10-21');
    expect(suggest(at(12, 0))).toBeNull();
  });

  it('is hidden once a belly pain or a belly massage is logged from the lead time on', () => {
    expect(suggest(at(17, 0), [event(PAIN.id, at(16, 50))])).toBeNull();
    expect(suggest(at(17, 0), [event(MASSAGE.id, at(16, 46), { endedAt: null })])).toBeNull();
    expect(suggest(at(17, 0), [event(PAIN.id, at(16, 44))])).not.toBeNull();
    expect(suggest(at(17, 0), [event(FEED.id, at(16, 50))])).not.toBeNull();
    expect(
      suggest(at(17, 0), [event(PAIN.id, at(16, 50), { deletedAt: '2026-10-21T20:00:00Z' })]),
    ).not.toBeNull();
  });

  it('is hidden while a belly massage started earlier is still running', () => {
    expect(suggest(at(17, 0), [event(MASSAGE.id, at(15, 0), { endedAt: null })])).toBeNull();
    expect(suggest(at(17, 0), [event(MASSAGE.id, at(15, 0))])).not.toBeNull();
  });

  it('"Not today" hides this window only', () => {
    expect(suggest(at(17, 0), [], '2026-10-21')).toBeNull();
    expect(suggest(at(17, 0, 22), [], '2026-10-21')?.window.date).toBe('2026-10-22');
  });

  it('is hidden without a pattern', () => {
    expect(
      bellySuggestion({
        predictions: predictions([]),
        events: [],
        types: TYPES,
        now: at(17, 0),
        dismissedDate: null,
      }),
    ).toBeNull();
  });
});
