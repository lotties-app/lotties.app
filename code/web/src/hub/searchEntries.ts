/** Lower case without accents, so "vacina" finds "Vacínas" and "medico" finds "médico". */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
}

/**
 * Whether an entry matches what was typed: every word of the query must start a word of the
 * entry's title, hint or keywords ("vac sh" finds Vaccines with the keyword "shots"). Empty
 * queries match everything.
 */
export function entryMatches(query: string, ...texts: string[]): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeText(texts.join(' ')).split(/[^\p{L}\p{N}]+/u);
  return words.every((word) => haystack.some((candidate) => candidate.startsWith(word)));
}
