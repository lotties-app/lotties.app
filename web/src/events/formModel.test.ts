import { describe, expect, it } from 'vitest';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { formProblems, initialForm, switchFormType } from './formModel';

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
