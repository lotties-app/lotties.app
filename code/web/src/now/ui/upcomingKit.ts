import type { UpcomingItem } from '../upcoming';

/*
 * Test kit of the "next up" layer (ring, ruler, list, previews): ready-made items at fixed local
 * times of 2026-10-21, as `upcomingToday` returns them.
 */

export const upAt = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m);

export function bottleItem(at: Date, over: Partial<UpcomingItem> = {}): UpcomingItem {
  return {
    key: 'feed',
    kind: 'feed',
    at,
    windowStart: new Date(at.getTime() - 30 * 60_000),
    windowEnd: new Date(at.getTime() + 30 * 60_000),
    confidence: 'medium',
    amountMl: { low: 110, typical: 120, high: 140 },
    basis: {
      kind: 'feed',
      time: { kind: 'prediction', samples: 24 },
      method: 'bottle',
      dayPart: 'afternoon',
      due: false,
      amount: {
        kind: 'dayPart',
        dayPart: 'afternoon',
        samples: 9,
        days: 14,
        byPart: [
          { dayPart: 'afternoon', typicalMl: 120, samples: 9 },
          { dayPart: 'night', typicalMl: 100, samples: 5 },
        ],
      },
    },
    ...over,
  };
}

export function wetItem(at: Date, over: Partial<UpcomingItem> = {}): UpcomingItem {
  return {
    key: 'diaperWet',
    kind: 'diaperWet',
    at,
    windowStart: new Date(at.getTime() - 20 * 60_000),
    windowEnd: new Date(at.getTime() + 20 * 60_000),
    confidence: 'medium',
    basis: {
      kind: 'diaper',
      signal: 'gap',
      medianMinutes: 150,
      samples: 30,
      daily: false,
      due: false,
    },
    ...over,
  };
}

export function dirtyItem(at: Date, over: Partial<UpcomingItem> = {}): UpcomingItem {
  return {
    key: 'diaperDirty',
    kind: 'diaperDirty',
    at,
    windowStart: new Date(at.getTime() - 60 * 60_000),
    windowEnd: new Date(at.getTime() + 60 * 60_000),
    confidence: 'low',
    basis: {
      kind: 'diaper',
      signal: 'gap',
      medianMinutes: 1440,
      samples: 5,
      daily: true,
      due: false,
    },
    ...over,
  };
}

export function bellyItem(at: Date, over: Partial<UpcomingItem> = {}): UpcomingItem {
  return {
    key: 'bellyPain',
    kind: 'bellyPain',
    at,
    windowStart: new Date(at.getTime() - 30 * 60_000),
    windowEnd: new Date(at.getTime() + 60 * 60_000),
    confidence: 'high',
    basis: { kind: 'pattern', typicalClock: '18:30', days: 6, due: false },
    ...over,
  };
}

export function medicineItem(
  at: Date,
  name = 'Vitamin D',
  over: Partial<UpcomingItem> = {},
): UpcomingItem {
  return {
    key: `medicine-rx-${at.getTime()}`,
    kind: 'medicine',
    at,
    confidence: 'high',
    basis: { kind: 'medicine', name, prescriptionId: 'rx', schedule: 'time' },
    ...over,
  };
}

/** A busy afternoon at 14:00: a bottle, a wet diaper, belly pain, a poop and a dose. */
export function busyAfternoon(): UpcomingItem[] {
  return [
    bottleItem(upAt(16, 10)),
    wetItem(upAt(16, 40)),
    bellyItem(upAt(18, 30)),
    dirtyItem(upAt(19, 0)),
    medicineItem(upAt(20, 0)),
  ];
}
