import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventPayload, EventType } from '../db/models';
import {
  BUILT_IN_TYPES,
  DIAPER_T,
  event,
  eventType,
  FEEDING_T,
  SLEEP,
} from '../presets/presetFixtures';
import { presetsForBaby } from '../presets/resolve';
import type { Preset } from '../presets/types';
import { moreTileMatches, orderMoreTypes } from './moreOrder';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const DAY = 24 * 3_600_000;
const ME = 'u-me';

const SMALL_TYPES = BUILT_IN_TYPES.filter((t) =>
  ['sleep', 'feeding', 'diaper', 'bath', 'tummy_time', 'medication'].includes(t.key),
);
const presets = (types: EventType[] = SMALL_TYPES) => presetsForBaby(types);
const ids = (list: readonly Preset[]) => list.map((p) => p.id);

let counter = 0;
function logged(
  typeId: string,
  daysAgo: number,
  payload: EventPayload = {},
  extra: Partial<BabyEvent> = {},
): BabyEvent {
  counter += 1;
  const at = new Date(NOW.getTime() - daysAgo * DAY).toISOString();
  return event({
    id: `e-${counter}`,
    typeId,
    startedAt: at,
    endedAt: at,
    payload,
    createdBy: ME,
    createdAt: at,
    ...extra,
  });
}
const times = (n: number, make: () => BabyEvent) => Array.from({ length: n }, make);

describe('moreTileMatches', () => {
  it.each([
    ['', 'Bath', true],
    ['   ', 'Bath', true],
    ['BAT', 'Bath', true],
    ['ath', 'Bath', true],
    ['time tummy', 'Tummy time', true],
    ['agua', 'Água', true],
    ['ÁGUA', 'agua', true],
    ['remedio', 'Remédio', true],
    ['dor barriga', 'Dor de barriga', true],
    ['bath x', 'Bath', false],
    ['nap', 'Bath', false],
  ])('%j in %j: %s', (query, name, expected) => {
    expect(moreTileMatches(query, name)).toBe(expected);
  });
});

