import { describe, expect, it } from 'vitest';
import type { EventFieldDefinition, EventType } from '../db/models';
import { fromEventTypeDto } from '../sync/contract';
import { FEEDING_DTO, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
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
    [{ method: 'bottle' }, ['method', 'amount_ml', 'bottle_feeding_type']],
    [{ method: 'solid' }, ['method', 'food']],
  ])('shows only the fields of the chosen method %j', (payload, shown) => {
    const valueOf = (key: string) => (payload as Record<string, unknown>)[key];
    expect(keys(visibleFields(FEEDING_TYPE.fields, valueOf))).toEqual(shown);
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
