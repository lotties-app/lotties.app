import { describe, expect, it } from 'vitest';
import vectors from '../voice/handsFreeCommandVectors.json';
import { parseCommand } from '../voice/commandParser';
import { LAB_CONDITIONS, LAB_PHRASES, phrasesFor } from './labPhrases';

/* The phrases the lab reads aloud are design 49 section 7.3, and the parser's vectors say the same. */

describe('lab phrases', () => {
  it('are the 24 pt-BR phrases, the 10 en ones and the US one', () => {
    expect(LAB_PHRASES['pt-BR']).toHaveLength(24);
    expect(LAB_PHRASES.en).toHaveLength(11);
    expect(LAB_PHRASES.en.filter((p) => p.units === 'us').map((p) => p.text)).toEqual([
      'four ounce bottle',
    ]);
  });

  it.each([...LAB_PHRASES['pt-BR'], ...LAB_PHRASES.en].map((p) => [p.id, p] as const))(
    '%s matches its vector and parses to what it expects',
    (_, phrase) => {
      const vector = vectors.cases.find((c) => c.id === phrase.id);
      expect(vector?.text).toBe(phrase.text);
      expect(vector?.locale).toBe(phrase.locale);
      expect(vector?.units ?? 'metric').toBe(phrase.units);
      const result = parseCommand(phrase.text, { locale: phrase.locale, units: phrase.units });
      if (phrase.expected.type === 'command') {
        expect(vector?.expect).toEqual(phrase.expected.command);
        expect(result).toEqual({ outcome: 'command', command: phrase.expected.command });
      } else {
        expect(vector?.expect.outcome).toBe(phrase.expected.outcome);
        expect(result.outcome).toBe(phrase.expected.outcome);
      }
    },
  );

  it('selects the section 7.3 subsets for C2 and C4 in pt-BR', () => {
    const numbers = (condition: (typeof LAB_CONDITIONS)[number]) =>
      phrasesFor('pt-BR', condition).map((p) => p.number);
    expect(numbers('C1')).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(numbers('C2')).toEqual([1, 7, 10, 12, 14, 16, 18, 21]);
    expect(numbers('C3')).toHaveLength(24);
    expect(numbers('C4')).toEqual([1, 7, 12, 16, 21]);
    // About 61 on-device utterances per phone (section 7.3).
    expect(LAB_CONDITIONS.reduce((sum, c) => sum + phrasesFor('pt-BR', c).length, 0)).toBe(61);
  });

  it('reads the whole English list in every condition', () => {
    for (const condition of LAB_CONDITIONS) expect(phrasesFor('en', condition)).toHaveLength(11);
  });
});
