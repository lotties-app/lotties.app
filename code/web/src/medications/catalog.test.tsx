import { useState } from 'react';
import axe from 'axe-core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/ApiError';
import {
  cacheProducts,
  matchesOnlyBySubstance,
  productKey,
  searchCachedProducts,
} from '../db/catalogCache';
import type { BabyRoutineDb } from '../db/database';
import type { ProductDto, ProductMatchDto } from '../sync/contract';
import { BABY_ID, fakeApi, testDatabase, type ApiCall } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { MedicationChooser } from './MedicationChooser';
import { siblingsIn } from './catalogApi';

const SIMETHICONE = {
  substanceId: 's-sim',
  key: 'simethicone',
  nameEn: 'Simethicone',
  namePtBr: 'Simeticona',
  strength: { amount: 75, unit: 'mg', perAmount: 1, perUnit: 'mL' },
};

function product(over: Partial<ProductDto> = {}): ProductDto {
  return {
    id: 'p-flygas',
    name: 'Flygas',
    form: 'drops',
    country: 'BR',
    status: 'seed',
    mergedIntoId: null,
    substances: [SIMETHICONE],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const FLYGAS = product();
const LUFTAL = product({ id: 'p-luftal', name: 'Luftal' });

const match = (
  p: ProductDto,
  siblings: ProductDto[] = [],
  matchedBy: ProductMatchDto['matchedBy'] = 'name',
): ProductMatchDto => ({
  product: p,
  matchedBy,
  distance: 0,
  sameActiveIngredient: siblings.map(({ id, name, form, country, status }) => ({
    id,
    name,
    form,
    country,
    status,
  })),
});

let db: BabyRoutineDb;
let calls: ApiCall[];

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db, { medications: true });
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

function Harness({ onPick }: { onPick: (id: string) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <MedicationChooser
      babyId={BABY_ID}
      value={value}
      onChange={(m) => {
        setValue(m.id);
        onPick(m.id);
      }}
    />
  );
}

function renderChooser(handler: (call: ApiCall) => unknown) {
  const { api, calls: recorded } = fakeApi(handler);
  calls = recorded;
  const onPick = vi.fn();
  renderWithDb(db, <Harness onPick={onPick} />, { api });
  return { onPick };
}

const type = (query: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find or add a medication' }), {
    target: { value: query },
  });

