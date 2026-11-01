import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, DIAPER, FEEDING, BELLY, MEDICATION } from '../test/seed';
import { payloadSummary } from './payloadSummary';
import { localDayKey } from './timelineModel';

const local = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const type = (id: string) => EVENT_TYPES.find((t) => t.id === id);

describe('localDayKey', () => {
  it('is the local calendar day of a UTC timestamp', () => {
    expect(localDayKey(local(19, 23, 55))).toBe('2026-10-19');
    expect(localDayKey(local(20, 0, 5))).toBe('2026-10-20');
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

  it('never shows the assistant marker members as details', () => {
    const marked = {
      method: 'bottle',
      amount_ml: 120,
      via: 'alexa',
      updated_via: 'alexa',
      delete_requested_via: 'alexa',
      delete_requested_at: '2026-10-25T21:43:22.160Z',
    };
    expect(payloadSummary(marked, bottleType)).toBe('Bottle · 120 ml');
    expect(payloadSummary({ via: 'mcp' }, type(DIAPER))).toBe('');
    expect(payloadSummary({ kind: 'woke_up', via: 'alexa' }, undefined)).toBe('woke_up');
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
    ).toBe('Bottle · 90 ml · 5m');
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
