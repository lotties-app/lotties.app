import { describe, expect, it } from 'vitest';
import { useTestLocale } from '../test/locale';
import {
  canRemind,
  emptyForm,
  formFromPrescription,
  lenientTerms,
  summaryText,
  toTerms,
  validateForm,
  type PrescriptionForm,
} from './prescriptionForm';
import { asNeeded, byParts } from './prescriptionFixtures';
import { normalizeGroupName } from './groupName';

const NOW = new Date(2026, 2, 2, 12, 0);

function form(over: Partial<PrescriptionForm> = {}): PrescriptionForm {
  return {
    ...emptyForm(NOW),
    medicationId: 'med-a',
    amount: 1,
    unit: 'drops',
    perKg: true,
    rounding: '1',
    kind: 'asNeeded',
    minIntervalHours: 8,
    indication: 'belly pain',
    ...over,
  };
}

describe('validateForm (mirrors the API rules)', () => {
  it('accepts the owner example', () => {
    expect(validateForm(form())).toEqual({});
  });

  it('requires the medication, a dose above zero and a unit', () => {
    const errors = validateForm(form({ medicationId: null, amount: 0, unit: ' ' }));
    expect(Object.keys(errors).sort()).toEqual(['amount', 'medication', 'unit']);
  });

  it('as needed needs a minimum interval of 15 minutes to 7 days', () => {
    expect(validateForm(form({ minIntervalHours: null })).minInterval).toBeTruthy();
    expect(validateForm(form({ minIntervalHours: 0.2 })).minInterval).toBeTruthy();
    expect(validateForm(form({ minIntervalHours: 0.25 })).minInterval).toBeUndefined();
    expect(validateForm(form({ minIntervalHours: 168 })).minInterval).toBeUndefined();
    expect(validateForm(form({ minIntervalHours: 169 })).minInterval).toBeTruthy();
  });

  it('limits the daily maximum to 1-24', () => {
    expect(validateForm(form({ maxDoses: 0 })).maxDoses).toBeTruthy();
    expect(validateForm(form({ maxDoses: 25 })).maxDoses).toBeTruthy();
    expect(validateForm(form({ maxDoses: 3 })).maxDoses).toBeUndefined();
  });

  it('scheduled by times needs distinct times; every N hours needs a valid interval', () => {
    const scheduled = { kind: 'scheduled' as const, perKg: false, rounding: 'none' as const };
    expect(validateForm(form({ ...scheduled, times: [] })).times).toBeTruthy();
    expect(validateForm(form({ ...scheduled, times: ['08:00', '08:00'] })).times).toBeTruthy();
    expect(validateForm(form({ ...scheduled, times: ['08:00', '20:00'] }))).toEqual({});
    expect(
      validateForm(form({ ...scheduled, scheduleBy: 'every', everyHours: null })).every,
    ).toBeTruthy();
    expect(validateForm(form({ ...scheduled, scheduleBy: 'every', everyHours: 6 }))).toEqual({});
  });

  it('rejects per kg for counted units, fractions of sprays and puffs, and quarter suppositories', () => {
    expect(validateForm(form({ unit: 'sprays' })).unit).toBe(
      'A per-kg dose is only for measured units like drops, ml or mg, not for sprays, puffs, suppositories or applications.',
    );
    const fixed = { perKg: false, rounding: 'none' as const };
    expect(validateForm(form({ ...fixed, unit: 'sprays', amount: 2 }))).toEqual({});
    expect(validateForm(form({ ...fixed, unit: 'sprays', amount: 1.5 })).amount).toBe(
      'Use a whole number of sprays or puffs.',
    );
    expect(validateForm(form({ ...fixed, unit: 'supositório', amount: 1.5 }))).toEqual({});
    expect(validateForm(form({ ...fixed, unit: 'supositório', amount: 0.5 }))).toEqual({});
    expect(validateForm(form({ ...fixed, unit: 'supositório', amount: 1.25 })).amount).toBe(
      'Use whole or half suppositories (for example 0.5, 1 or 1.5).',
    );
    expect(validateForm(form({ ...fixed, unit: 'puffs', amount: 0.5 })).amount).toBeTruthy();
    expect(validateForm(form({ ...fixed, unit: 'applications', amount: 0.5 }))).toEqual({});
    expect(validateForm(form({ ...fixed, unit: 'ml', amount: 0.5 }))).toEqual({});
  });

  it('checks dates, text lengths and the interval group', () => {
    expect(validateForm(form({ startDate: '' })).startDate).toBeTruthy();
    expect(validateForm(form({ startDate: '1999-12-31' })).startDate).toBeTruthy();
    expect(validateForm(form({ endDate: '2026-03-01' })).endDate).toBeTruthy();
    expect(validateForm(form({ endDate: '2026-03-02' })).endDate).toBeUndefined();
    expect(validateForm(form({ indication: 'x'.repeat(201) })).indication).toBeTruthy();
    expect(validateForm(form({ prescriber: 'x'.repeat(101) })).prescriber).toBeTruthy();
    expect(validateForm(form({ instructions: 'x'.repeat(2000) })).instructions).toBeUndefined();
    expect(validateForm(form({ instructions: 'x'.repeat(2001) })).instructions).toBeTruthy();
    expect(validateForm(form({ group: 'x'.repeat(51) })).group).toBeTruthy();
  });
});