describe('shared catalog search', () => {
  it('searches the catalog after a pause, shows the product and the same-ingredient note', async () => {
    renderChooser((call) =>
      call.path.startsWith('/api/v1/catalog/products?q=flygas&limit=10')
        ? [match(FLYGAS, [LUFTAL])]
        : undefined,
    );
    type('flygas');
    // Debounced: nothing is requested while the query is still being typed.
    expect(calls.filter((c) => c.path.includes('/catalog/'))).toHaveLength(0);

    const result = await screen.findByRole('button', { name: 'Add Flygas from the catalog' });
    expect(result.textContent).toMatch(/Flygas/);
    expect(result.textContent).toMatch(/Drops · 75 mg\/1 mL · Simethicone/);
    expect(screen.getByRole('note').textContent).toBe(
      'Contains the same active ingredient as Luftal: Simethicone. Ask your doctor or pharmacist before substituting.',
    );
    expect(calls.filter((c) => c.path.includes('/catalog/'))).toHaveLength(1);
    // The found product is kept for offline search.
    expect(await db.catalogProducts.count()).toBe(1);
  });

  it('choosing a product adds a linked medication and uses it', async () => {
    const { onPick } = renderChooser((call) =>
      call.path.includes('/catalog/products') ? [match(FLYGAS)] : undefined,
    );
    type('flygas');
    fireEvent.click(await screen.findByRole('button', { name: 'Add Flygas from the catalog' }));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    const created = (await db.medications.toArray()).find((m) => m.name === 'Flygas')!;
    expect(created.productId).toBe('p-flygas');
    expect(onPick).toHaveBeenCalledWith(created.id);
    const [queued] = await db.outbox.toArray();
    expect(queued.payload).toMatchObject({ name: 'Flygas', productId: 'p-flygas' });
    // The chosen medication is now shown as chosen, with its product details from the device cache.
    expect(await screen.findByText('Drops · 75 mg/1 mL · Simethicone')).toBeTruthy();
  });

  it('does not duplicate a product the baby already has: it offers that medication', async () => {
    await db.medications.put({
      id: 'm-fly',
      babyId: BABY_ID,
      name: 'My gas drops',
      defaultDosage: null,
      notes: null,
      isUsual: false,
      productId: 'p-flygas',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    const { onPick } = renderChooser((call) =>
      call.path.includes('/catalog/products') ? [match(FLYGAS)] : undefined,
    );
    type('flygas');
    const useExisting = await screen.findByRole('button', {
      name: 'Use My gas drops from your list',
    });
    expect(useExisting.textContent).toMatch(/In your list/);
    fireEvent.click(useExisting);

    await waitFor(() => expect(onPick).toHaveBeenCalledWith('m-fly'));
    expect((await db.medications.toArray()).filter((m) => m.productId === 'p-flygas')).toHaveLength(
      1,
    );
    expect(await db.medications.count()).toBe(4);
  });

  it('adds a product that is not listed, creating a community product', async () => {
    renderChooser((call) => {
      if (call.method === 'POST') {
        return product({ id: 'p-new', name: 'Gasex', status: 'community', substances: [] });
      }
      return [];
    });
    type('gasex');
    fireEvent.click(await screen.findByRole('button', { name: 'Not listed? Add it' }));
    const form = screen.getByRole('group', { name: 'Add to the shared catalog' });
    fireEvent.click(within(form).getByRole('radio', { name: 'Syrup' }));
    fireEvent.change(within(form).getByRole('textbox', { name: /^Country code/ }), {
      target: { value: 'br' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add to catalog' }));

    await waitFor(async () =>
      expect((await db.medications.toArray()).some((m) => m.productId === 'p-new')).toBe(true),
    );
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/api/v1/catalog/products');
    expect(post.body).toEqual({ name: 'gasex', form: 'syrup', country: 'BR' });
  });

  it('409 product_exists shows and uses the existing product instead of failing', async () => {
    renderChooser((call) => {
      if (call.method === 'POST') {
        throw new ApiError(409, { code: 'product_exists', status: 409, product: FLYGAS });
      }
      return [];
    });
    type('Fly Gas');
    fireEvent.click(await screen.findByRole('button', { name: 'Not listed? Add it' }));
    const form = screen.getByRole('group', { name: 'Add to the shared catalog' });
    fireEvent.click(within(form).getByRole('radio', { name: 'Drops' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add to catalog' }));

    await waitFor(async () => {
      const linked = (await db.medications.toArray()).filter((m) => m.productId === 'p-flygas');
      expect(linked).toHaveLength(1);
      expect(linked[0].name).toBe('Flygas');
    });
    // The existing product was cached, so it stays searchable offline.
    expect((await db.catalogProducts.get('p-flygas'))?.product.name).toBe('Flygas');
  });

  it('validates the new product before sending it', async () => {
    renderChooser(() => []);
    type('gasex');
    fireEvent.click(await screen.findByRole('button', { name: 'Not listed? Add it' }));
    const form = screen.getByRole('group', { name: 'Add to the shared catalog' });
    fireEvent.change(within(form).getByRole('textbox', { name: /^Country code/ }), {
      target: { value: '1' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add to catalog' }));

    expect(await within(form).findByText('Choose a form.')).toBeTruthy();
    expect(within(form).getByText('Use a two-letter country code.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

const OFFICIAL_LUFTAL = product({
  id: 'p-off-luftal',
  name: 'Luftal',
  status: 'official',
  source: 'anvisa',
  substances: [{ ...SIMETHICONE, strength: null }],
});
const OFFICIAL_GENERIC = product({
  id: 'p-off-generic',
  name: 'Simeticona',
  status: 'official',
  source: 'anvisa',
  presentation: '75 MG/ML',
  substances: [{ ...SIMETHICONE, strength: null }],
});

/** The API reply for "simeticona": the generic by name, Luftal and Flygas by their ingredient. */
const ingredientSearch = (call: ApiCall) =>
  call.path.startsWith('/api/v1/catalog/products?q=simeticona')
    ? [
        match(OFFICIAL_GENERIC, [OFFICIAL_LUFTAL, FLYGAS]),
        match(OFFICIAL_LUFTAL, [OFFICIAL_GENERIC, FLYGAS], 'substance'),
        match(FLYGAS, [OFFICIAL_GENERIC, OFFICIAL_LUFTAL], 'substance'),
      ]
    : undefined;

describe('search by active ingredient and the official list', () => {
  it('lists the products with the typed ingredient in their own section, information only', async () => {
    renderChooser(ingredientSearch);
    type('simeticona');

    const section = await screen.findByRole('region', { name: 'Products with this ingredient' });
    expect(
      within(section).getByText(
        'Information only. Ask your doctor or pharmacist before substituting.',
      ),
    ).toBeTruthy();
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(
      within(section).getByRole('button', { name: 'Add Luftal from the catalog' }),
    ).toBeTruthy();
    // The product matched by name stays in the main list, outside the ingredient section.
    const main = screen.getByRole('list', { name: 'From the shared catalog' });
    expect(
      within(main).getByRole('button', { name: 'Add Simeticona from the catalog' }),
    ).toBeTruthy();
    expect(main.textContent).toMatch(/Drops · 75 MG\/ML · Simethicone/);
  });

  it('choosing a product of the ingredient section selects it like any result', async () => {
    const { onPick } = renderChooser(ingredientSearch);
    type('simeticona');
    const section = await screen.findByRole('region', { name: 'Products with this ingredient' });
    fireEvent.click(within(section).getByRole('button', { name: 'Add Luftal from the catalog' }));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    const created = (await db.medications.toArray()).find((m) => m.name === 'Luftal')!;
    expect(created.productId).toBe('p-off-luftal');
    // Only the picked official product is kept on the device; the other official results are not.
    expect((await db.catalogProducts.toArray()).map((row) => row.id).sort()).toEqual([
      'p-flygas',
      'p-off-luftal',
    ]);
  });

  it('labels official products and shows the source attribution once', async () => {
    renderChooser(ingredientSearch);
    type('simeticona');
    await screen.findByRole('region', { name: 'Products with this ingredient' });

    expect(screen.getAllByText('Official list (ANVISA)')).toHaveLength(2);
    expect(
      screen.getAllByText(
        'Source: Anvisa open data (registered medicines and the CMED price list). Not reviewed by a pharmacist; not medical advice.',
      ),
    ).toHaveLength(1);
    expect(screen.getAllByRole('note')[0].textContent).toBe(
      'Contains the same active ingredient as Luftal and Flygas: Simethicone. Ask your doctor or pharmacist before substituting.',
    );
  });

  it('has no axe violation in the results with the ingredient section', async () => {
    renderChooser(ingredientSearch);
    type('simeticona');
    const section = await screen.findByRole('region', { name: 'Products with this ingredient' });

    const results = await axe.run(section.parentElement!);
    expect(results.violations).toEqual([]);
  });

  it('shows no attribution when no official product is listed', async () => {
    renderChooser((call) =>
      call.path.includes('/catalog/products') ? [match(FLYGAS)] : undefined,
    );
    type('flygas');
    await screen.findByRole('button', { name: 'Add Flygas from the catalog' });

    expect(screen.queryByText(/^Source: Anvisa/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Products with this ingredient' })).toBeNull();
  });

  it('reads in pt-BR', async () => {
    await useTestLocale('pt-BR');
    renderChooser(ingredientSearch);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'simeticona' } });

    const section = await screen.findByRole('region', {
      name: 'Produtos com este princípio ativo',
    });
    expect(
      within(section).getByText(
        'Apenas informativo. Pergunte ao médico ou ao farmacêutico antes de trocar.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Lista oficial (Anvisa)')).toHaveLength(2);
    expect(screen.getByText(/^Fonte: dados abertos da Anvisa/)).toBeTruthy();
  });
});

const SORINE_DECONGESTANT = product({
  id: 'p-sorine-naf',
  name: 'Sorine (cloridrato de nafazolina)',
  status: 'official',
  source: 'anvisa',
  ambiguousName: 'Sorine',
  substances: [
    {
      substanceId: 's-naf',
      key: 'naphazoline',
      nameEn: 'Naphazoline',
      namePtBr: 'Nafazolina',
      strength: null,
    },
  ],
});
const SORINE_UNKNOWN = product({
  id: 'p-sorine-none',
  name: 'Sorine (princípio ativo não informado)',
  form: 'other',
  status: 'official',
  source: 'anvisa',
  ambiguousName: 'Sorine',
  substances: [],
});
const SORINE_SALINE = product({
  id: 'p-sorine-saline',
  name: 'Sorine Solução Nasal Salina',
  form: 'spray',
  status: 'curated',
  source: 'curated',
  substances: [
    {
      substanceId: 's-nacl',
      key: 'sodium_chloride',
      nameEn: 'Sodium chloride',
      namePtBr: 'Cloreto de sódio',
      strength: null,
    },
  ],
});

const sorineSearch = (call: ApiCall) =>
  call.path.startsWith('/api/v1/catalog/products?q=sorine')
    ? [match(SORINE_DECONGESTANT), match(SORINE_UNKNOWN), match(SORINE_SALINE)]
    : undefined;

describe('ambiguous names, curated products and missing ingredients', () => {
  it('lists every variant of an ambiguous name with its ingredients and a warning to check the box', async () => {
    renderChooser(sorineSearch);
    type('sorine');

    const decongestant = await screen.findByRole('button', {
      name: 'Add Sorine (cloridrato de nafazolina) from the catalog',
    });
    expect(decongestant.textContent).toMatch(/Drops · Naphazoline/);
    const unknown = screen.getByRole('button', {
      name: 'Add Sorine (princípio ativo não informado) from the catalog',
    });
    expect(unknown.textContent).toMatch(/Other · Ingredient not listed in the official data/);
    expect(
      screen.getAllByText(
        'Different products share this name with different ingredients. Check the box.',
      ),
    ).toHaveLength(2);
  });

  it('labels curated products apart from the official list and shows their ingredients', async () => {
    renderChooser(sorineSearch);
    type('sorine');

    const saline = await screen.findByRole('button', {
      name: 'Add Sorine Solução Nasal Salina from the catalog',
    });
    expect(saline.textContent).toMatch(/Spray · Sodium chloride/);
    expect(saline.textContent).toMatch(/Curated list \(not reviewed by a pharmacist\)/);
    expect(screen.getAllByText('Official list (ANVISA)')).toHaveLength(2);
    expect(screen.getAllByText('Curated list (not reviewed by a pharmacist)')).toHaveLength(1);
  });

  it('has no axe violation with ambiguous and curated results', async () => {
    renderChooser(sorineSearch);
    type('sorine');
    const list = await screen.findByRole('list', { name: 'From the shared catalog' });

    const results = await axe.run(list.parentElement!);
    expect(results.violations).toEqual([]);
  });

  it('reads in pt-BR', async () => {
    await useTestLocale('pt-BR');
    renderChooser(sorineSearch);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sorine' } });

    const unknown = await screen.findByRole('button', {
      name: 'Adicionar Sorine (princípio ativo não informado) do catálogo',
    });
    expect(unknown.textContent).toMatch(/Princípio ativo não informado nos dados oficiais/);
    expect(
      screen.getAllByText(
        'Produtos diferentes usam este nome com princípios ativos diferentes. Confira a embalagem.',
      ),
    ).toHaveLength(2);
    expect(screen.getByText('Lista curada (não revisada por farmacêutico)')).toBeTruthy();
  });
});

describe('shared catalog search offline', () => {
  it('searches only the products cached on this device and cannot add new ones', async () => {
    await cacheProducts(db, [FLYGAS, LUFTAL]);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderChooser(() => {
      throw new Error('offline');
    });
    type('luftal');

    const result = await screen.findByRole('button', { name: 'Add Luftal from the catalog' });
    expect(result).toBeTruthy();
    expect(screen.getByText('Saved on this device (offline)')).toBeTruthy();
    // The same active ingredient is found among the cached products too.
    expect(screen.getByRole('note').textContent).toMatch(/same active ingredient as Flygas/);
    expect(calls.filter((c) => c.path.includes('/catalog/'))).toHaveLength(0);
    expect(
      (screen.getByRole('button', { name: /^Not listed\?/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // A plain local medication can still be added and linked later.
    type('Gasex local');
    fireEvent.click(await screen.findByRole('button', { name: 'Add "Gasex local"' }));
    await waitFor(async () =>
      expect(
        (await db.medications.toArray()).find((m) => m.name === 'Gasex local')?.productId,
      ).toBeNull(),
    );
  });
});

describe('catalog cache', () => {
  it('matches like the API: no case, diacritics, punctuation or repeated letters', async () => {
    expect(productKey('Fly-Gass')).toBe('flygas');
    expect(productKey('Cólica 2x')).toBe('colica2x');
    await cacheProducts(db, [
      FLYGAS,
      LUFTAL,
      product({ id: 'p-merged', name: 'Flygas Old', mergedIntoId: 'p-flygas' }),
    ]);
    expect((await searchCachedProducts(db, 'FLY gas')).map((p) => p.id)).toEqual(['p-flygas']);
    expect((await searchCachedProducts(db, 'simeticona')).map((p) => p.id).sort()).toEqual([
      'p-flygas',
      'p-luftal',
    ]);
    expect(await searchCachedProducts(db, 'f')).toEqual([]);
  });

  it('lists siblings with exactly the same substance set', () => {
    const other = product({
      id: 'p-x',
      name: 'Other',
      substances: [{ ...SIMETHICONE, substanceId: 's-other' }],
    });
    expect(siblingsIn(FLYGAS, [FLYGAS, LUFTAL, other]).map((s) => s.name)).toEqual(['Luftal']);
  });

  it('lists offline siblings like the API: official first, not the same name, not retired', () => {
    const flygasTablet = product({ id: 'p-fly-tab', name: 'Flygas', form: 'tablet' });
    const retired = product({ id: 'p-old', name: 'Old', status: 'official', inactive: true });
    expect(
      siblingsIn(FLYGAS, [LUFTAL, flygasTablet, retired, OFFICIAL_GENERIC]).map((s) => s.name),
    ).toEqual(['Simeticona', 'Luftal']);
  });

  it('marks offline matches found only through a substance', () => {
    expect(matchesOnlyBySubstance(FLYGAS, 'simeticona')).toBe(true);
    expect(matchesOnlyBySubstance(FLYGAS, 'fly')).toBe(false);
  });

  it('keeps only the most recently used products', async () => {
    const many = Array.from({ length: 205 }, (_, i) =>
      product({ id: `p-${i}`, name: `Prod ${i}` }),
    );
    await cacheProducts(db, many.slice(0, 5), '2026-01-01T00:00:00.000Z');
    await cacheProducts(db, many.slice(5), '2026-02-01T00:00:00.000Z');
    expect(await db.catalogProducts.count()).toBe(200);
    expect(await db.catalogProducts.get('p-0')).toBeUndefined();
  });
});

describe('shared catalog search in Portuguese', () => {
  it('names substances in pt-BR and words the note in pt-BR', async () => {
    await useTestLocale('pt-BR');
    renderChooser((call) =>
      call.path.includes('/catalog/products') ? [match(FLYGAS, [LUFTAL])] : undefined,
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'flygas' } });
    const result = await screen.findByRole('button', { name: 'Adicionar Flygas do catálogo' });
    expect(result.textContent).toMatch(/Gotas · 75 mg\/1 mL · Simeticona/);
    expect(screen.getByRole('note').textContent).toBe(
      'Contém o mesmo princípio ativo de Luftal: Simeticona. Pergunte ao médico ou ao farmacêutico antes de trocar.',
    );
  });
});
