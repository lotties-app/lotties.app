import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventPayload } from '../db/models';
import { compareFormulas } from '../insights/formulaComparison';
import { feedsByDay } from '../insights/feedingModel';
import { lastDays } from '../insights/days';
import { catchUp } from '../now/catchUp';
import { lastAndLogTiles } from '../now/quickLog';
import { tileDetailText } from '../now/tileText';
import { payloadSummary } from '../timeline/payloadSummary';
import { FEEDING_TYPE } from '../test/builtInTypes';
import {
  drunkChoices,
  drunkMl,
  leftOverMl,
  preparedMl,
  withoutRedundantDrunk,
} from './bottleAmounts';
import { bottleSuggestions, recentBottleAmounts } from './bottleSuggestions';
import { buildPayload, formProblems, type EventFormState } from './formModel';
import { validatePayload } from './payloadRules';

/*
 * Two amounts per bottle (docs/design/20-feeding-amounts.md): totals and suggestions read the
 * DRUNK one; a bottle without it was fully drunk.
 */

const NOW = new Date(2026, 9, 21, 15, 0);
const at = (hour: number, minute = 0) => new Date(2026, 9, 21, hour, minute).toISOString();
let seq = 0;

function bottle(start: string, payload: EventPayload, extra: Partial<BabyEvent> = {}): BabyEvent {
  seq += 1;
  return {
    id: `d-${seq}`,
    babyId: 'b1',
    typeId: FEEDING_TYPE.id,
    startedAt: start,
    endedAt: start,
    payload: { method: 'bottle', ...payload },
    notes: null,
    createdBy: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
    ...extra,
  };
}

describe('drunkMl', () => {
  it('is the drunk amount, never above the prepared one', () => {
    expect(drunkMl({ amount_ml: 120, amount_drunk_ml: 80 })).toBe(80);
    expect(drunkMl({ amount_ml: 120, amount_drunk_ml: 200 })).toBe(120);
    expect(drunkMl({ amount_ml: 120, amount_drunk_ml: 0 })).toBe(0);
  });

  it('counts a bottle without a drunk amount as fully drunk (every older bottle)', () => {
    expect(drunkMl({ amount_ml: 120 })).toBe(120);
    expect(drunkMl({ amount_ml: 120, amount_drunk_ml: null })).toBe(120);
    expect(drunkMl({ amount_ml: 120, amount_drunk_ml: '60' })).toBe(120);
  });

  it('has no amount without a valid number', () => {
    expect(drunkMl({})).toBeUndefined();
    expect(drunkMl({ amount_ml: '120' })).toBeUndefined();
    expect(drunkMl({ amount_ml: -5 })).toBeUndefined();
    expect(preparedMl({ amount_ml: 90 })).toBe(90);
    expect(leftOverMl({ amount_ml: 120, amount_drunk_ml: 80 })).toBe(40);
    expect(leftOverMl({ amount_ml: 120 })).toBe(0);
  });

  it('stores "all" as no drunk amount', () => {
    expect(withoutRedundantDrunk({ amount_ml: 120, amount_drunk_ml: 120 })).toEqual({
      amount_ml: 120,
    });
    expect(withoutRedundantDrunk({ amount_ml: 120, amount_drunk_ml: 80 })).toEqual({
      amount_ml: 120,
      amount_drunk_ml: 80,
    });
  });
});

describe('drunkChoices', () => {
  it('offers all, 3/4, half and 1/4 of the prepared amount, ascending', () => {
    expect(drunkChoices(120)).toEqual([
      { ml: 30, share: 'quarter' },
      { ml: 60, share: 'half' },
      { ml: 90, share: 'threeQuarters' },
      { ml: 120, share: 'all' },
    ]);
  });

  it('rounds the fractions to 5 ml and keeps each amount once', () => {
    expect(drunkChoices(90).map((c) => c.ml)).toEqual([25, 45, 70, 90]);
    expect(drunkChoices(10).map((c) => [c.ml, c.share])).toEqual([
      [5, 'half'],
      [10, 'all'],
    ]);
  });

  it('offers nothing without a prepared amount', () => {
    expect(drunkChoices(null)).toEqual([]);
    expect(drunkChoices(0)).toEqual([]);
    expect(drunkChoices(Number.NaN)).toEqual([]);
  });
});

describe('totals read the drunk amount', () => {
  it('insights: the bottle ml of a day', () => {
    const events = [
      bottle(at(8), { amount_ml: 120, amount_drunk_ml: 80 }),
      bottle(at(11), { amount_ml: 100 }),
      bottle(at(13), { amount_ml: 90, amount_drunk_ml: 0 }),
    ];
    const [today] = feedsByDay(events, [FEEDING_TYPE], lastDays(NOW, 1), NOW);
    expect(today.feeds).toBe(3);
    expect(today.bottleMl).toBe(180);
  });

  it('formula comparison: ml per day', () => {
    const events: BabyEvent[] = [];
    for (let back = 9; back >= 0; back--) {
      for (let i = 0; i < 3; i++) {
        const start = new Date(2026, 9, 21 - back, 8 + i * 4).toISOString();
        events.push(
          bottle(start, {
            bottle_feeding_type: 'formula',
            formula_id: 'a',
            amount_ml: 120,
            amount_drunk_ml: 90,
          }),
        );
      }
    }
    const result = compareFormulas({
      events,
      types: [FEEDING_TYPE],
      formulas: [],
      weights: [],
      now: NOW,
    });
    expect(result.qualified[0].metrics.mlPerDay).toBe(270);
  });

  it('hand-over summary: ml others fed', () => {
    const since = at(6);
    const logged = (hour: number, payload: EventPayload) =>
      bottle(at(hour), payload, { createdBy: 'u-ana', createdAt: at(hour) });
    const result = catchUp(
      [logged(9, { amount_ml: 120, amount_drunk_ml: 70 }), logged(11, { amount_ml: 60 })],
      [{ userId: 'u-ana', displayName: 'Ana' }],
      since,
      NOW,
      { types: [FEEDING_TYPE] },
    );
    expect(result?.groups[0].feeds.totalMl).toBe(130);
  });
});

