import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../db/models';
import {
  BELLY_MASSAGE_TYPE,
  FUSSY_TYPE,
  DIAPER_TYPE,
  FEEDING_TYPE,
  MILESTONE_TYPE,
  NAIL_TRIM_TYPE,
  NASAL_SUCTION_TYPE,
  OUTDOOR_TYPE,
  SKIN_CARE_TYPE,
  SLEEP_TYPE,
  SPIT_UP_TYPE,
  SYMPTOM_TYPE,
  TEETHING_TYPE,
  TEMPERATURE_TYPE,
} from '../test/builtInTypes';
import { EVENT_TYPES, MEDICATION } from '../test/seed';
import { optionIcon } from '../events/optionIcons';
import { asNeeded } from '../medications/prescriptionFixtures';
import { presentEvent } from './eventPresentation';

function event(type: EventType, payload: BabyEvent['payload']): BabyEvent {
  return {
    id: 'e1',
    babyId: 'baby-1',
    typeId: type.id,
    startedAt: '2026-10-20T08:00:00.000Z',
    endedAt: '2026-10-20T08:30:00.000Z',
    payload,
    notes: null,
    createdBy: null,
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    deletedAt: null,
  };
}

describe('presentEvent', () => {
  it('titles sleep by its kind, with the icon and category of the kind', () => {
    expect(presentEvent(event(SLEEP_TYPE, { kind: 'woke_up' }), SLEEP_TYPE)).toMatchObject({
      title: 'Woke up',
      icon: 'sun',
      category: 'sleep',
      detail: '',
    });
    expect(presentEvent(event(SLEEP_TYPE, { kind: 'nap' }), SLEEP_TYPE).title).toBe('Nap');
    expect(presentEvent(event(SLEEP_TYPE, { kind: 'night' }), SLEEP_TYPE).title).toBe(
      'Night sleep',
    );
    expect(presentEvent(event(SLEEP_TYPE, { kind: 'night_waking' }), SLEEP_TYPE)).toMatchObject({
      title: 'Night waking',
      icon: 'eye',
      category: 'nightWaking',
    });
    expect(presentEvent(event(SLEEP_TYPE, { kind: 'fell_asleep' }), SLEEP_TYPE).title).toBe(
      'Fell asleep',
    );
  });

  it('titles feeding by method and puts amount and content in the detail', () => {
    const view = presentEvent(
      event(FEEDING_TYPE, { method: 'bottle', amount_ml: 60, bottle_feeding_type: 'formula' }),
      FEEDING_TYPE,
    );
    expect(view).toMatchObject({ title: 'Bottle', icon: 'bottle', detail: '60 ml · Formula' });
    const breast = presentEvent(
      event(FEEDING_TYPE, { method: 'breast', side: 'left', breast_left_seconds: 480 }),
      FEEDING_TYPE,
    );
    expect(breast).toMatchObject({ title: 'Breast', icon: 'heart', detail: 'Left · 8m' });
    expect(
      presentEvent(event(FEEDING_TYPE, { method: 'solid', food: 'Pumpkin' }), FEEDING_TYPE),
    ).toMatchObject({ title: 'Solid food', icon: 'utensils', detail: 'Pumpkin' });
  });

  it('titles a diaper by its content, also for the upper-case values of older clients', () => {
    expect(presentEvent(event(DIAPER_TYPE, { content: 'DIRTY' }), DIAPER_TYPE)).toMatchObject({
      title: 'Dirty',
      icon: 'poo',
      category: 'diaper',
    });
  });

  it('titles medication by the names and shows doses as the detail', () => {
    const type = EVENT_TYPES.find((t) => t.id === MEDICATION)!;
    const view = presentEvent(
      event(type, {
        medications: [
          { medicationId: 'a', name: 'Colidis', dose: { amount: 5, unit: 'drops' } },
          { medicationId: 'b', name: 'Vitamin D' },
        ],
      }),
      type,
    );
    expect(view).toMatchObject({
      title: 'Colidis, Vitamin D',
      detail: '5 drops',
      category: 'health',
    });
  });

  it('titles nasal suction by its type name and puts the tool and saline in the detail', () => {
    const full = presentEvent(
      event(NASAL_SUCTION_TYPE, { tool: 'bulb', saline: true }),
      NASAL_SUCTION_TYPE,
    );
    expect(full).toMatchObject({
      title: 'Nasal suction',
      icon: 'wind',
      category: 'health',
      detail: 'Bulb · Saline used',
    });
    expect(
      presentEvent(event(NASAL_SUCTION_TYPE, { tool: 'mouth', saline: false }), NASAL_SUCTION_TYPE)
        .detail,
    ).toBe('Mouth suction');
    expect(presentEvent(event(NASAL_SUCTION_TYPE, {}), NASAL_SUCTION_TYPE).detail).toBe('');
  });

  it('titles belly massage by its type name and says the reason and whether it helped', () => {
    const view = (payload: BabyEvent['payload']) =>
      presentEvent(event(BELLY_MASSAGE_TYPE, payload), BELLY_MASSAGE_TYPE);
    expect(view({ reason: 'gas', helped: 'yes' })).toMatchObject({
      title: 'Belly massage',
      icon: 'massage',
      category: 'health',
      detail: 'Gas · helped',
    });
    expect(view({ reason: 'colic', helped: 'a_little' }).detail).toBe('Colic · helped a little');
    expect(view({ helped: 'no' }).detail).toBe("didn't help");
    expect(view({ reason: 'constipation', pause_count: 1, paused_seconds: 30 }).detail).toBe(
      'Constipation',
    );
    expect(view({}).detail).toBe('');
    // A future option the catalog does not know yet is humanized, never shown raw.
    expect(view({ helped: 'much_better' }).detail).toBe('Much better');
  });

  it('shows a temperature as the number with its unit and where it was measured, nothing more', () => {
    const view = (payload: BabyEvent['payload']) =>
      presentEvent(event(TEMPERATURE_TYPE, payload), TEMPERATURE_TYPE);
    expect(view({ value_c: 37.8, method: 'armpit' })).toMatchObject({
      title: 'Temperature',
      icon: 'thermometer',
      category: 'health',
      detail: '37.8 °C · Armpit',
    });
    // The app never interprets the reading: a high value reads exactly like a normal one.
    expect(view({ value_c: 39.5 }).detail).toBe('39.5 °C');
    expect(view({ value_c: 36, method: 'ear' }).detail).toBe('36 °C · Ear');
  });

  it('shows the tooth once a tooth came through and the milestone in the parents words', () => {
    const teething = (payload: BabyEvent['payload']) =>
      presentEvent(event(TEETHING_TYPE, payload), TEETHING_TYPE);
    expect(teething({ stage: 'gums_sore' })).toMatchObject({
      title: 'Teething',
      icon: 'tooth',
      category: 'health',
      detail: 'Sore gums',
    });
    expect(teething({ stage: 'tooth_came_through', tooth: 'lower_central_incisor' }).detail).toBe(
      'Tooth came through · Lower central incisor',
    );
    const milestone = (payload: BabyEvent['payload']) =>
      presentEvent(event(MILESTONE_TYPE, payload), MILESTONE_TYPE);
    expect(milestone({ milestone: 'first_steps' })).toMatchObject({
      title: 'Milestone',
      icon: 'trophy',
      category: 'care',
      detail: 'First steps',
    });
    expect(milestone({ milestone: 'other', custom: 'Waved bye-bye' }).detail).toBe('Waved bye-bye');
    expect(milestone({ milestone: 'other' }).detail).toBe('Other');
  });

  it.each([
    [NAIL_TRIM_TYPE, { where: 'both' }, 'Nail trim', 'scissors', 'care', 'Both'],
    [
      SPIT_UP_TYPE,
      { kind: 'vomit', amount: 'a_lot' },
      'Spit-up / vomit',
      'mood-sick',
      'health',
      'Vomit · A lot',
    ],
    [
      SYMPTOM_TYPE,
      { symptom: 'congestion', severity: 'mild' },
      'Symptom',
      'virus',
      'health',
      'Stuffy nose · Mild',
    ],
    [
      OUTDOOR_TYPE,
      { kind: 'stroller_walk', pause_count: 1, paused_seconds: 60 },
      'Outdoor time',
      'trees',
      'care',
      'Stroller walk',
    ],
    [SKIN_CARE_TYPE, { product: 'diaper_cream' }, 'Skin care', 'lotion', 'care', 'Diaper cream'],
  ] as const)(
    'titles %#: the %s row with its icon, category and option labels',
    (type, payload, title, icon, category, detail) => {
      expect(presentEvent(event(type, { ...payload }), type)).toMatchObject({
        title,
        icon,
        category,
        detail,
      });
      expect(presentEvent(event(type, {}), type).detail).toBe('');
    },
  );

  it('titles a fussy spell by its type name and says the intensity and what helped', () => {
    const view = (payload: BabyEvent['payload']) =>
      presentEvent(event(FUSSY_TYPE, payload), FUSSY_TYPE);
    expect(view({ intensity: 'moderate', what_helped: 'rocking' })).toMatchObject({
      title: 'Fussy / crying',
      icon: 'mood-cry',
      category: 'care',
      detail: 'Moderate · rocking helped',
    });
    expect(view({ what_helped: 'nothing' }).detail).toBe('nothing helped');
    expect(view({ what_helped: 'other' }).detail).toBe('something else helped');
    expect(view({ what_helped: 'diaper_change' }).detail).toBe('a diaper change helped');
    expect(view({ what_helped: 'burping' }).detail).toBe('burping helped');
    expect(view({ what_helped: 'holding', suggested_cause: 'comfort' }).detail).toBe(
      'holding helped',
    );
    expect(view({ intensity: 'intense', pause_count: 1, paused_seconds: 30 }).detail).toBe(
      'Intense',
    );
    expect(view({}).detail).toBe('');
  });

  it('falls back to the type name without a kind, and never shows a raw code', () => {
    expect(presentEvent(event(SLEEP_TYPE, {}), SLEEP_TYPE).title).toBe('Sleep');
    const odd = presentEvent(event(FEEDING_TYPE, { method: 'tube_feeding' }), FEEDING_TYPE);
    expect(odd.title).toBe('Tube feeding');
  });

  it('copes with an unknown type', () => {
    expect(presentEvent(event(DIAPER_TYPE, {}), undefined)).toMatchObject({
      title: 'Event',
      category: 'custom',
    });
  });
});

