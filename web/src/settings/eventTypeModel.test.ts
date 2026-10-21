import { describe, expect, it } from 'vitest';
import type { EventType } from '../db/models';
import {
  draftFromType,
  emptyDraft,
  newFieldDraft,
  slugify,
  toCreateRequest,
  toTypeRequest,
  validateDraft,
  type EventTypeDraft,
  type FieldDraft,
} from './eventTypeModel';

function field(overrides: Partial<FieldDraft>): FieldDraft {
  return { ...newFieldDraft(), ...overrides };
}

function draft(overrides: Partial<EventTypeDraft> = {}): EventTypeDraft {
  return { ...emptyDraft('star'), name: 'Pacifier', ...overrides };
}

describe('slugify', () => {
  it('makes lower snake_case without accents or edge underscores', () => {
    expect(slugify('  Água de Côco! ')).toBe('agua_de_coco');
    expect(slugify('Vitamin D 3')).toBe('vitamin_d_3');
  });

  it('prefixes keys that would start with a digit and drops pure symbols', () => {
    expect(slugify('2 naps')).toBe('n_2_naps');
    expect(slugify('***')).toBe('');
  });
});

describe('validateDraft', () => {
  it('requires a name that yields a key when creating', () => {
    expect(validateDraft(draft({ name: ' ' }), true)).toEqual(['Name is required.']);
    expect(validateDraft(draft({ name: '!!!' }), true)).toEqual([
      'Name must contain at least one letter or digit.',
    ]);
    expect(validateDraft(draft({ name: '!!!' }), false)).toEqual([]);
  });

  it('checks field labels, select options and number bounds', () => {
    const errors = validateDraft(
      draft({
        fields: [
          field({ label: '' }),
          field({ label: 'Mood', kind: 'select', options: 'happy' }),
          field({ label: 'Minutes', kind: 'number', min: '10', max: '5' }),
          field({ label: 'Count', kind: 'number', min: 'x' }),
        ],
      }),
      true,
    );
    expect(errors).toEqual([
      'Field 1 needs a label.',
      'Mood needs at least two options.',
      'Minutes: min must not be above max.',
      'Count: min and max must be numbers.',
    ]);
  });
});

describe('requests', () => {
  it('builds a create request with slugged keys and kind-specific props only', () => {
    const request = toCreateRequest(
      draft({
        name: 'Soneca da Tarde',
        hasDuration: true,
        fields: [
          field({ label: 'Mood', kind: 'select', options: 'happy\n\n happy \ngrumpy', unit: 'x' }),
          field({
            label: 'Minutes',
            kind: 'number',
            isRequired: true,
            min: '1',
            max: '60',
            unit: ' min ',
          }),
          field({ label: 'Pacifier', kind: 'bool', isRequired: true, options: 'a\nb' }),
          field({ label: 'Mood' }),
        ],
      }),
    );
    expect(request).toEqual({
      key: 'soneca_da_tarde',
      name: 'Soneca da Tarde',
      icon: 'star',
      color: '#1e88e5',
      hasDuration: true,
      fields: [
        {
          key: 'mood',
          label: 'Mood',
          kind: 'select',
          isRequired: false,
          options: ['happy', 'grumpy'],
        },
        {
          key: 'minutes',
          label: 'Minutes',
          kind: 'number',
          isRequired: true,
          min: 1,
          max: 60,
          unit: 'min',
        },
        { key: 'pacifier', label: 'Pacifier', kind: 'bool', isRequired: false },
        { key: 'mood_2', label: 'Mood', kind: 'text', isRequired: false },
      ],
    });
  });

  it('keeps existing field keys when editing, even if the label changes, and omits the type key', () => {
    const type: EventType = {
      id: 't1',
      babyId: 'b',
      key: 'walk',
      name: 'Walk',
      icon: 'star',
      color: '#1e88e5',
      hasDuration: true,
      fields: [
        {
          key: 'distance_km',
          label: 'Distance',
          kind: 'number',
          isRequired: false,
          options: [],
          min: 0,
          max: null,
          unit: 'km',
        },
      ],
    };
    const edited = draftFromType(type);
    edited.fields[0].label = 'How far';
    const request = toTypeRequest(edited);
    expect(request).not.toHaveProperty('key');
    expect(request.fields).toEqual([
      {
        key: 'distance_km',
        label: 'How far',
        kind: 'number',
        isRequired: false,
        min: 0,
        unit: 'km',
      },
    ]);
  });
});
