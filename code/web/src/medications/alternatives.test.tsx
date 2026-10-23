import axe from 'axe-core';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { AlternativeLevel, ProductDto, ProductMatchDto } from '../sync/contract';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { alternativeLevel } from './catalogApi';
import { MedicationChooser } from './MedicationChooser';

/* The "same active ingredient" list is grouped and labelled by how the alternative compares
   (docs/design/13-anvisa-catalog.md section 12). Synthetic products only. */

const SALINE = {
  substanceId: 's-nacl',
  key: 'sodium_chloride',
  nameEn: 'Sodium chloride',
  namePtBr: 'Cloreto de sódio',
  strength: null,
};

function product(over: Partial<ProductDto>): ProductDto {
  return {
    id: 'p',
    name: 'P',
    form: 'spray',
    country: 'BR',
    status: 'official',
    mergedIntoId: null,
    substances: [SALINE],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const SEARCHED = product({ id: 'p-iso', name: 'Zaline Iso', strengthText: '9 mg/mL' });

function sibling(id: string, name: string, level: AlternativeLevel | null, over = {}) {
  return {
    id,
    name,
    form: 'spray' as const,
    country: 'BR',
    status: 'official',
    strengthText: null,
    ...(level ? { matchLevel: level } : {}),
    ...over,
  };
}

const RESULT: ProductMatchDto = {
  product: SEARCHED,
  matchedBy: 'name',
  distance: 0,
  sameActiveIngredient: [
    sibling('a', 'Zaline Curado', 'equivalent', { strengthText: '9 mg/mL' }),
    sibling('b', 'Zaline Gotas', 'differentForm', { form: 'drops', strengthText: '9 mg/mL' }),
    sibling('c', 'Zaline Nua', 'strengthNotKnown'),
    sibling('d', 'Zaline Forte', 'differentStrength', { strengthText: '30 mg/mL' }),
  ],
};

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db, { medications: true });
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  window.localStorage.clear();
  await db.delete();
});

function renderResult(result: ProductMatchDto = RESULT) {
  const { api } = fakeApi((call) =>
    call.path.includes('/catalog/products') ? [result] : undefined,
  );
  const onChange = vi.fn();
  renderWithDb(db, <MedicationChooser babyId={BABY_ID} value={null} onChange={onChange} />, {
    api,
  });
  return { onChange };
}

const search = async (query: string) => {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  return screen.findByRole('note');
};

describe('alternatives with the same active ingredient', () => {
  it('groups them by level, equivalent first, each with strength and form', async () => {
    renderResult();
    const note = await search('zaline');

    const groups = Array.from(note.querySelectorAll('p[data-level]')).map((p) => [
      p.getAttribute('data-level'),
      p.textContent,
    ]);
    expect(groups).toEqual([
      ['equivalent', 'Same ingredient, strength and form: Zaline Curado (9 mg/mL, Spray)'],
      [
        'differentForm',
        'Same ingredient and strength, other or unknown form: Zaline Gotas (9 mg/mL, Drops)',
      ],
      ['strengthNotKnown', 'Same ingredient, strength not known: Zaline Nua (Spray)'],
      ['differentStrength', 'Same ingredient, different strength: Zaline Forte (30 mg/mL, Spray)'],
    ]);
    expect(note.textContent).toContain('Ask your doctor or pharmacist before substituting.');
    expect(note.textContent).toContain('The dose comes only from the prescription.');
  });

  it('shows the strength of the searched product on its own line', async () => {
    renderResult();
    await search('zaline');

    const button = await screen.findByRole('button', { name: 'Add Zaline Iso from the catalog' });
    expect(button.textContent).toMatch(/Spray · 9 mg\/mL · Sodium chloride/);
  });

  it('never selects an alternative by itself: they are information, not choices', async () => {
    const { onChange } = renderResult();
    const note = await search('zaline');

    expect(within(note).queryAllByRole('button')).toHaveLength(0);
    expect(within(note).queryAllByRole('link')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /from the catalog$/ })).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('with no strength known anywhere (nothing imported yet) says so neutrally and claims no match', async () => {
    renderResult({
      ...RESULT,
      product: product({ id: 'p-iso', name: 'Zaline Iso' }),
      sameActiveIngredient: [
        sibling('c', 'Zaline Nua', null),
        sibling('e', 'Zaline Dois', 'strengthNotKnown'),
      ],
    });
    const note = await search('zaline');

    expect(note.querySelectorAll('p[data-level]')).toHaveLength(1);
    expect(note.textContent).toContain(
      'Same ingredient, strength not known: Zaline Nua (Spray) and Zaline Dois (Spray)',
    );
    expect(note.textContent).not.toMatch(/strength and form|different strength/);
  });

  it('treats an unknown level from a newer server as strength not known, never equivalent', () => {
    expect(alternativeLevel({ matchLevel: 'equivalent' })).toBe('equivalent');
    expect(alternativeLevel({})).toBe('strengthNotKnown');
    expect(alternativeLevel({ matchLevel: null })).toBe('strengthNotKnown');
    expect(alternativeLevel({ matchLevel: 'same' as AlternativeLevel })).toBe('strengthNotKnown');
  });

  it('reads in pt-BR', async () => {
    await useTestLocale('pt-BR');
    renderResult();
    const note = await search('zaline');

    const text = note.textContent ?? '';
    expect(text).toContain('Contém o mesmo princípio ativo: Cloreto de sódio.');
    expect(text).toContain('Mesmo princípio ativo, concentração e forma: Zaline Curado (9 mg/mL,');
    expect(text).toContain(
      'Mesmo princípio ativo e concentração, forma diferente ou não informada',
    );
    expect(text).toContain('Mesmo princípio ativo, concentração não informada: Zaline Nua');
    expect(text).toContain(
      'Mesmo princípio ativo, concentração diferente: Zaline Forte (30 mg/mL,',
    );
    expect(text).toContain('Pergunte ao médico ou ao farmacêutico antes de trocar.');
  });

  it('wraps long names inside the note instead of overflowing a narrow screen', async () => {
    renderResult({
      ...RESULT,
      sameActiveIngredient: [
        sibling(
          'a',
          'Solução Fisiológica de Cloreto de Sódio para Irrigação Estéril Muito Longa',
          'differentForm',
        ),
      ],
    });
    const note = await search('zaline');

    const column = note.querySelector('p')!.parentElement!;
    expect(getComputedStyle(column).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(column).minWidth).toBe('0px');
  });
});

function chooseScheme(scheme: 'light' | 'dark' | 'night') {
  if (scheme === 'night') {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
  }
}

describe.each(['light', 'dark', 'night'] as const)('alternatives in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations (%s)',
    async (locale) => {
      chooseScheme(scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      renderResult();
      const note = await search('zaline');

      const result = await axe.run(note.closest('[role="list"]')?.parentElement ?? document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' '))}`),
      ).toEqual([]);
    },
    30_000,
  );
});
