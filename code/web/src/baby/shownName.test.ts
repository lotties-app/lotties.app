import { describe, expect, it } from 'vitest';
import { formatAge } from '../i18n/format';
import { babyShownName, personShownName, roleLabelText } from './shownName';

describe('babyShownName', () => {
  it('prefers the real name', () => {
    expect(babyShownName({ name: ' Lia ', label: 'girl' })).toBe('Lia');
  });

  it('falls back to the localized preset label', () => {
    expect(babyShownName({ name: '', label: 'girl' })).toBe('Girl');
    expect(babyShownName({ name: '', label: 'boy' })).toBe('Boy');
  });

  it('shows a custom label as typed and defaults to Baby', () => {
    expect(babyShownName({ name: '', label: 'Little one' })).toBe('Little one');
    expect(babyShownName({ name: '' })).toBe('Baby');
  });
});

describe('personShownName', () => {
  it('uses name, then role label, then specialty, then the fallback', () => {
    expect(personShownName({ displayName: 'Ana', roleLabel: 'mother' })).toBe('Ana');
    expect(personShownName({ displayName: '', roleLabel: 'grandmother' })).toBe('Grandmother');
    expect(personShownName({ displayName: '', roleLabel: null }, 'x', 'Pediatrics')).toBe(
      'Pediatrics',
    );
    expect(personShownName({ displayName: '' }, 'Unnamed')).toBe('Unnamed');
  });

  it('shows a custom role label as typed', () => {
    expect(roleLabelText('Neighbour')).toBe('Neighbour');
  });
});

describe('formatAge for a baby stored by week', () => {
  const now = new Date(2026, 10, 6);
  it('reads whole weeks under 12 weeks', () => {
    expect(formatAge('2026-11-02', now, 'en', true)).toBe('0 weeks');
    expect(formatAge('2026-10-05', now, 'en', true)).toBe('4 weeks');
  });

  it('reads months after 12 weeks like an exact date', () => {
    expect(formatAge('2026-06-01', now, 'en', true)).toBe(formatAge('2026-06-01', now, 'en'));
  });
});