describe('optionIcon', () => {
  it('knows built-in options only', () => {
    expect(optionIcon(FEEDING_TYPE, { key: 'side' }, 'LEFT')).toBe('arrow-left');
    expect(optionIcon(FEEDING_TYPE, { key: 'side' }, 'nowhere')).toBeUndefined();
    expect(optionIcon({ key: 'feeding', babyId: 'b1' }, { key: 'side' }, 'left')).toBeUndefined();
    expect(optionIcon(FEEDING_TYPE, { key: 'constructor' }, 'left')).toBeUndefined();
  });
});

describe('presentEvent for doses given under a prescription', () => {
  const rx = (indication: string | null) => [{ ...asNeeded('m1', 480), id: 'rx-1', indication }];
  const dose = (extra = {}) =>
    event(
      EVENT_TYPES.find((t) => t.id === MEDICATION)!,
      {
        medications: [
          {
            medicationId: 'm1',
            name: 'Colidis',
            dose: { amount: 5, unit: 'drops' },
            prescriptionId: 'rx-1',
            ...extra,
          },
        ],
      },
    );
  const medType = EVENT_TYPES.find((t) => t.id === MEDICATION);

  it('shows the dose and the prescription it followed', () => {
    expect(presentEvent(dose(), medType, [], undefined, rx('belly pain'))).toMatchObject({
      title: 'Colidis',
      detail: '5 drops · Prescription for belly pain',
    });
    expect(presentEvent(dose(), medType, [], undefined, rx(null)).detail).toBe(
      '5 drops · Prescription',
    );
  });

  it('shows the weight a per-kg dose used and that it was logged early', () => {
    expect(
      presentEvent(dose({ kgUsed: 4.6, override: true }), medType, [], undefined, rx(null)).detail,
    ).toBe('5 drops · for 4.6 kg · Prescription · Logged early');
  });

  it('keeps a plain dose as it was', () => {
    const plain = event(medType!, {
      medications: [{ medicationId: 'm1', name: 'Colidis', dose: { amount: 5, unit: 'drops' } }],
    });
    expect(presentEvent(plain, medType).detail).toBe('5 drops');
  });
});
