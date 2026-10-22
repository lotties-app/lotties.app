import { describe, expect, it } from 'vitest';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import {
  buildPayload,
  buildTimes,
  defaultRunning,
  formProblems,
  initialForm,
  isInstantByNature,
  switchFormType,
} from './formModel';

const NOW = new Date(2026, 9, 21, 7, 0);

function feeding(values: Record<string, string | boolean>) {
  return { ...initialForm([FEEDING_TYPE], undefined, FEEDING_TYPE.id, NOW), values };
}

describe('formProblems', () => {
  it('ties each problem to its control, in display order', () => {
    const form = {
      ...initialForm([DIAPER_TYPE], undefined, DIAPER_TYPE.id, NOW),
      startedAt: '',
    };
    expect(formProblems(form, DIAPER_TYPE).map((p) => p.field)).toEqual(['start', 'content']);
  });

  it('puts the end problem on End', () => {
    const form = {
      ...feeding({ method: 'bottle' }),
      startedAt: '2026-10-21T10:00',
      endedAt: '2026-10-21T09:00',
    };
    expect(formProblems(form, FEEDING_TYPE)).toEqual([
      { field: 'end', message: 'End time must not be before the start time.' },
    ]);
  });
});

describe('switchFormType', () => {
  it('keeps what the new type also has, and says when it cleared something', () => {
    const form = feeding({ method: 'bottle', amount_ml: '90' });
    const toSleep = switchFormType(form, FEEDING_TYPE, SLEEP_TYPE);
    expect(toSleep.cleared).toBe(true);
    expect(toSleep.form.values).toEqual({});
    expect(toSleep.form.typeId).toBe(SLEEP_TYPE.id);
    expect(toSleep.form.startedAt).toBe(form.startedAt);
  });

  it('keeps a select value the new type lists and nothing is reported cleared', () => {
    const form = { ...feeding({}), notes: 'calm' };
    const result = switchFormType(form, FEEDING_TYPE, SLEEP_TYPE);
    expect(result.cleared).toBe(false);
    expect(result.form.notes).toBe('calm');
  });

  it('ends an instant type at its start', () => {
    const form = { ...feeding({}), endedAt: '2026-10-21T08:00' };
    expect(switchFormType(form, FEEDING_TYPE, DIAPER_TYPE).form.endedAt).toBe('');
  });
});

describe('isInstantByNature and defaultRunning', () => {
  it('treats solid food as a moment and nursing and a bottle as timers', () => {
    expect(isInstantByNature(FEEDING_TYPE, { method: 'solid' })).toBe(true);
    expect(isInstantByNature(FEEDING_TYPE, { method: 'breast' })).toBe(false);
    expect(isInstantByNature(FEEDING_TYPE, { method: 'bottle' })).toBe(false);
    expect(defaultRunning(FEEDING_TYPE, { method: 'solid' })).toBe(false);
    expect(defaultRunning(FEEDING_TYPE, { method: 'breast' })).toBe(true);
    expect(defaultRunning(FEEDING_TYPE, {})).toBe(true);
  });

  it('starts a new bottle as a running timer (how long the baby took to drink it)', () => {
    expect(defaultRunning(FEEDING_TYPE, { method: 'bottle', amount_ml: '120' })).toBe(true);
  });

  it('sends a bottle with its own end, so it has a duration', () => {
    const form = {
      ...feeding({ method: 'bottle', amount_ml: '120' }),
      startedAt: '2026-10-21T10:00',
      endedAt: '2026-10-21T10:18',
    };
    const instant = isInstantByNature(FEEDING_TYPE, form.values);
    const times = buildTimes(form, FEEDING_TYPE, instant);
    expect(Date.parse(times.endedAt!) - Date.parse(times.startedAt)).toBe(18 * 60_000);
  });

  it('treats sleep markers as moments and naps and nights as timers', () => {
    for (const kind of ['bed_time', 'woke_up', 'fell_asleep']) {
      expect(defaultRunning(SLEEP_TYPE, { kind })).toBe(false);
    }
    for (const kind of ['nap', 'night', 'night_waking']) {
      expect(defaultRunning(SLEEP_TYPE, { kind })).toBe(true);
    }
  });

  it('is never running for a type without a duration, and ignores custom types', () => {
    expect(defaultRunning(DIAPER_TYPE, {})).toBe(false);
    const custom = { ...FEEDING_TYPE, babyId: 'baby-1' };
    expect(isInstantByNature(custom, { method: 'solid' })).toBe(false);
  });
});

describe('buildTimes', () => {
  it('ends an instant choice at its start even when an end was left in the form', () => {
    const form = {
      ...feeding({ method: 'solid' }),
      startedAt: '2026-10-21T10:00',
      endedAt: '2026-10-21T09:00',
    };
    const times = buildTimes(form, FEEDING_TYPE, true);
    expect(times.endedAt).toBe(times.startedAt);
    expect(formProblems(form, FEEDING_TYPE, undefined, { instant: true })).toEqual([]);
  });

  it('leaves a blank end running for a timer', () => {
    const form = { ...feeding({ method: 'breast' }), startedAt: '2026-10-21T10:00' };
    expect(buildTimes(form, FEEDING_TYPE).endedAt).toBeNull();
  });
});

describe('medication entries logged under a prescription', () => {
  it('keep prescriptionId, kgUsed and override when the event is edited', () => {
    const medType = { ...FEEDING_TYPE, id: 'type-med', key: 'medication', fields: [] };
    const payload = {
      medications: [
        {
          medicationId: 'm1',
          name: 'Colidis',
          dose: { amount: 5, unit: 'drops' },
          prescriptionId: 'rx-1',
          kgUsed: 4.6,
          override: true,
        },
      ],
    };
    const form = initialForm(
      [medType],
      {
        typeId: medType.id,
        startedAt: '2026-10-21T10:00:00.000Z',
        endedAt: '2026-10-21T10:00:00.000Z',
        payload,
      },
      undefined,
      new Date('2026-10-21T12:00:00.000Z'),
    );
    expect(buildPayload(form, medType)).toEqual(payload);
  });
});
