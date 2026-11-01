import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import {
  BABY_ID,
  fakeApi,
  httpError,
  networkError,
  testDatabase,
  type ApiHandler,
} from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { ProviderSheet } from './ProviderSheet';
import type { CepAddressDto, PlaceDto } from './addressLookup';

/*
 * The address lookup inside the provider sheet (docs/design/23-address-lookup.md): a CEP fills the
 * address, a search lists places to pick, number and complement recompose the text, and every
 * failure leaves the manual address field as it was. The API is scripted; nothing reaches a network.
 */

const CEP: CepAddressDto = {
  postalCode: '01001000',
  street: 'Praça da Sé',
  neighborhood: 'Sé',
  city: 'São Paulo',
  state: 'SP',
  latitude: null,
  longitude: null,
  source: 'brasilapi',
};

const PLACES: PlaceDto[] = [
  {
    displayName: 'Clínica Exemplo, Avenida Paulista, São Paulo',
    name: 'Clínica Exemplo',
    street: 'Avenida Paulista',
    houseNumber: '1000',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    postalCode: '01310-100',
    country: 'Brasil',
    latitude: -23.56,
    longitude: -46.65,
  },
  {
    displayName: 'Rua Augusta, São Paulo',
    name: null,
    street: 'Rua Augusta',
    houseNumber: null,
    neighborhood: 'Consolação',
    city: 'São Paulo',
    state: 'SP',
    postalCode: null,
    country: 'Brasil',
    latitude: -23.55,
    longitude: -46.65,
  },
];

let db: BabyRoutineDb;
let onClose: () => void;

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
  onClose = vi.fn();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

function open(handler: ApiHandler) {
  const scripted = fakeApi(handler);
  renderWithDb(db, <ProviderSheet babyId={BABY_ID} onClose={onClose} />, { api: scripted.api });
  return scripted;
}

const lookups = (calls: { path: string }[]) => calls.filter((c) => c.path.includes('/address/'));
const finder = () => screen.getByRole('textbox', { name: /^Find the address/ });
/** The address text; while it is empty the sheet shows a collapsed row that opens it. */
const addressField = () => screen.getByRole('textbox', { name: /^Address/ }) as HTMLTextAreaElement;
const openAddress = () => fireEvent.click(screen.getByRole('button', { name: /^Address/ }));
const find = () => fireEvent.click(screen.getByRole('button', { name: 'Find address' }));
const type = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } });

const cepHandler: ApiHandler = (call) => (call.path.includes('/address/lookup') ? CEP : undefined);
const searchHandler: ApiHandler = (call) =>
  call.path.includes('/address/search') ? { results: PLACES } : undefined;

