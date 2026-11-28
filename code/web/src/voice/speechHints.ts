import type { SpeechLocale } from './numberWords';

/*
 * Phrases the recogniser is told to favour (docs/design/49-hands-free.md section 3.3): iOS
 * `contextualStrings` (at most 100 short phrases), Android `EXTRA_BIASING_STRINGS` (API 33+). The
 * command words of v1 and the usual bottle amounts, 30 to 240 ml by 10. Hints only bias the
 * recognition; the parser decides what was said.
 */

const AMOUNTS = Array.from({ length: 22 }, (_, i) => String(30 + i * 10));

const WORDS: Readonly<Record<SpeechLocale, readonly string[]>> = {
  'pt-BR': [
    'mamadeira',
    'mililitros',
    'ml',
    'fórmula',
    'leite materno',
    'peito esquerdo',
    'peito direito',
    'lado esquerdo',
    'lado direito',
    'parou de mamar',
    'terminou a mamada',
    'dormiu',
    'pegou no sono',
    'acordou',
    'fralda',
    'xixi',
    'cocô',
    'fralda molhada',
    'quanto leite',
    'última mamada',
  ],
  en: [
    'bottle',
    'ml',
    'ounces',
    'formula',
    'breast milk',
    'left side',
    'right side',
    'start nursing',
    'stop nursing',
    'fell asleep',
    'woke up',
    'wet diaper',
    'dirty diaper',
    'how much milk today',
    'last feed',
  ],
};

/** The hint phrases of `locale`, at most 100 (the iOS limit). */
export function speechHints(locale: SpeechLocale): string[] {
  return [...WORDS[locale], ...AMOUNTS].slice(0, 100);
}
