import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import type { DiaperPredictionsDto, PredictionsDto } from '../sync/contract';
import { BABY_ID } from '../test/fakeApi';
import { eventType } from '../presets/presetFixtures';
import {
  diaperPredictionsOf,
  dirtySuggestion,
  isDirtyDiaper,
  isWetDiaper,
  latestFeedEnd,
  wetSuggestion,
  type DiaperSuggestionInput,
} from './diaperPredictions';

/*
 * The diaper suggestions (docs/design/11-patterns.md section 8): the gaps and the lag after feeds
 * come from the server; the anchors are the latest local events. Fixed local times, never the
 * wall clock.
 */

const DIAPER = eventType({ id: 't-diaper', key: 'diaper', name: 'Diaper' });
const FEED = eventType({ id: 't-feed', key: 'feeding', name: 'Feeding', hasDuration: true });
const TYPES = [DIAPER, FEED];

/** Local time on 2026-10-21. */
const at = (hour: number, minute = 0, day = 21) => new Date(2026, 9, day, hour, minute);

const RULE: DiaperPredictionsDto['rule'] = {
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

/** Wet every ~2h30 (2h10-2h50), the server's latest wet diaper at 13:00. */
const WET = {
  anchorAt: at(13).toISOString(),
  nextStart: {
    earliest: at(15, 10).toISOString(),
    expected: at(15, 30).toISOString(),
    latest: at(15, 50).toISOString(),
  },
  lowerGapMinutes: 130,
  medianGapMinutes: 150,
  upperGapMinutes: 170,
  eventCount: 40,
  gapCount: 39,
  confidence: 'Medium' as const,
  trend: null,
};

/** Dirty every ~8h, the latest at 08:00; 30-40 min after feeds (median 35). */
const DIRTY: NonNullable<DiaperPredictionsDto['dirty']> = {
  lastDirtyAt: at(8).toISOString(),
  gap: {
    ...WET,
    anchorAt: at(8).toISOString(),
    lowerGapMinutes: 420,
    medianGapMinutes: 480,
    upperGapMinutes: 540,
  },
  afterFeed: {
    lowerLagMinutes: 30,
    medianLagMinutes: 35,
    upperLagMinutes: 40,
    pairCount: 9,
    confidence: 'Medium',
    latestFeedEndedAt: at(7, 25).toISOString(),
  },
};

const predictions = (diaper: Partial<DiaperPredictionsDto> | null | undefined): PredictionsDto => ({
  babyId: BABY_ID,
  generatedAt: at(12).toISOString(),
  predictions: [],
  insufficientData: [],
  ...(diaper === undefined
    ? {}
    : { diaper: diaper && { wet: WET, dirty: DIRTY, rule: RULE, ...diaper } }),
});

let counter = 0;
function event(typeId: string, start: Date, end: Date | null, payload = {}): BabyEvent {
  counter += 1;
  return {
    id: `e-${counter}`,
    babyId: BABY_ID,
    typeId,
    startedAt: start.toISOString(),
    endedAt: end?.toISOString() ?? null,
    payload,
    notes: null,
    createdBy: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
  };
}

const change = (when: Date, content: string) => event(DIAPER.id, when, when, { content });
const feed = (start: Date, end: Date | null) => event(FEED.id, start, end, { method: 'bottle' });

function input(
  now: Date,
  events: BabyEvent[] = [],
  dto: PredictionsDto = predictions({}),
  dismissedAnchor: string | null = null,
): DiaperSuggestionInput {
  return { predictions: dto, events, types: TYPES, now, dismissedAnchor };
}

describe('diaperPredictionsOf', () => {
  it('accepts well-formed parts and drops malformed or missing ones', () => {
    expect(diaperPredictionsOf(predictions({}))?.wet?.medianGapMinutes).toBe(150);
    expect(diaperPredictionsOf(predictions(undefined))).toBeNull();
    expect(diaperPredictionsOf(predictions(null))).toBeNull();
    expect(
      diaperPredictionsOf(predictions({ wet: { ...WET, medianGapMinutes: 0 } }))?.wet,
    ).toBeNull();
    expect(
      diaperPredictionsOf(predictions({ wet: { ...WET, lowerGapMinutes: 200 } }))?.wet,
    ).toBeNull();
    expect(diaperPredictionsOf(predictions({ wet: { ...WET, anchorAt: 'soon' } }))?.wet).toBeNull();
    const badLag = { ...DIRTY, afterFeed: { ...DIRTY.afterFeed!, medianLagMinutes: 12.5 } };
    expect(diaperPredictionsOf(predictions({ dirty: badLag }))?.dirty?.afterFeed).toBeNull();
    expect(diaperPredictionsOf(predictions({ dirty: badLag }))?.dirty?.gap).not.toBeNull();
  });
});

describe('diaper contents', () => {
  it('reads wet as WET or MIXED and dirty as DIRTY or MIXED, leniently', () => {
    expect([' wet ', 'MIXED', 'DIRTY'].map((c) => isWetDiaper(change(at(9), c)))).toEqual([
      true,
      true,
      false,
    ]);
    expect(['dirty', 'MIXED', 'WET'].map((c) => isDirtyDiaper(change(at(9), c)))).toEqual([
      true,
      true,
      false,
    ]);
    expect(isWetDiaper(event(DIAPER.id, at(9), at(9), { content: 3 }))).toBe(false);
  });
});

describe('wetSuggestion', () => {
  it('shows from 20 min before the expected wet diaper until 40 min after it', () => {
    expect(wetSuggestion(input(at(15, 9)))).toBeNull();
    const shown = wetSuggestion(input(at(15, 10)));
    expect(shown).toMatchObject({ kind: 'wet', signal: 'gap', anchorAt: at(13).toISOString() });
    expect(shown?.window).toEqual({
      anchor: at(13),
      earliest: at(15, 10),
      expected: at(15, 30),
      latest: at(15, 50),
    });
    expect(wetSuggestion(input(at(16, 9)))).not.toBeNull();
    expect(wetSuggestion(input(at(16, 10)))).toBeNull();
  });

  it('re-anchors at a wet or mixed diaper logged since, which hides it', () => {
    const logged = [change(at(15), 'MIXED')];
    expect(wetSuggestion(input(at(15, 20), logged))).toBeNull();
    expect(wetSuggestion(input(at(17, 20), logged))?.anchorAt).toBe(at(15).toISOString());
    expect(wetSuggestion(input(at(15, 20), [change(at(15), 'DIRTY')]))).not.toBeNull();
    const deleted = { ...change(at(15), 'WET'), deletedAt: at(15, 5).toISOString() };
    expect(wetSuggestion(input(at(15, 20), [deleted]))).not.toBeNull();
  });

  it('is hidden without a wet estimate and for the anchor "Not now" was chosen for', () => {
    expect(wetSuggestion(input(at(15, 20), [], predictions({ wet: null })))).toBeNull();
    expect(wetSuggestion(input(at(15, 20), [], predictions(undefined)))).toBeNull();
    expect(wetSuggestion(input(at(15, 20), [], predictions({}), at(13).toISOString()))).toBeNull();
    const next = [change(at(15, 25), 'WET')];
    expect(
      wetSuggestion(input(at(17, 40), next, predictions({}), at(13).toISOString())),
    ).not.toBeNull();
  });

  it('keeps the expected time in elapsed minutes across a daylight saving change', () => {
    const anchor = new Date(Date.UTC(2026, 2, 8, 6, 30));
    const dto = predictions({ wet: { ...WET, anchorAt: anchor.toISOString() } });
    const shown = wetSuggestion(input(new Date(anchor.getTime() + 140 * 60_000), [], dto));
    expect(shown!.window.expected.getTime() - anchor.getTime()).toBe(150 * 60_000);
  });
});

describe('dirtySuggestion', () => {
  it('after a recent feed without a dirty diaper since, uses the usual lag', () => {
    const events = [feed(at(14), at(14, 20))];
    expect(dirtySuggestion(input(at(14, 34), events))).toBeNull();
    const shown = dirtySuggestion(input(at(14, 35), events));
    expect(shown).toMatchObject({
      kind: 'dirty',
      signal: 'afterFeed',
      anchorAt: at(14, 20).toISOString(),
    });
    expect(shown?.window).toEqual({
      anchor: at(14, 20),
      earliest: at(14, 50),
      expected: at(14, 55),
      latest: at(15, 0),
    });
  });

  it('counts an instant feed from its start and skips a running one', () => {
    expect(latestFeedEnd([feed(at(14), at(14))], TYPES, at(15))).toBe(at(14).getTime());
    expect(latestFeedEnd([feed(at(14), at(14, 10)), feed(at(14, 50), null)], TYPES, at(15))).toBe(
      at(14, 10).getTime(),
    );
  });

  it('falls back to the gaps once a dirty diaper came after the feed or the feed is old', () => {
    const handled = [feed(at(14), at(14, 20)), change(at(14, 40), 'MIXED')];
    expect(dirtySuggestion(input(at(14, 55), handled))).toBeNull();
    expect(dirtySuggestion(input(at(22, 30), handled))).toMatchObject({
      signal: 'gap',
      anchorAt: at(14, 40).toISOString(),
    });
    const oldFeed = [feed(at(11), at(11, 30))];
    expect(dirtySuggestion(input(at(15, 50), oldFeed))).toMatchObject({
      signal: 'gap',
      anchorAt: at(8).toISOString(),
    });
  });

  it('uses only the gaps without a lag signal, and nothing without either', () => {
    const noLag = predictions({ dirty: { ...DIRTY, afterFeed: null } });
    const events = [feed(at(14), at(14, 20))];
    expect(dirtySuggestion(input(at(14, 55), events, noLag))).toBeNull();
    expect(dirtySuggestion(input(at(15, 50), events, noLag))?.signal).toBe('gap');
    expect(dirtySuggestion(input(at(15, 50), events, predictions({ dirty: null })))).toBeNull();
    const lagOnly = predictions({ dirty: { ...DIRTY, gap: null } });
    expect(dirtySuggestion(input(at(15, 50), [], lagOnly))).toBeNull();
  });

  it('is hidden for the anchor "Not now" was chosen for', () => {
    const events = [feed(at(14), at(14, 20))];
    expect(
      dirtySuggestion(input(at(14, 55), events, predictions({}), at(14, 20).toISOString())),
    ).toBeNull();
  });
});
