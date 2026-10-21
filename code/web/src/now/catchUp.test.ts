import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import { BUILT_IN_TYPES, DIAPER_T, FEEDING_T, SLEEP, event } from '../presets/presetFixtures';
import { catchUp } from './catchUp';
import { readLastSeenAt, writeLastSeenAt, clearAllLastSeen } from './lastSeen';

const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m, 0);
const iso = (h: number, m = 0) => at(h, m).toISOString();
const MEMBERS = [
  { userId: 'u-vini', displayName: 'Vini' },
  { userId: 'u-ana', displayName: '  ' },
];

let n = 0;
function logged(
  by: string | null,
  typeId: string,
  start: string,
  payload: Record<string, unknown>,
  end: string | null = start,
): BabyEvent {
  n += 1;
  return event({
    id: `e${n}`,
    typeId,
    startedAt: start,
    endedAt: end,
    payload,
    createdBy: by,
    createdAt: start,
  });
}

describe('catchUp', () => {
  const since = iso(8, 10);
  const ctx = { types: BUILT_IN_TYPES };

  it('summarises what each other caregiver logged since the last open', () => {
    const events = [
      logged('u-vini', SLEEP, iso(9), { kind: 'nap' }, iso(10)),
      logged('u-vini', SLEEP, iso(12, 12), { kind: 'nap' }, null),
      logged('u-vini', SLEEP, iso(10), { kind: 'woke_up' }),
      logged('u-vini', FEEDING_T, iso(10, 30), { method: 'bottle', amount_ml: 120 }),
      logged('u-vini', FEEDING_T, iso(12, 2), { method: 'bottle', amount_ml: 120 }),
      logged('u-vini', DIAPER_T, iso(11), { content: 'WET' }),
      logged('u-vini', DIAPER_T, iso(11, 30), { content: 'dirty' }),
      logged('u-vini', 'type-med', iso(11, 40), {
        medications: [
          { medicationId: 'm', name: 'Paracetamol', dose: { amount: 2.5, unit: 'ml' } },
        ],
      }),
      logged('u-vini', 'type-bath', iso(11, 45), {}),
    ];
    const result = catchUp(events, MEMBERS, since, at(12, 54), ctx);
    expect(result).toEqual({
      since,
      total: 9,
      groups: [
        {
          userId: 'u-vini',
          name: 'Vini',
          count: 9,
          lastAt: iso(12, 12),
          sleep: { count: 2, totalMinutes: 102, nightWakings: 0 },
          feeds: { count: 2, totalMl: 240, lastAt: iso(12, 2) },
          diapers: { count: 2, wet: 1, dirty: 1, mixed: 0 },
          medications: [
            {
              name: 'Paracetamol',
              dose: { amount: 2.5, unit: 'ml' },
              at: iso(11, 40),
              nextAllowedAt: null,
            },
          ],
          other: [{ typeId: 'type-bath', count: 1 }],
        },
      ],
    });
  });

  it('groups by person, most recent first; unknown names are null ("Someone")', () => {
    const events = [
      logged('u-vini', DIAPER_T, iso(9), { content: 'WET' }),
      logged('u-ana', DIAPER_T, iso(10), { content: 'WET' }),
      logged('u-gone', DIAPER_T, iso(11), { content: 'MIXED' }),
    ];
    const result = catchUp(events, MEMBERS, since, at(12), ctx)!;
    expect(result.groups.map((g) => [g.userId, g.name])).toEqual([
      ['u-gone', null],
      ['u-ana', null],
      ['u-vini', 'Vini'],
    ]);
    expect(
      catchUp(events, undefined, since, at(12), ctx)!.groups.every((g) => g.name === null),
    ).toBe(true);
  });

  it('leaves out own, unsynced, deleted, older and future-created events', () => {
    const events = [
      logged(null, DIAPER_T, iso(9), { content: 'WET' }),
      logged('u-me', DIAPER_T, iso(9), { content: 'WET' }),
      { ...logged('u-vini', DIAPER_T, iso(9), { content: 'WET' }), deletedAt: iso(9) },
      logged('u-vini', DIAPER_T, iso(8), { content: 'WET' }),
      logged('u-vini', DIAPER_T, iso(13), { content: 'WET' }),
    ];
    expect(catchUp(events, MEMBERS, since, at(12), { ...ctx, selfUserId: 'u-me' })).toBeNull();
  });

  it('is null on the first open', () => {
    const events = [logged('u-vini', DIAPER_T, iso(9), { content: 'WET' })];
    expect(catchUp(events, MEMBERS, null, at(12), ctx)).toBeNull();
  });

  it('counts night wakings apart from sleep sessions', () => {
    const events = [logged('u-ana', SLEEP, iso(9), { kind: 'night_waking' }, iso(9, 20))];
    expect(catchUp(events, MEMBERS, since, at(12), ctx)!.groups[0].sleep).toEqual({
      count: 0,
      totalMinutes: 0,
      nightWakings: 1,
    });
  });
});

describe('lastSeen storage', () => {
  it('reads back what was written, per baby, and clears', () => {
    expect(readLastSeenAt('b1')).toBeNull();
    writeLastSeenAt('b1', iso(8));
    writeLastSeenAt('b2', iso(9));
    expect(readLastSeenAt('b1')).toBe(iso(8));
    clearAllLastSeen();
    expect(readLastSeenAt('b2')).toBeNull();
  });

  it('ignores a value that is not a time', () => {
    window.localStorage.setItem('baby-routine.last-seen.b1', 'nonsense');
    expect(readLastSeenAt('b1')).toBeNull();
  });
});
