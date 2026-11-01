import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import type { PredictionsDto, TimeOfDayPatternDto } from '../sync/contract';
import { BABY_ID } from '../test/fakeApi';
import { eventType } from '../presets/presetFixtures';
import { fussyPattern, fussySuggestion } from './fussyPattern';

/*
 * The fussy pattern suggestion reuses the belly pain window rules (docs/design/11-patterns.md
 * section 7): only the type and what handles the window differ.
 */

const FUSSY = eventType({ id: 't-fussy', key: 'fussy', name: 'Fussy / crying', hasDuration: true });
const PAIN = eventType({ id: 't-pain', key: 'belly_pain', name: 'Belly pain' });
const TYPES = [FUSSY, PAIN];

/** Local time on 2026-10-21. */
const at = (hour: number, minute = 0, day = 21) => new Date(2026, 9, day, hour, minute);

function pattern(over: Partial<TimeOfDayPatternDto> = {}): TimeOfDayPatternDto {
  return {
    typeKey: 'fussy',
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

const predictions = (patterns: TimeOfDayPatternDto[]): PredictionsDto => ({
  babyId: BABY_ID,
  generatedAt: '2026-10-21T12:00:00Z',
  predictions: [],
  insufficientData: [],
  patterns,
});

let counter = 0;
function event(typeId: string, startedAt: Date, endedAt: Date | null = startedAt): BabyEvent {
  counter += 1;
  return {
    id: `e-${counter}`,
    babyId: BABY_ID,
    typeId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt?.toISOString() ?? null,
    payload: {},
    notes: null,
    createdBy: null,
    createdAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
    deletedAt: null,
  };
}

const suggest = (now: Date, events: BabyEvent[] = [], dismissedDate: string | null = null) =>
  fussySuggestion({
    predictions: predictions([pattern()]),
    events,
    types: TYPES,
    now,
    dismissedDate,
  });

describe('fussyPattern', () => {
  it('reads only the fussy entry of the patterns', () => {
    const belly = pattern({ typeKey: 'belly_pain', typicalClock: '09:00' });
    expect(fussyPattern(predictions([belly]))).toBeNull();
    expect(fussyPattern(predictions([belly, pattern()]))?.typicalClock).toBe('18:00');
    expect(fussyPattern(predictions([pattern({ windowStart: '25:00' })]))).toBeNull();
  });
});

describe('fussySuggestion', () => {
  it('shows from 45 min before the window until it ends, with the usual time', () => {
    expect(suggest(at(16, 44))).toBeNull();
    const shown = suggest(at(16, 45));
    expect(shown?.window.typical).toEqual(at(18, 0));
    expect(shown?.window.date).toBe('2026-10-21');
    expect(suggest(at(18, 29))).not.toBeNull();
    expect(suggest(at(18, 30))).toBeNull();
  });

  it('is handled by a fussy spell from the suggestion time on, or one still running', () => {
    expect(suggest(at(17, 0), [event(FUSSY.id, at(16, 40))])).not.toBeNull();
    expect(suggest(at(17, 0), [event(FUSSY.id, at(16, 50))])).toBeNull();
    expect(suggest(at(17, 0), [event(FUSSY.id, at(15, 0), null)])).toBeNull();
    // Another type (here belly pain) does not handle the fussy window.
    expect(suggest(at(17, 0), [event(PAIN.id, at(16, 50))])).not.toBeNull();
  });

  it('is not handled by a cry monitor spell marked "Not crying"; a confirmed one handles it', () => {
    const auto = (cry_confirmed?: boolean) => ({
      ...event(FUSSY.id, at(16, 50)),
      payload: { auto_detected: true, ...(cry_confirmed === undefined ? {} : { cry_confirmed }) },
    });
    expect(suggest(at(17, 0), [auto(false)])).not.toBeNull();
    expect(suggest(at(17, 0), [{ ...auto(false), endedAt: null }])).not.toBeNull();
    expect(suggest(at(17, 0), [auto(true)])).toBeNull();
    expect(suggest(at(17, 0), [auto()])).toBeNull();
  });

  it('is hidden for the window "Not today" was chosen for, and back the next day', () => {
    expect(suggest(at(17, 0), [], '2026-10-21')).toBeNull();
    expect(suggest(at(17, 0, 22), [], '2026-10-21')).not.toBeNull();
  });

  it('is hidden without a pattern', () => {
    expect(
      fussySuggestion({
        predictions: predictions([]),
        events: [],
        types: TYPES,
        now: at(17, 0),
        dismissedDate: null,
      }),
    ).toBeNull();
  });
});
