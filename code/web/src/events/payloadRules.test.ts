import { describe, expect, it } from 'vitest';
import type { EventFieldDefinition, EventType } from '../db/models';
import { fromEventTypeDto } from '../sync/contract';
import {
  BELLY_MASSAGE_TYPE,
  FEEDING_DTO,
  FEEDING_TYPE,
  NASAL_SUCTION_TYPE,
  SLEEP_TYPE,
} from '../test/builtInTypes';
import {
  isComplete,
  isFieldVisible,
  validatePayload,
  visibleFields,
  withoutHiddenValues,
} from './payloadRules';

const field = (
  overrides: Partial<EventFieldDefinition> & { key: string },
): EventFieldDefinition => ({
  label: overrides.key,
  kind: 'text',
  isRequired: false,
  options: [],
  min: null,
  max: null,
  unit: null,
  visibleWhen: null,
  ...overrides,
});

const typeWith = (...fields: EventFieldDefinition[]): Pick<EventType, 'fields'> => ({ fields });
const keys = (fields: EventFieldDefinition[]) => fields.map((f) => f.key);

describe('the built-in feeding definition from the API', () => {
  it('maps visibleWhen from the wire shape', () => {
    expect(FEEDING_TYPE.fields.find((f) => f.key === 'side')?.visibleWhen).toEqual({
      field: 'method',
      equals: ['breast'],
    });
    expect(FEEDING_TYPE.fields.find((f) => f.key === 'method')?.visibleWhen).toBeNull();
  });

  it('ignores malformed conditions instead of hiding the field', () => {
    const type = fromEventTypeDto({
      ...FEEDING_DTO,
      fields: [{ key: 'x', label: 'X', kind: 'text', visibleWhen: { field: 3 } as never }],
    });
    expect(type.fields[0].visibleWhen).toBeNull();
  });

  it.each([
    [{}, ['method']],
    [{ method: 'breast' }, ['method', 'side', 'breast_left_seconds', 'breast_right_seconds']],
    [{ method: 'bottle' }, ['method', 'amount_ml', 'amount_drunk_ml', 'bottle_feeding_type']],
    [{ method: 'solid' }, ['method', 'food']],
  ])('shows only the fields of the chosen method %j', (payload, shown) => {
    const valueOf = (key: string) => (payload as Record<string, unknown>)[key];
    const forms = visibleFields(FEEDING_TYPE.fields, valueOf).filter((f) => f.hidden !== true);
    expect(keys(forms)).toEqual(shown);
  });

  it('declares the pause keys as hidden whole numbers', () => {
    const pause = FEEDING_TYPE.fields.filter((f) => f.key.startsWith('pause'));
    expect(pause.map((f) => f.key)).toEqual(['pause_count', 'paused_seconds', 'paused_at']);
    expect(pause.every((f) => f.hidden === true)).toBe(true);
    expect(FEEDING_TYPE.fields.find((f) => f.key === 'pause_count')?.integer).toBe(true);
  });
});

describe('the built-in nasal suction definition from the API', () => {
  it('shows the optional tool and saline fields', () => {
    const forms = visibleFields(NASAL_SUCTION_TYPE.fields, () => undefined);
    expect(forms.map((f) => [f.key, f.kind, f.isRequired])).toEqual([
      ['tool', 'select', false],
      ['saline', 'bool', false],
    ]);
  });

  it.each([{}, { tool: 'bulb', saline: true }, { tool: 'electric' }, { saline: false }])(
    'accepts %j like the API',
    (payload) => {
      expect(validatePayload(NASAL_SUCTION_TYPE, payload, true)).toEqual([]);
    },
  );

  it('rejects an unknown or differently cased tool and a non-boolean saline like the API', () => {
    expect(validatePayload(NASAL_SUCTION_TYPE, { tool: 'syringe' }, true)).toEqual([
      { field: 'tool', code: 'option' },
    ]);
    expect(validatePayload(NASAL_SUCTION_TYPE, { tool: 'BULB', saline: 'yes' }, true)).toEqual([
      { field: 'tool', code: 'option' },
      { field: 'saline', code: 'bool' },
    ]);
  });
});

