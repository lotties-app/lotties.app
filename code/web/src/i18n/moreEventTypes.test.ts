import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';
import {
  MILESTONE_TYPE,
  MORE_BUILT_IN_TYPES,
  NAIL_TRIM_TYPE,
  OUTDOOR_TYPE,
  SKIN_CARE_TYPE,
  SPIT_UP_TYPE,
  SYMPTOM_TYPE,
  TEETHING_TYPE,
  TEMPERATURE_TYPE,
} from '../test/builtInTypes';
import { useTestLocale } from '../test/locale';
import { payloadSummary } from '../timeline/payloadSummary';
import { presetLabel } from '../presets/presetLabel';
import { eventTypeText } from './eventTypeText';

/** The string at `path` (dot-separated) in a catalog, or `undefined`. */
function at(catalog: unknown, path: string[]): unknown {
  let node: unknown = catalog;
  for (const key of path) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, key)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

describe('the eight built-in types of the MoreEventTypes migration', () => {
  const catalogs = { en, 'pt-BR': ptBR };

  it.each(Object.entries(catalogs))(
    'have a name, preset label, field labels and option labels in %s',
    (_locale, catalog) => {
      for (const type of MORE_BUILT_IN_TYPES) {
        expect(at(catalog, ['eventTypes', type.key, 'name']), type.key).toEqual(expect.any(String));
        expect(at(catalog, ['presets', type.key]), type.key).toEqual(expect.any(String));
        for (const field of type.fields) {
          const label = at(catalog, ['eventTypes', type.key, 'fields', field.key, 'label']);
          expect(label, `${type.key}.${field.key}`).toEqual(expect.any(String));
          for (const option of field.options) {
            const text = at(catalog, ['eventTypes', type.key, 'options', field.key, option]);
            expect(text, `${type.key}.${field.key}.${option}`).toEqual(expect.any(String));
          }
        }
      }
    },
  );

  describe('in pt-BR', () => {
    beforeEach(async () => {
      await useTestLocale('pt-BR');
    });

    afterEach(async () => {
      await useTestLocale('en');
    });

    it('name the types and presets as the brief asks', () => {
      expect(MORE_BUILT_IN_TYPES.map((type) => eventTypeText.typeName(type))).toEqual([
        'Cortar unhas',
        'Temperatura',
        'Regurgitação / vômito',
        'Dentição',
        'Marco do desenvolvimento',
        'Sintoma',
        'Ao ar livre',
        'Cuidados com a pele',
      ]);
      expect(presetLabel({ id: 'outdoor', label: 'Outdoor time', builtIn: true })).toBe(
        'Ao ar livre',
      );
    });

    it('write the Day detail lines with the localized number and option labels', () => {
      expect(payloadSummary({ value_c: 37.8, method: 'armpit' }, TEMPERATURE_TYPE)).toBe(
        '37,8 °C · Axila',
      );
      expect(payloadSummary({ where: 'feet' }, NAIL_TRIM_TYPE)).toBe('Pés');
      expect(payloadSummary({ kind: 'spit_up', amount: 'some' }, SPIT_UP_TYPE)).toBe(
        'Regurgitação · Médio',
      );
      expect(
        payloadSummary(
          { stage: 'tooth_came_through', tooth: 'upper_lateral_incisor' },
          TEETHING_TYPE,
        ),
      ).toBe('Dente nasceu · Incisivo lateral superior');
      expect(payloadSummary({ milestone: 'holds_head' }, MILESTONE_TYPE)).toBe('Sustenta a cabeça');
      expect(payloadSummary({ milestone: 'other', custom: 'Deu tchau' }, MILESTONE_TYPE)).toBe(
        'Deu tchau',
      );
      expect(payloadSummary({ symptom: 'rash', severity: 'severe' }, SYMPTOM_TYPE)).toBe(
        'Manchas na pele · Intenso',
      );
      expect(payloadSummary({ kind: 'sun' }, OUTDOOR_TYPE)).toBe('Banho de sol');
      expect(payloadSummary({ product: 'sunscreen' }, SKIN_CARE_TYPE)).toBe('Protetor solar');
    });

    it('label the conditional fields', () => {
      expect(eventTypeText.fieldLabel(TEETHING_TYPE, TEETHING_TYPE.fields[1])).toBe('Dente');
      expect(eventTypeText.fieldLabel(MILESTONE_TYPE, MILESTONE_TYPE.fields[1])).toBe(
        'Qual marco?',
      );
    });
  });
});