describe('toTerms', () => {
  it('builds an as-needed per-kg prescription with a rounding step and a normalised group', () => {
    const terms = toTerms(form({ group: ' Cólica  Bebê ', maxDoses: 3, prescriber: ' Dr. A ' }));
    expect(terms).toMatchObject({
      kind: 'asNeeded',
      dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
      timesOfDay: null,
      everyMinutes: null,
      minIntervalMinutes: 480,
      maxDosesPer24h: 3,
      indication: 'belly pain',
      intervalGroup: 'colica bebe',
      prescriber: 'Dr. A',
      endDate: null,
      status: 'active',
    });
  });

  it('keeps only the fields of the chosen kind and drops the rounding of a fixed dose', () => {
    const terms = toTerms(
      form({
        kind: 'scheduled',
        perKg: false,
        rounding: '0.5',
        times: ['20:00', '08:00'],
        minIntervalHours: 8,
        maxDoses: 3,
      }),
    );
    expect(terms).toMatchObject({
      kind: 'scheduled',
      timesOfDay: ['08:00', '20:00'],
      everyMinutes: null,
      minIntervalMinutes: null,
      maxDosesPer24h: null,
      dose: { perKg: false, roundingStep: null },
    });
  });

  it('round trips through the form of an existing prescription', () => {
    const p = asNeeded('med-a', 360, {
      maxDoses: 4,
      dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 0.5 },
    });
    const back = toTerms(formFromPrescription(p), p.status);
    expect(back.minIntervalMinutes).toBe(360);
    expect(back.dose).toEqual(p.dose);
    expect(back.maxDosesPer24h).toBe(4);
  });
});

describe('the plain-language summary', () => {
  it('reads the owner example', () => {
    expect(summaryText(lenientTerms(form()))).toBe(
      'Give 1 drop per kg, no more often than every 8 hours, when belly pain',
    );
  });

  it('reads times of day, maximums and the end of the course', () => {
    const terms = lenientTerms(
      form({
        kind: 'scheduled',
        perKg: false,
        amount: 2,
        times: ['08:00'],
        indication: '',
        endDate: '2026-03-10',
      }),
    );
    expect(summaryText(terms)).toMatch(/^Give 2 drops, at 0?8:00.*, until .*2026$/);
    const prn = lenientTerms(
      form({ perKg: false, maxDoses: 3, minIntervalHours: 4, indication: '' }),
    );
    expect(summaryText(prn)).toBe(
      'Give 1 drop, no more often than every 4 hours, at most 3 doses in 24 hours',
    );
    const every = lenientTerms(
      form({ kind: 'scheduled', scheduleBy: 'every', everyHours: 6, perKg: false, indication: '' }),
    );
    expect(summaryText(every)).toBe('Give 1 drop, every 6 hours');
  });

  it('reads half hours and minutes', () => {
    expect(summaryText(lenientTerms(form({ minIntervalHours: 1.5, indication: '' })))).toBe(
      'Give 1 drop per kg, no more often than every 1.5 hours',
    );
    expect(summaryText(lenientTerms(form({ minIntervalHours: 0.5, indication: '' })))).toBe(
      'Give 1 drop per kg, no more often than every 30 minutes',
    );
  });

  it('reads counted units with plurals', async () => {
    const spray = form({
      unit: 'sprays',
      amount: 2,
      perKg: false,
      indication: '',
      minIntervalHours: 4,
    });
    expect(summaryText(lenientTerms(spray))).toBe(
      'Give 2 sprays, no more often than every 4 hours',
    );
    await useTestLocale('pt-BR');
    expect(summaryText(lenientTerms({ ...spray, unit: 'jatos', amount: 1 }))).toBe(
      'Dar 1 jato, com intervalo mínimo de 4 horas',
    );
    await useTestLocale('en');
  });

  it('is empty until there is a dose and a unit', () => {
    expect(summaryText(lenientTerms(form({ amount: null })))).toBeNull();
    expect(summaryText(lenientTerms(form({ unit: '' })))).toBeNull();
    expect(summaryText(null)).toBeNull();
  });

  it('reads in Portuguese', async () => {
    await useTestLocale('pt-BR');
    expect(summaryText(lenientTerms(form({ unit: 'gotas' })))).toBe(
      'Dar 1 gota por kg, com intervalo mínimo de 8 horas, quando belly pain',
    );
    expect(validateForm(form({ medicationId: null })).medication).toBe('Escolha o remédio.');
    expect(
      summaryText(
        lenientTerms(
          form({ minIntervalHours: 1.5, indication: '', unit: 'ml', amount: 2.5, perKg: false }),
        ),
      ),
    ).toBe('Dar 2,5 ml, com intervalo mínimo de 1,5 hora');
    await useTestLocale('en');
  });
});

