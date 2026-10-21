import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import { EVENT_TYPES, DIAPER, FEEDING, BELLY, MEDICATION } from '../test/seed';
import { payloadSummary } from './payloadSummary';
import {
  describeTimes,
  filterByTypes,
  groupByDay,
  localDayKey,
  windowStart,
} from './timelineModel';

const local = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const NOW = new Date(2026, 9, 20, 15, 0);
const type = (id: string) => EVENT_TYPES.find((t) => t.id === id);

function event(overrides: Partial<BabyEvent>): BabyEvent {
  return {
    id: crypto.randomUUID(),
    babyId: 'baby-1',
    typeId: FEEDING,
    startedAt: local(20, 8),
    endedAt: null,
    payload: {},
    notes: null,
    createdBy: null,
    createdAt: local(20, 8),
    updatedAt: local(20, 8),
    deletedAt: null,
    ...overrides,
  };
}

describe('timelineModel', () => {
  it('starts the window at local midnight `days - 1` days ago', () => {
    expect(windowStart(1, NOW)).toBe(new Date(2026, 9, 20).toISOString());
    expect(windowStart(14, NOW)).toBe(new Date(2026, 9, 7).toISOString());
  });

  it('groups newest-first events by local day with Today / Yesterday labels', () => {
    const events = [
      event({ startedAt: local(20, 9) }),
      event({ startedAt: local(20, 0, 5) }),
      event({ startedAt: local(19, 23, 55) }),
      event({ startedAt: local(15, 12) }),
    ];
    const days = groupByDay(events, NOW);
    expect(days.map((d) => [d.key, d.events.length])).toEqual([
      ['2026-10-20', 2],
      ['2026-10-19', 1],
      ['2026-10-15', 1],
    ]);
    expect(days.slice(0, 2).map((d) => d.label)).toEqual(['Today', 'Yesterday']);
    expect(days[2].label).not.toMatch(/Today|Yesterday/);
    expect(localDayKey(local(19, 23, 55))).toBe('2026-10-19');
  });

  it('describes duration, instant and running times', () => {
    const feeding = type(FEEDING);
    expect(describeTimes(event({ endedAt: local(20, 8, 45) }), feeding)).toBe(
      '08:00 – 08:45 · 45m',
    );
    expect(describeTimes(event({ endedAt: local(20, 9, 30) }), feeding)).toBe(
      '08:00 – 09:30 · 1h 30m',
    );
    expect(describeTimes(event({ typeId: DIAPER, endedAt: local(20, 8) }), type(DIAPER))).toBe(
      '08:00',
    );
    expect(describeTimes(event({}), feeding)).toBe('Since 08:00');
  });

  it('filters by selected types, all when none is selected', () => {
    const events = [event({ typeId: FEEDING }), event({ typeId: DIAPER })];
    expect(filterByTypes(events, new Set())).toHaveLength(2);
    expect(filterByTypes(events, new Set([DIAPER])).map((e) => e.typeId)).toEqual([DIAPER]);
  });
});

describe('payloadSummary', () => {
  const bottleType = {
    ...type(FEEDING)!,
    fields: [
      {
        key: 'method',
        label: 'Method',
        kind: 'select' as const,
        isRequired: true,
        options: ['bottle'],
        min: null,
        max: null,
        unit: null,
      },
      {
        key: 'amount_ml',
        label: 'Amount',
        kind: 'number' as const,
        isRequired: false,
        options: [],
        min: 0,
        max: null,
        unit: 'ml',
      },
    ],
  };

  it('summarizes type fields with units', () => {
    expect(payloadSummary({ method: 'bottle', amount_ml: 120 }, bottleType)).toBe(
      'Bottle · 120 ml',
    );
  });

  it('shows the feeding keys of the API contract and keeps legacy payloads readable', () => {
    const breast = {
      ...bottleType,
      fields: [
        ...bottleType.fields,
        {
          key: 'breast_left_seconds',
          label: 'Left breast',
          kind: 'number' as const,
          isRequired: false,
          options: [],
          min: 0,
          max: null,
          unit: 's',
        },
      ],
    };
    expect(
      payloadSummary({ method: 'bottle', amount_ml: 90, breast_left_seconds: 300 }, breast),
    ).toBe('Bottle · 90 ml · 300 s');
    // An event stored before the key rename still shows its amount as an unknown value.
    expect(payloadSummary({ method: 'bottle', amount: 120 }, bottleType)).toBe(
      'Bottle · Amount 120',
    );
  });

  it('shows belly pain intensity out of its maximum', () => {
    expect(payloadSummary({ intensity: 4 }, type(BELLY))).toBe('Intensity 4/5');
  });

  it('shows diaper content and values the type does not describe', () => {
    expect(payloadSummary({ content: 'DIRTY' }, type(DIAPER))).toBe('Dirty');
    expect(payloadSummary({ content: 'WET', pauses: 2 }, { ...type(DIAPER)!, fields: [] })).toBe(
      'WET · Pauses 2',
    );
  });

  it('lists medication names, falling back to the catalog', () => {
    const payload = {
      medications: [
        { medicationId: 'm1', name: 'Colidis' },
        { medicationId: 'm2', name: '' },
      ],
    };
    const catalog = [
      {
        id: 'm2',
        babyId: 'baby-1',
        name: 'Puravit',
        defaultDosage: null,
        notes: null,
        isUsual: true,
        createdAt: local(1, 0),
      },
    ];
    expect(payloadSummary(payload, type(MEDICATION), catalog)).toBe('Colidis, Puravit');
  });

  it('is empty without payload', () => {
    expect(payloadSummary({}, type(FEEDING))).toBe('');
  });
});