describe('orderMoreTypes', () => {
  it('is alphabetical by English name without history, the Custom link last', () => {
    const order = orderMoreTypes(presets(), [], ME, NOW, 'en');
    expect(ids(order)).toEqual([
      'bath',
      'bedtime',
      'bottle',
      'diaper',
      'fell_asleep',
      'medication',
      'nap',
      'night_waking',
      'nursing',
      'tummy_time',
      'wake_up',
      'custom',
    ]);
  });

  it('sorts pt-BR names accent-insensitively and numerically', () => {
    const names: Record<string, string> = {
      bath: 'Banho',
      bedtime: 'Hora de dormir',
      bottle: 'Mamadeira',
      diaper: 'Fralda',
      fell_asleep: 'Adormeceu',
      medication: 'Remédio',
      nap: 'Soneca',
      night_waking: 'Despertar noturno',
      nursing: 'Amamentação',
      tummy_time: 'Bruços',
      wake_up: 'Acordou',
      custom: 'Personalizado',
    };
    const custom = [
      eventType({ id: 'c-agua', key: 'agua', name: 'Água', babyId: 'b' }),
      eventType({ id: 'c-10', key: 'v10', name: 'Vitamina 10', babyId: 'b' }),
      eventType({ id: 'c-2', key: 'v2', name: 'Vitamina 2', babyId: 'b' }),
      eventType({ id: 'c-eb', key: 'ebano', name: 'ébano', babyId: 'b' }),
    ];
    const order = orderMoreTypes(
      presets([...SMALL_TYPES, ...custom]),
      [],
      ME,
      NOW,
      'pt-BR',
      (p) => names[p.id] ?? p.label,
    );
    expect(order.map((p) => names[p.id] ?? p.label)).toEqual([
      'Acordou',
      'Adormeceu',
      'Água',
      'Amamentação',
      'Banho',
      'Bruços',
      'Despertar noturno',
      'ébano',
      'Fralda',
      'Hora de dormir',
      'Mamadeira',
      'Remédio',
      'Soneca',
      'Vitamina 2',
      'Vitamina 10',
      'Personalizado',
    ]);
  });

  it('promotes a tile only from two uses in the window', () => {
    const one = orderMoreTypes(presets(), [logged(DIAPER_T, 1)], ME, NOW, 'en');
    expect(ids(one)[0]).toBe('bath');
    const two = orderMoreTypes(
      presets(),
      times(2, () => logged(DIAPER_T, 1)),
      ME,
      NOW,
      'en',
    );
    expect(ids(two)[0]).toBe('diaper');
    expect(ids(two).slice(1, 4)).toEqual(['bath', 'bedtime', 'bottle']);
  });

  it('ignores events older than 60 days', () => {
    const old = times(5, () => logged(DIAPER_T, 61));
    expect(ids(orderMoreTypes(presets(), old, ME, NOW, 'en'))[0]).toBe('bath');
  });

  it('counts the last 14 days double, then by score', () => {
    const events = [
      // Bath: 3 old uses = 3. Diaper: 2 recent uses = 4. Tummy time: 2 old = 2.
      ...times(3, () => logged('type-bath', 30)),
      ...times(2, () => logged(DIAPER_T, 3)),
      ...times(2, () => logged('type-tummy', 40)),
    ];
    expect(ids(orderMoreTypes(presets(), events, ME, NOW, 'en')).slice(0, 4)).toEqual([
      'diaper',
      'bath',
      'tummy_time',
      'bedtime',
    ]);
  });

  it('breaks score ties by name', () => {
    const events = [
      ...times(2, () => logged('type-tummy', 2)),
      ...times(2, () => logged('type-bath', 2)),
    ];
    expect(ids(orderMoreTypes(presets(), events, ME, NOW, 'en')).slice(0, 2)).toEqual([
      'bath',
      'tummy_time',
    ]);
  });

  it('counts each tile of a shared type by its payload (Nap vs Wake-up, Bottle vs Nursing)', () => {
    const events = [
      ...times(3, () => logged(SLEEP, 1, { kind: 'nap' })),
      ...times(2, () => logged(FEEDING_T, 1, { method: 'breast' })),
      logged(SLEEP, 1, { kind: 'woke_up' }),
    ];
    expect(ids(orderMoreTypes(presets(), events, ME, NOW, 'en')).slice(0, 3)).toEqual([
      'nap',
      'nursing',
      'bath',
    ]);
  });

  it('promotes custom types like the built-ins', () => {
    const custom = eventType({ id: 'c-x', key: 'x', name: 'Zinc drops', babyId: 'b' });
    const events = times(2, () => logged('c-x', 1));
    const order = orderMoreTypes(presets([...SMALL_TYPES, custom]), events, ME, NOW, 'en');
    expect(ids(order)[0]).toBe('type:c-x');
    expect(ids(order).at(-1)).toBe('custom');
  });

  it("ignores other members' and deleted events", () => {
    const events = [
      ...times(5, () => logged(DIAPER_T, 1, {}, { createdBy: 'u-other' })),
      ...times(5, () => logged('type-bath', 1, {}, { deletedAt: NOW.toISOString() })),
    ];
    expect(ids(orderMoreTypes(presets(), events, ME, NOW, 'en'))).toEqual(
      ids(orderMoreTypes(presets(), [], ME, NOW, 'en')),
    );
  });

  it('counts unsynced events (no author yet) as the person, and only those without a user id', () => {
    const events = [
      ...times(2, () => logged(DIAPER_T, 1, {}, { createdBy: null })),
      ...times(3, () => logged('type-bath', 1)),
    ];
    expect(ids(orderMoreTypes(presets(), events, ME, NOW, 'en')).slice(0, 2)).toEqual([
      'bath',
      'diaper',
    ]);
    expect(ids(orderMoreTypes(presets(), events, null, NOW, 'en')).slice(0, 2)).toEqual([
      'diaper',
      'bath',
    ]);
    expect(ids(orderMoreTypes(presets(), events, undefined, NOW, 'en'))[1]).toBe('bath');
  });

  it('is stable: the same input in any event order gives the same order', () => {
    const events = [
      ...times(2, () => logged('type-tummy', 2)),
      ...times(2, () => logged('type-bath', 2)),
      ...times(4, () => logged(DIAPER_T, 20)),
    ];
    const first = ids(orderMoreTypes(presets(), events, ME, NOW, 'en'));
    const reversed = ids(orderMoreTypes(presets(), [...events].reverse(), ME, NOW, 'en'));
    const shuffledTypes = ids(
      orderMoreTypes(presets([...SMALL_TYPES].reverse()), events, ME, NOW, 'en'),
    );
    expect(reversed).toEqual(first);
    expect(shuffledTypes).toEqual(first);
  });
});
