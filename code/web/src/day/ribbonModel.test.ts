import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import { BELLY_MASSAGE_TYPE, DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { dayBounds, isCategoryShown, summarizeDay, toggleShown } from './dayModel';
import { ribbonCategories, ribbonModel, visibleRibbon } from './ribbonModel';

const types = [FEEDING_TYPE, SLEEP_TYPE, DIAPER_TYPE];
const local = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const bounds = dayBounds(new Date(2026, 9, 20));
const NOW = new Date(2026, 9, 21, 9);

let counter = 0;
function event(overrides: Partial<BabyEvent>): BabyEvent {
  counter += 1;
  return {
    id: `e${counter}`,
    babyId: 'baby-1',
    typeId: FEEDING_TYPE.id,
    startedAt: local(20, 8),
    endedAt: local(20, 8),
    payload: {},
    notes: null,
    createdBy: null,
    createdAt: local(20, 8),
    updatedAt: local(20, 8),
    deletedAt: null,
    ...overrides,
  };
}

const sleep = (start: string, end: string | null, kind = 'nap') =>
  event({ typeId: SLEEP_TYPE.id, startedAt: start, endedAt: end, payload: { kind } });

describe('ribbonModel', () => {
  it('puts naps, nights and wakings in the sleep lane, cut to the day', () => {
    const model = ribbonModel(
      [
        sleep(local(19, 20), local(20, 6), 'night'),
        sleep(local(20, 2), local(20, 2, 30), 'night_waking'),
        sleep(local(20, 12), local(20, 13, 30)),
      ],
      types,
      bounds,
      NOW,
    );
    expect(model.blocks.map((block) => block.kind)).toEqual(['night', 'nap', 'nightWaking']);
    expect(model.blocks[0]).toMatchObject({ from: 0, to: 0.25, category: 'sleep' });
    // The length is the whole night, not the part inside the day.
    expect(model.blocks[0].durationMs).toBe(10 * 3_600_000);
    expect(model.blocks[2].category).toBe('nightWaking');
    expect(model.marks).toEqual([]);
  });

  it('marks woke-up and bedtime in the sleep lane and every other event in the events lane', () => {
    const model = ribbonModel(
      [
        sleep(local(20, 6, 30), local(20, 6, 30), 'woke_up'),
        event({ startedAt: local(20, 18) }),
        event({ typeId: DIAPER_TYPE.id, startedAt: local(20, 12), payload: { content: 'WET' } }),
        event({ startedAt: local(19, 23) }),
        event({ startedAt: local(20, 10), deletedAt: local(20, 11) }),
      ],
      types,
      bounds,
      NOW,
    );
    expect(model.marks.map((mark) => [mark.lane, mark.category, mark.at])).toEqual([
      ['sleep', 'sleep', (6 * 60 + 30) / 1440],
      ['events', 'diaper', 0.5],
      ['events', 'feeding', 0.75],
    ]);
  });

  it('draws a running sleep until now', () => {
    const model = ribbonModel(
      [sleep(local(20, 14), null)],
      types,
      bounds,
      new Date(2026, 9, 20, 15),
    );
    expect(model.blocks[0]).toMatchObject({ running: true, from: 14 / 24, to: 15 / 24 });
  });

  it('hides categories the filter leaves out; night wakings go with sleep', () => {
    const model = ribbonModel(
      [sleep(local(20, 2), local(20, 2, 30), 'night_waking'), event({ startedAt: local(20, 18) })],
      types,
      bounds,
      NOW,
    );
    expect([...ribbonCategories(model)].sort()).toEqual(['feeding', 'nightWaking']);
    const onlyFeeding = visibleRibbon(model, (category) =>
      isCategoryShown(new Set(['feeding']), category),
    );
    expect(onlyFeeding.blocks).toEqual([]);
    expect(onlyFeeding.marks).toHaveLength(1);
    const onlySleep = visibleRibbon(model, (category) => category === 'sleep');
    expect(onlySleep.blocks).toHaveLength(1);
    expect(onlySleep.marks).toEqual([]);
  });

  it('marks a belly massage in the events lane under health, shown by the health filter', () => {
    const massage = event({
      typeId: BELLY_MASSAGE_TYPE.id,
      startedAt: local(20, 18),
      endedAt: local(20, 18, 10),
      payload: { reason: 'gas', helped: 'yes' },
    });
    const model = ribbonModel([massage], [...types, BELLY_MASSAGE_TYPE], bounds, NOW);
    expect(model.marks.map((mark) => [mark.lane, mark.category])).toEqual([['events', 'health']]);
    const onlyHealth = visibleRibbon(model, (category) =>
      isCategoryShown(new Set(['health']), category),
    );
    expect(onlyHealth.marks).toHaveLength(1);
    expect(
      visibleRibbon(model, (category) => isCategoryShown(new Set(['feeding']), category)).marks,
    ).toEqual([]);
  });
});

describe('the legend toggles the Day filter', () => {
  const all = ['sleep', 'feeding', 'diaper'] as const;

  it('hides one category from "everything" by selecting the others', () => {
    expect([...toggleShown(new Set(), 'feeding', all)]).toEqual(['sleep', 'diaper']);
  });

  it('shows a hidden category again and goes back to "everything" when all are shown', () => {
    const next = toggleShown(new Set(['sleep']), 'diaper', all);
    expect([...next].sort()).toEqual(['diaper', 'sleep']);
    expect(toggleShown(next, 'feeding', all).size).toBe(0);
  });

  it('never hides every category: hiding the last one shows everything', () => {
    expect(toggleShown(new Set(['sleep']), 'sleep', all).size).toBe(0);
  });

  it('treats an empty selection as everything shown', () => {
    expect(isCategoryShown(new Set(), 'health')).toBe(true);
    expect(isCategoryShown(new Set(['sleep']), 'health')).toBe(false);
  });
});

describe('summarizeDay naps', () => {
  it('counts the naps that started on the day, not nights or wakings', () => {
    const summary = summarizeDay(
      [
        sleep(local(19, 20), local(20, 6), 'night'),
        sleep(local(20, 9), local(20, 10)),
        sleep(local(20, 13), local(20, 14)),
        sleep(local(20, 2), local(20, 2, 30), 'night_waking'),
      ],
      types,
      bounds,
      NOW,
    );
    expect(summary.naps).toBe(2);
  });
});
