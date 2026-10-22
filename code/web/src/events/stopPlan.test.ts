import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../db/models';
import { BABY_ID } from '../test/fakeApi';
import { BELLY_MASSAGE_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import {
  clearAllLastUsed,
  clearLastUsedForBaby,
  lastUsedFor,
  quickStartPayload,
  readLastUsed,
  recordLastUsed,
} from './lastUsedValues';
import { fillEmptyFields, fixFields, planStop, rememberedFormValues } from './stopPlan';

const event = (overrides: Partial<BabyEvent>): BabyEvent => ({
  id: 'e1',
  babyId: BABY_ID,
  typeId: FEEDING_TYPE.id,
  startedAt: '2026-10-20T08:00:00.000Z',
  endedAt: null,
  payload: {},
  notes: null,
  createdBy: null,
  createdAt: '2026-10-20T08:00:00.000Z',
  updatedAt: '2026-10-20T08:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

describe('planStop', () => {
  it('stops at once when the completed payload is valid', () => {
    expect(planStop(FEEDING_TYPE, { method: 'breast' })).toEqual({ kind: 'stop' });
    expect(planStop(SLEEP_TYPE, {})).toEqual({ kind: 'stop' });
    expect(planStop(undefined, {})).toEqual({ kind: 'stop' });
  });

  it('stops a belly massage at once, like tummy time: its details are all optional', () => {
    expect(planStop(BELLY_MASSAGE_TYPE, {})).toEqual({ kind: 'stop' });
    expect(planStop(BELLY_MASSAGE_TYPE, { reason: 'gas' })).toEqual({ kind: 'stop' });
    expect(planStop(BELLY_MASSAGE_TYPE, { reason: 'gas', helped: 'yes' })).toEqual({
      kind: 'stop',
    });
  });

  it('asks for missing required fields first', () => {
    expect(planStop(FEEDING_TYPE, {})).toEqual({ kind: 'finish', fields: ['method'] });
  });

  it('asks for invalid values too', () => {
    expect(planStop(FEEDING_TYPE, { method: 'BOTTLE' })).toEqual({
      kind: 'finish',
      fields: ['method'],
    });
  });

  it('strips values of hidden fields without asking', () => {
    expect(planStop(FEEDING_TYPE, { method: 'breast', amount_ml: 90 })).toEqual({
      kind: 'strip',
      payload: { method: 'breast' },
    });
  });

  it('asks for the amount (optional) when a bottle timer without one stops', () => {
    // The content and, for formula, which one (the sheet's formula chips) are asked with it.
    const asked = ['amount_ml', 'bottle_feeding_type', 'formula_id', 'formula_name'];
    expect(planStop(FEEDING_TYPE, { method: 'bottle' })).toEqual({ kind: 'finish', fields: asked });
    // Hidden values go with the finish sheet, which drops them on save.
    expect(planStop(FEEDING_TYPE, { method: 'bottle', side: 'left' })).toEqual({
      kind: 'finish',
      fields: asked,
    });
  });

  it('stops a bottle with its amount at once, with or without the content', () => {
    expect(planStop(FEEDING_TYPE, { method: 'bottle', amount_ml: 120 })).toEqual({ kind: 'stop' });
    expect(
      planStop(FEEDING_TYPE, { method: 'bottle', amount_ml: 120, bottle_feeding_type: 'formula' }),
    ).toEqual({ kind: 'stop' });
  });

  it('never asks a custom type for a bottle amount', () => {
    const custom = { ...FEEDING_TYPE, id: 'custom-feed', babyId: BABY_ID };
    expect(planStop(custom, { method: 'bottle' })).toEqual({ kind: 'stop' });
  });
});

describe('fixFields', () => {
  it('lists what the rules find wrong plus the field the server named', () => {
    const stopped = event({ endedAt: '2026-10-20T08:30:00.000Z' });
    expect(fixFields(FEEDING_TYPE, stopped, 'method')).toEqual(['method']);
    expect(fixFields(FEEDING_TYPE, stopped, 'food')).toEqual(['method', 'food']);
  });

  it('falls back to the visible fields when nothing local explains the rejection', () => {
    const ok = event({ payload: { method: 'solid' }, endedAt: '2026-10-20T08:30:00.000Z' });
    expect(fixFields(FEEDING_TYPE, ok, 'unknown')).toEqual(['method', 'food']);
  });
});

describe('remembered values', () => {
  it('records choice values per baby and type, never free text', () => {
    recordLastUsed(BABY_ID, FEEDING_TYPE, { method: 'solid', food: 'banana' });
    recordLastUsed(BABY_ID, FEEDING_TYPE, { method: 'bottle', amount_ml: 120 });
    expect(readLastUsed(BABY_ID, FEEDING_TYPE.id)).toEqual({ method: 'bottle', amount_ml: 120 });
    expect(readLastUsed('other-baby', FEEDING_TYPE.id)).toEqual({});
  });

  it('survives broken storage values', () => {
    window.localStorage.setItem(`baby-routine.last-values.${BABY_ID}.${FEEDING_TYPE.id}`, '[1]');
    expect(readLastUsed(BABY_ID, FEEDING_TYPE.id)).toEqual({});
    window.localStorage.setItem(`baby-routine.last-values.${BABY_ID}.${FEEDING_TYPE.id}`, '{x');
    expect(readLastUsed(BABY_ID, FEEDING_TYPE.id)).toEqual({});
  });

  it('only offers values that are still valid for the definition', () => {
    expect(
      lastUsedFor({ method: 'tube', amount_ml: -5, side: 'left' }, FEEDING_TYPE.fields),
    ).toEqual({ side: 'left' });
  });

  it('turns them into form values', () => {
    expect(
      rememberedFormValues(FEEDING_TYPE, ['method', 'amount_ml'], {
        method: 'bottle',
        amount_ml: 90,
        side: 'left',
      }),
    ).toEqual({ method: 'bottle', amount_ml: '90' });
  });

  it('are cleared per baby and all at once', () => {
    recordLastUsed(BABY_ID, FEEDING_TYPE, { method: 'bottle' });
    recordLastUsed('baby-2', FEEDING_TYPE, { method: 'solid' });
    clearLastUsedForBaby(BABY_ID);
    expect(readLastUsed(BABY_ID, FEEDING_TYPE.id)).toEqual({});
    expect(readLastUsed('baby-2', FEEDING_TYPE.id)).toEqual({ method: 'solid' });
    clearAllLastUsed();
    expect(readLastUsed('baby-2', FEEDING_TYPE.id)).toEqual({});
  });
});

describe('quickStartPayload', () => {
  const custom: EventType = {
    id: 'type-pump',
    babyId: BABY_ID,
    key: 'pumping',
    name: 'Pumping',
    icon: 'water_drop',
    color: '#1e88e5',
    hasDuration: true,
    fields: [
      {
        key: 'side',
        label: 'Side',
        kind: 'select',
        isRequired: true,
        options: ['left', 'right'],
        min: null,
        max: null,
        unit: null,
        visibleWhen: null,
      },
      {
        key: 'note',
        label: 'Note',
        kind: 'select',
        isRequired: false,
        options: ['a'],
        min: null,
        max: null,
        unit: null,
        visibleWhen: null,
      },
    ],
  };

  it('fills missing required fields from the remembered values, keeping the defaults', () => {
    expect(quickStartPayload(custom, {}, { side: 'right', note: 'a' })).toEqual({ side: 'right' });
    expect(quickStartPayload(FEEDING_TYPE, { method: 'breast' }, { method: 'bottle' })).toEqual({
      method: 'breast',
    });
  });

  it('fills the feeding method of a generic timer, so its stop needs no sheet', () => {
    const payload = quickStartPayload(FEEDING_TYPE, {}, { method: 'breast', side: 'left' });
    expect(payload).toEqual({ method: 'breast' });
    expect(planStop(FEEDING_TYPE, payload)).toEqual({ kind: 'stop' });
  });

  it('a one-tap bottle timer gets no remembered amount: its stop asks for it', () => {
    const payload = quickStartPayload(FEEDING_TYPE, { method: 'bottle' }, { amount_ml: 90 });
    expect(payload).toEqual({ method: 'bottle' });
    expect(planStop(FEEDING_TYPE, payload).kind).toBe('finish');
  });

  it('leaves fields without a remembered value empty (the stop asks)', () => {
    expect(quickStartPayload(custom, {}, {})).toEqual({});
    expect(planStop(custom, {})).toEqual({ kind: 'finish', fields: ['side'] });
  });
});

describe('fillEmptyFields (a Caregiver finishing someone else’s timer)', () => {
  it('fills only the asked fields that were empty and keeps every stored value', () => {
    const stored = { method: 'bottle', bottle_feeding_type: 'formula', food: '', pause_count: 1 };
    const built = {
      method: 'breast',
      bottle_feeding_type: 'breast_milk',
      food: 'rice',
      amount_ml: 90,
      side: 'left',
    };
    expect(fillEmptyFields(stored, built, ['amount_ml', 'bottle_feeding_type', 'food'])).toEqual({
      method: 'bottle',
      bottle_feeding_type: 'formula',
      food: 'rice',
      pause_count: 1,
      amount_ml: 90,
    });
  });
});