describe('the built-in belly massage definition from the API', () => {
  it('shows the optional reason and helped selects and hides the pause keys', () => {
    const forms = visibleFields(BELLY_MASSAGE_TYPE.fields, () => undefined).filter(
      (f) => f.hidden !== true,
    );
    expect(forms.map((f) => [f.key, f.kind, f.isRequired])).toEqual([
      ['reason', 'select', false],
      ['helped', 'select', false],
    ]);
    expect(BELLY_MASSAGE_TYPE.hasDuration).toBe(true);
  });

  it.each([{}, { reason: 'gas', helped: 'yes' }, { reason: 'constipation' }, { helped: 'no' }])(
    'accepts %j like the API, running or ended',
    (payload) => {
      expect(validatePayload(BELLY_MASSAGE_TYPE, payload, true)).toEqual([]);
      expect(validatePayload(BELLY_MASSAGE_TYPE, payload, false)).toEqual([]);
    },
  );

  it('rejects an unknown or differently cased reason and helped like the API', () => {
    expect(validatePayload(BELLY_MASSAGE_TYPE, { reason: 'pain' }, true)).toEqual([
      { field: 'reason', code: 'option' },
    ]);
    expect(validatePayload(BELLY_MASSAGE_TYPE, { reason: 'GAS', helped: 'maybe' }, true)).toEqual([
      { field: 'reason', code: 'option' },
      { field: 'helped', code: 'option' },
    ]);
  });
});

describe('integer number fields', () => {
  const type = {
    fields: [
      {
        key: 'time_to_fall_asleep_minutes',
        label: 'T',
        kind: 'number' as const,
        isRequired: false,
        options: [],
        min: 0,
        max: 240,
        unit: 'min',
        integer: true,
      },
    ],
  };

  it('accepts whole numbers and rejects fractions', () => {
    expect(validatePayload(type, { time_to_fall_asleep_minutes: 12 }, true)).toEqual([]);
    expect(validatePayload(type, { time_to_fall_asleep_minutes: 12.5 }, true)).toEqual([
      { field: 'time_to_fall_asleep_minutes', code: 'integer' },
    ]);
  });
});