describe('part of the day', () => {
  const byPartsForm = (over: Partial<PrescriptionForm> = {}) =>
    form({
      kind: 'scheduled',
      scheduleBy: 'parts',
      perKg: false,
      rounding: 'none',
      indication: '',
      ...over,
    });

  it('needs at least one part, and reminder times inside their windows when reminders are on', () => {
    expect(validateForm(byPartsForm({ parts: [] })).parts).toBe(
      'Choose at least one part of the day.',
    );
    expect(validateForm(byPartsForm({ parts: ['morning'] }))).toEqual({});
    const night = { ...emptyForm(NOW).reminderTimes, night: '21:00' };
    expect(
      validateForm(byPartsForm({ parts: ['night'], partReminders: true, reminderTimes: night }))
        .reminders,
    ).toBe('Night: choose a time between 22:00 and 05:00.');
    expect(
      validateForm(byPartsForm({ parts: ['night'], partReminders: false, reminderTimes: night })),
    ).toEqual({});
    const late = { ...emptyForm(NOW).reminderTimes, night: '01:30' };
    expect(
      validateForm(byPartsForm({ parts: ['night'], partReminders: true, reminderTimes: late })),
    ).toEqual({});
  });

  it('saves the parts in day order and reminders only when on (default times 08, 14, 19, 22)', () => {
    expect(emptyForm(NOW).reminderTimes).toEqual({
      morning: '08:00',
      afternoon: '14:00',
      evening: '19:00',
      night: '22:00',
    });
    const off = toTerms(byPartsForm({ parts: ['night', 'morning'], times: ['08:00'] }));
    expect(off).toMatchObject({
      kind: 'scheduled',
      dayParts: ['morning', 'night'],
      dayPartReminders: null,
      timesOfDay: null,
      everyMinutes: null,
    });
    const on = toTerms(byPartsForm({ parts: ['night', 'morning'], partReminders: true }));
    expect(on.dayPartReminders).toEqual([
      { part: 'morning', time: '08:00' },
      { part: 'night', time: '22:00' },
    ]);
    expect(toTerms(form({ kind: 'scheduled', times: ['08:00'] })).dayParts).toBeNull();
  });

  it('round trips an existing part-of-the-day prescription', () => {
    const p = byParts('med-a', ['morning', 'evening'], {
      reminders: [{ part: 'evening', time: '20:30' }],
    });
    const edited = formFromPrescription(p);
    expect(edited).toMatchObject({ scheduleBy: 'parts', parts: ['morning', 'evening'] });
    expect(edited.partReminders).toBe(true);
    expect(edited.reminderTimes.evening).toBe('20:30');
    expect(edited.reminderTimes.morning).toBe('08:00');
    const back = toTerms(edited, p.status);
    expect([back.dayParts, back.dayPartReminders]).toEqual([
      ['morning', 'evening'],
      [
        { part: 'morning', time: '08:00' },
        { part: 'evening', time: '20:30' },
      ],
    ]);
  });

  it('reads the parts in the summary, in English and Portuguese', async () => {
    const terms = lenientTerms(byPartsForm({ parts: ['morning', 'night'] }));
    expect(summaryText(terms)).toBe('Give 1 drop, in the morning and at night');
    await useTestLocale('pt-BR');
    expect(summaryText(lenientTerms(byPartsForm({ parts: ['morning', 'evening'] })))).toBe(
      'Dar 1 gota, de manhã e à noite',
    );
    await useTestLocale('en');
  });

  it('offers medicine reminders only when the saved terms can remind', () => {
    expect(canRemind(toTerms(byPartsForm({ parts: ['morning'] })))).toBe(false);
    expect(canRemind(toTerms(byPartsForm({ parts: ['morning'], partReminders: true })))).toBe(true);
    expect(canRemind(toTerms(form({ kind: 'scheduled', times: ['08:00'] })))).toBe(true);
    expect(canRemind(toTerms(form()))).toBe(false);
  });
});

describe('normalizeGroupName', () => {
  it('lower cases, strips diacritics and collapses spaces like the API', () => {
    expect(normalizeGroupName('  Cólica   Forte ')).toBe('colica forte');
    expect(normalizeGroupName('   ')).toBeNull();
    expect(normalizeGroupName(null)).toBeNull();
  });
});
