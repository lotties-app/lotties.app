import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en/board.json';
import ptBR from '../i18n/locales/pt-BR/board.json';
import { BOARD_SIDES, BOARD_TYPES } from './boardApi';

/*
 * The quick-add placeholder and caption are written per type (article and gender of each
 * language), with the side as a lower-case phrase: never a capitalised type name mid-sentence.
 */
const catalogs = { en: en.board, 'pt-BR': ptBR.board } as const;

const caption = (lang: keyof typeof catalogs, type: string, side: string) => {
  const board = catalogs[lang];
  const hint = board.quickAdd.hints[type as keyof typeof board.quickAdd.hints];
  return hint.replace(
    '{{side}}',
    board.quickAdd.forSide[side as keyof typeof board.quickAdd.forSide],
  );
};

describe('the quick-add caption', () => {
  it.each(Object.keys(catalogs) as (keyof typeof catalogs)[])(
    'has a sentence per type and a phrase per side in %s, all lower case',
    (lang) => {
      const board = catalogs[lang];
      for (const type of BOARD_TYPES) {
        const label = board.types[type];
        const hint = board.quickAdd.hints[type];
        const placeholder = board.quickAdd.placeholders[type];
        expect(hint).toContain('{{side}}');
        expect(hint).toContain(label.toLowerCase());
        expect(hint).not.toContain(label);
        expect(placeholder).toContain(label.toLowerCase());
        expect(placeholder).not.toContain(label);
      }
      for (const side of BOARD_SIDES) {
        const phrase = board.quickAdd.forSide[side];
        expect(phrase).toBe(phrase.toLowerCase());
        expect(phrase).not.toContain(board.sides[side]);
      }
    },
  );

  it('reads naturally in English and Portuguese', () => {
    expect(caption('en', 'task', 'both')).toBe(
      'Adds a task for both. Open More fields for the rest.',
    );
    expect(caption('en', 'risk', 'assistant')).toBe(
      'Adds a risk for the assistant. Open More fields for the rest.',
    );
    expect(caption('pt-BR', 'task', 'both')).toBe(
      'Adiciona uma tarefa para ambos. Abra Mais campos para o resto.',
    );
    expect(caption('pt-BR', 'risk', 'owner')).toBe(
      'Adiciona um risco para o titular. Abra Mais campos para o resto.',
    );
    expect(caption('pt-BR', 'memory', 'external')).toBe(
      'Adiciona uma memória para alguém de fora. Abra Mais campos para o resto.',
    );
  });
});
