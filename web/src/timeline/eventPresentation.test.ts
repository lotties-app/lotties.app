import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../db/models';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { EVENT_TYPES, MEDICATION } from '../test/seed';
import { optionIcon } from '../events/optionIcons';
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