describe('a CEP', () => {
  it('fills an empty address at once, then number and complement recompose it', async () => {
    const { calls } = open(cepHandler);
    await screen.findByRole('dialog');

    type(finder(), '01001-000');
    find();

    await waitFor(() =>
      expect(addressField().value).toBe('Praça da Sé\nSé\nSão Paulo - SP\nCEP 01001-000'),
    );
    expect(lookups(calls).map((c) => c.path)).toEqual(['/api/v1/address/lookup?cep=01001000']);
    expect(lookups(calls)[0]).toMatchObject({ method: 'GET', body: undefined });
    expect(screen.getByRole('status').textContent).toContain('Address filled in below');

    type(screen.getByRole('textbox', { name: /^Number/ }), '100');
    type(screen.getByRole('textbox', { name: /^Complement/ }), 'Sala 2');
    expect(addressField().value).toBe(
      'Praça da Sé, 100 - Sala 2\nSé\nSão Paulo - SP\nCEP 01001-000',
    );
  });

  it('does not rewrite an address the parent edited by hand', async () => {
    open(cepHandler);
    await screen.findByRole('dialog');
    type(finder(), '01001000');
    find();
    await waitFor(() => expect(addressField().value).toContain('Praça da Sé'));

    type(addressField(), 'My own text');
    type(screen.getByRole('textbox', { name: /^Number/ }), '5');

    expect(addressField().value).toBe('My own text');
  });

  it('offers the address instead of replacing one that is already typed', async () => {
    open(cepHandler);
    await screen.findByRole('dialog');
    openAddress();
    type(addressField(), 'Typed before');
    type(finder(), '01001000');
    find();

    const list = await screen.findByRole('list', { name: 'Addresses found' });
    expect(addressField().value).toBe('Typed before');
    fireEvent.click(within(list).getByRole('button', { name: /Praça da Sé/ }));

    expect(addressField().value).toBe('Praça da Sé\nSé\nSão Paulo - SP\nCEP 01001-000');
    expect(screen.queryByRole('list', { name: 'Addresses found' })).toBeNull();
  });

  it('is triggered by Enter in the box without saving the provider', async () => {
    const { calls } = open(cepHandler);
    await screen.findByRole('dialog');

    type(finder(), '01001000');
    fireEvent.keyDown(finder(), { key: 'Enter' });

    await waitFor(() => expect(addressField().value).toContain('Praça da Sé'));
    expect(lookups(calls)).toHaveLength(1);
    expect(await db.careProviders.count()).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('a search', () => {
  it('asks only when the button is pressed, never while typing', async () => {
    const { calls } = open(searchHandler);
    await screen.findByRole('dialog');

    type(finder(), 'Cl');
    type(finder(), 'Clínica Exemplo');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(lookups(calls)).toHaveLength(0);
    find();
    await screen.findByRole('list', { name: 'Addresses found' });
    expect(lookups(calls).map((c) => c.path)).toEqual([
      '/api/v1/address/search?q=Cl%C3%ADnica%20Exemplo&lang=en',
    ]);
  });

  it('lists the places with the OpenStreetMap attribution, and a pick fills the address', async () => {
    open(searchHandler);
    await screen.findByRole('dialog');
    type(finder(), 'Avenida Paulista');
    find();

    const list = await screen.findByRole('list', { name: 'Addresses found' });
    const options = within(list).getAllByRole('button');
    expect(options).toHaveLength(2);
    expect(options[0]!.textContent).toContain('Clínica Exemplo');
    expect(options[0]!.textContent).toContain('Avenida Paulista, 1000');
    const attribution = screen.getByRole('link', { name: 'Data © OpenStreetMap contributors' });
    expect(attribution.getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
    expect(attribution.getAttribute('rel')).toContain('noopener');

    fireEvent.click(options[0]!);

    expect(addressField().value).toBe(
      'Avenida Paulista, 1000\nBela Vista\nSão Paulo - SP\nCEP 01310-100',
    );
    expect(screen.getByRole('textbox', { name: /^Number/ })).toHaveProperty('value', '1000');
    expect(screen.getByRole('link', { name: /OpenStreetMap/ })).toBeTruthy();
  });

  it('says so when nothing matches and leaves the address alone', async () => {
    open((call) => (call.path.includes('/address/search') ? { results: [] } : undefined));
    await screen.findByRole('dialog');
    openAddress();
    type(addressField(), 'Kept');
    type(finder(), 'Nowhere Land');
    find();

    expect(await screen.findByText(/No address found\./)).toBeTruthy();
    expect(addressField().value).toBe('Kept');
    expect(screen.queryByRole('link', { name: /OpenStreetMap/ })).toBeNull();
  });
});

describe('when the lookup cannot help', () => {
  it('refuses text that is too short without asking', async () => {
    const { calls } = open(cepHandler);
    await screen.findByRole('dialog');

    type(finder(), 'ab');
    find();

    expect((await screen.findByRole('alert')).textContent).toContain('at least 3 characters');
    expect(lookups(calls)).toHaveLength(0);
  });

  it.each([
    [
      'an unknown CEP',
      () => httpError(404, 'address_not_found'),
      'No address was found for that postal code',
    ],
    [
      'an upstream failure',
      () => httpError(502, 'address_lookup_unavailable'),
      'unavailable right now',
    ],
    [
      'the lookup switched off',
      () => httpError(503, 'address_lookup_disabled'),
      'turned off on this server',
    ],
    ['the rate limit', () => httpError(429, 'rate_limited'), 'Too many requests'],
    ['a lost connection', () => networkError(), 'You are offline'],
  ])(
    'shows a clear message for %s and the manual field keeps working',
    async (_name, fail, text) => {
      open(() => {
        throw fail();
      });
      await screen.findByRole('dialog');
      type(finder(), '99999999');
      find();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(text);
      expect(alert.textContent).toContain('You can type the address below.');
      openAddress();
      type(addressField(), 'Rua Manual, 1');
      expect(addressField().value).toBe('Rua Manual, 1');
      expect(screen.getByRole('button', { name: 'Find address' })).toHaveProperty(
        'disabled',
        false,
      );
    },
  );

  it('is disabled with a note while the device is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { calls } = open(cepHandler);
    await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: 'Find address' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/You are offline, so the address can't be looked up/)).toBeTruthy();
    openAddress();
    type(addressField(), 'Typed by hand');
    expect(addressField().value).toBe('Typed by hand');
    expect(lookups(calls)).toHaveLength(0);
  });

  it('saves the provider with the composed address like any typed one', async () => {
    open(cepHandler);
    await screen.findByRole('dialog');
    type(screen.getByRole('textbox', { name: /^Name/ }), 'Dr. Eva');
    type(finder(), '01001000');
    find();
    await waitFor(() => expect(addressField().value).toContain('Praça da Sé'));
    type(screen.getByRole('textbox', { name: /^Number/ }), '100');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [stored] = await db.careProviders.toArray();
    expect(stored?.address).toBe('Praça da Sé, 100\nSé\nSão Paulo - SP\nCEP 01001-000');
  });
});

describe('pt-BR', () => {
  it('reads the finder, the extras and the attribution in Portuguese', async () => {
    await useTestLocale('pt-BR');
    const { calls } = open(searchHandler);
    await screen.findByRole('dialog');

    type(screen.getByRole('textbox', { name: /^Buscar o endereço/ }), 'Rua Augusta');
    fireEvent.click(screen.getByRole('button', { name: 'Buscar endereço' }));

    const list = await screen.findByRole('list', { name: 'Endereços encontrados' });
    expect(lookups(calls)[0]!.path).toContain('lang=pt-BR');
    expect(
      screen.getByRole('link', { name: 'Dados © colaboradores do OpenStreetMap' }),
    ).toBeTruthy();
    fireEvent.click(within(list).getAllByRole('button')[1]!);
    expect(screen.getByRole('textbox', { name: /^Número(?! do)/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^Complemento/ })).toBeTruthy();
  });
});

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe.each(['light', 'dark'] as const)('the address finder in the %s scheme', (scheme) => {
  it('has no accessibility violations with results and the extras showing', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    open(searchHandler);
    await screen.findByRole('dialog');
    type(finder(), 'Avenida Paulista');
    find();
    const list = await screen.findByRole('list', { name: 'Addresses found' });
    expect(await violations()).toEqual([]);

    fireEvent.click(within(list).getAllByRole('button')[0]!);
    expect(await violations()).toEqual([]);
  }, 60_000);
});