describe('validatePayload (mirrors the API payload field rules)', () => {
  it('a running timer may start without its required fields', () => {
    expect(validatePayload(FEEDING_TYPE, {}, false)).toEqual([]);
  });

  it('a completed event needs every visible required field', () => {
    expect(validatePayload(FEEDING_TYPE, {}, true)).toEqual([
      { field: 'method', code: 'required' },
    ]);
    expect(validatePayload(FEEDING_TYPE, { method: 'bottle' }, true)).toEqual([]);
  });

  it('treats null like an absent value', () => {
    expect(validatePayload(FEEDING_TYPE, { method: null }, true)).toEqual([
      { field: 'method', code: 'required' },
    ]);
    expect(validatePayload(FEEDING_TYPE, { method: 'bottle', side: null }, true)).toEqual([]);
  });

  it('rejects values of hidden fields, even while running', () => {
    expect(validatePayload(FEEDING_TYPE, { method: 'bottle', side: 'left' }, false)).toEqual([
      { field: 'side', code: 'hidden' },
    ]);
    // Without the controlling value every conditional field is hidden.
    expect(validatePayload(FEEDING_TYPE, { amount_ml: 90 }, false)).toEqual([
      { field: 'amount_ml', code: 'hidden' },
    ]);
  });

  it('checks options (exact case), numbers and ranges', () => {
    expect(validatePayload(FEEDING_TYPE, { method: 'Bottle' }, false)).toEqual([
      { field: 'method', code: 'option' },
    ]);
    expect(validatePayload(FEEDING_TYPE, { method: 'bottle', amount_ml: '90' }, false)).toEqual([
      { field: 'amount_ml', code: 'number' },
    ]);
    expect(validatePayload(FEEDING_TYPE, { method: 'bottle', amount_ml: -1 }, false)).toEqual([
      { field: 'amount_ml', code: 'min' },
    ]);
    const bounded = typeWith(field({ key: 'n', kind: 'number', min: 1, max: 5, isRequired: true }));
    expect(validatePayload(bounded, { n: 6 }, true)).toEqual([{ field: 'n', code: 'max' }]);
    expect(validatePayload(bounded, { n: 3 }, true)).toEqual([]);
  });

  it('checks text and bool kinds; a required bool may be absent', () => {
    const type = typeWith(
      field({ key: 't', kind: 'text' }),
      field({ key: 'b', kind: 'bool', isRequired: true }),
    );
    expect(validatePayload(type, {}, true)).toEqual([]);
    expect(validatePayload(type, { t: 1, b: 'yes' }, true)).toEqual([
      { field: 't', code: 'text' },
      { field: 'b', code: 'bool' },
    ]);
  });

  it('does not check members no field declares (e.g. the medication list)', () => {
    expect(validatePayload(SLEEP_TYPE, { kind: 'nap', extra: { any: 1 } }, true)).toEqual([]);
    expect(validatePayload(typeWith(), { medications: [] }, true)).toEqual([]);
  });

  it('hides a field whose controlling field is hidden itself', () => {
    const type = typeWith(
      field({ key: 'a', kind: 'select', options: ['x', 'y'] }),
      field({
        key: 'b',
        kind: 'select',
        options: ['p'],
        visibleWhen: { field: 'a', equals: ['x'] },
      }),
      field({
        key: 'c',
        kind: 'text',
        isRequired: true,
        visibleWhen: { field: 'b', equals: ['p'] },
      }),
    );
    // b holds 'p' but is hidden (a = y): c is hidden too, so not required, and b is rejected.
    expect(validatePayload(type, { a: 'y', b: 'p' }, true)).toEqual([
      { field: 'b', code: 'hidden' },
    ]);
    expect(validatePayload(type, { a: 'x', b: 'p' }, true)).toEqual([
      { field: 'c', code: 'required' },
    ]);
  });

  it('a condition naming no field hides nothing; a cycle stops', () => {
    const orphan = field({ key: 'o', visibleWhen: { field: 'missing', equals: ['x'] } });
    expect(isFieldVisible([orphan], orphan, () => undefined)).toBe(true);
    const a = field({
      key: 'a',
      kind: 'select',
      options: ['x'],
      visibleWhen: { field: 'b', equals: ['x'] },
    });
    const b = field({
      key: 'b',
      kind: 'select',
      options: ['x'],
      visibleWhen: { field: 'a', equals: ['x'] },
    });
    expect(isFieldVisible([a, b], a, () => 'x')).toBe(false);
  });

  it('uses the first definition of a duplicated key, like the API', () => {
    const type = typeWith(field({ key: 'd', kind: 'number' }), field({ key: 'd', kind: 'text' }));
    expect(validatePayload(type, { d: 'text' }, true)).toEqual([{ field: 'd', code: 'number' }]);
  });
});

describe('payload helpers', () => {
  it('drops values of hidden fields only', () => {
    expect(
      withoutHiddenValues(FEEDING_TYPE, {
        method: 'bottle',
        side: 'left',
        amount_ml: 90,
        extra: 'kept',
      }),
    ).toEqual({ method: 'bottle', amount_ml: 90, extra: 'kept' });
  });

  it('knows when an event is complete', () => {
    expect(isComplete({ hasDuration: false }, null)).toBe(true);
    expect(isComplete({ hasDuration: true }, null)).toBe(false);
    expect(isComplete({ hasDuration: true }, '2026-10-20T10:00:00.000Z')).toBe(true);
  });
});