describe('bottle suggestions read the drunk amount', () => {
  const history = (...amounts: { prepared: number; drunk?: number }[]) =>
    amounts.map((a, i) =>
      bottle(new Date(NOW.getTime() - (i + 1) * 3 * 3_600_000).toISOString(), {
        amount_ml: a.prepared,
        ...(a.drunk !== undefined ? { amount_drunk_ml: a.drunk } : {}),
      }),
    );

  it('the recent amounts are what was drunk (fully drunk bottles keep theirs)', () => {
    const events = history(
      { prepared: 120, drunk: 80 },
      { prepared: 100 },
      { prepared: 90, drunk: 0 },
    );
    expect(recentBottleAmounts(events, NOW, FEEDING_TYPE.id)).toEqual([80, 100]);
  });

  it('the typical amount follows the drunk amounts', () => {
    const suggestions = bottleSuggestions({
      events: history(
        { prepared: 120, drunk: 80 },
        { prepared: 120, drunk: 80 },
        { prepared: 120, drunk: 80 },
      ),
      feedingTypeId: FEEDING_TYPE.id,
      birthDate: null,
      now: NOW,
      include: null,
    });
    expect(suggestions.source).toBe('history');
    expect(suggestions.preferred).toBe(80);
  });
});

describe('display', () => {
  it('reads "80 of 120 ml" when less than prepared was drunk, "120 ml" otherwise', () => {
    expect(
      payloadSummary({ method: 'bottle', amount_ml: 120, amount_drunk_ml: 80 }, FEEDING_TYPE),
    ).toBe('Bottle · 80 of 120 ml');
    expect(payloadSummary({ method: 'bottle', amount_ml: 120 }, FEEDING_TYPE)).toBe(
      'Bottle · 120 ml',
    );
    expect(
      payloadSummary({ method: 'bottle', amount_ml: 120, amount_drunk_ml: 120 }, FEEDING_TYPE),
    ).toBe('Bottle · 120 ml');
  });

  it('says a feeding was stopped by sleep', () => {
    expect(payloadSummary({ method: 'breast', ended_by: 'sleep' }, FEEDING_TYPE)).toContain(
      'Stopped when sleep started',
    );
  });

  it('the Feed tile shows what was drunk of what was prepared', () => {
    const [feed] = lastAndLogTiles(
      [FEEDING_TYPE],
      [bottle(at(12), { amount_ml: 120, amount_drunk_ml: 80 })],
      NOW,
    );
    expect(tileDetailText(feed, [FEEDING_TYPE])).toBe('Bottle · 80 of 120 ml');
  });
});

describe('rules', () => {
  const form = (values: Record<string, string>): EventFormState => ({
    typeId: FEEDING_TYPE.id,
    startedAt: '2026-10-21T10:00',
    endedAt: '',
    notes: '',
    values: { method: 'bottle', ...values },
    medications: {},
  });

  it('the server rule is mirrored: drunk above prepared is a problem on the drunk field', () => {
    expect(
      validatePayload(
        FEEDING_TYPE,
        { method: 'bottle', amount_ml: 100, amount_drunk_ml: 130 },
        true,
      ),
    ).toEqual([{ field: 'amount_drunk_ml', code: 'max' }]);
    expect(
      validatePayload(
        FEEDING_TYPE,
        { method: 'bottle', amount_ml: 100, amount_drunk_ml: 100 },
        true,
      ),
    ).toEqual([]);
    // A custom type that happens to use the same keys is not the built-in rule.
    const custom = { ...FEEDING_TYPE, babyId: 'b1' };
    expect(
      validatePayload(custom, { method: 'bottle', amount_ml: 100, amount_drunk_ml: 130 }, true),
    ).toEqual([]);
  });

  it('the form names the problem under the drunk amount', () => {
    const problems = formProblems(form({ amount_ml: '100', amount_drunk_ml: '130' }), FEEDING_TYPE);
    expect(problems.map((p) => p.field)).toEqual(['amount_drunk_ml']);
    expect(formProblems(form({ amount_ml: '100', amount_drunk_ml: '60' }), FEEDING_TYPE)).toEqual(
      [],
    );
  });

  it('the payload keeps a smaller drunk amount and drops "all"', () => {
    expect(buildPayload(form({ amount_ml: '120', amount_drunk_ml: '80' }), FEEDING_TYPE)).toEqual({
      method: 'bottle',
      amount_ml: 120,
      amount_drunk_ml: 80,
    });
    expect(buildPayload(form({ amount_ml: '120', amount_drunk_ml: '120' }), FEEDING_TYPE)).toEqual({
      method: 'bottle',
      amount_ml: 120,
    });
  });
});
