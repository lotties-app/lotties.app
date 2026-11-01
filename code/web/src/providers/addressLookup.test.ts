import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/apiClient';
import { ApiError } from '../api/ApiError';
import {
  candidateOfCep,
  candidateOfPlace,
  composeAddress,
  formatCep,
  isCep,
  lookupCep,
  lookupText,
  searchPlaces,
  type CepAddressDto,
  type PlaceDto,
} from './addressLookup';

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

const PLACE: PlaceDto = {
  displayName: 'Clínica Exemplo, Avenida Paulista, São Paulo, Brasil',
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
};

const none = { number: '', complement: '' };

describe('CEP detection', () => {
  it.each(['01001000', '01001-000', ' 01001-000 '])('accepts %j', (text) => {
    expect(isCep(text)).toBe(true);
  });

  it.each(['0100100', '010010000', '01001-00', 'abcde-fgh', '01001 000', 'Rua 12'])(
    'rejects %j',
    (text) => {
      expect(isCep(text)).toBe(false);
    },
  );

  it('formats 8 digits with the hyphen and leaves other codes alone', () => {
    expect(formatCep('01001000')).toBe('01001-000');
    expect(formatCep('SW1A 2AA')).toBe('SW1A 2AA');
  });
});

describe('what the typed text asks for', () => {
  it('drops the hyphen of a CEP', () => {
    expect(lookupText(' 01001-000 ')).toEqual({ kind: 'cep', text: '01001000' });
  });

  it('collapses whitespace in a search and caps it at the API limit', () => {
    expect(lookupText('  Rua   Augusta,  SP ')).toEqual({
      kind: 'search',
      text: 'Rua Augusta, SP',
    });
    expect(lookupText('a'.repeat(300)).text).toHaveLength(120);
  });

  it('refuses text shorter than 3 characters without asking', () => {
    expect(lookupText(' ab ').kind).toBe('short');
    expect(lookupText('').kind).toBe('short');
  });
});

describe('composing the address text', () => {
  it('writes street and number, neighborhood, city and state, and the CEP', () => {
    expect(composeAddress(candidateOfCep(CEP), { number: '100', complement: '' })).toBe(
      'Praça da Sé, 100\nSé\nSão Paulo - SP\nCEP 01001-000',
    );
  });

  it('puts the complement after the number and keeps it when there is no number', () => {
    expect(composeAddress(candidateOfCep(CEP), { number: '100', complement: 'Sala 2' })).toContain(
      'Praça da Sé, 100 - Sala 2\n',
    );
    expect(composeAddress(candidateOfCep(CEP), { number: '', complement: 'Sala 2' })).toContain(
      'Praça da Sé - Sala 2\n',
    );
  });

  it('skips the pieces the service did not know', () => {
    const partial = candidateOfCep({ ...CEP, street: null, neighborhood: null });
    expect(composeAddress(partial, none)).toBe('São Paulo - SP\nCEP 01001-000');
  });

  it('shows a place postal code that is not a CEP as it is', () => {
    const london = candidateOfPlace(
      {
        ...PLACE,
        street: 'Downing Street',
        city: 'London',
        state: 'England',
        postalCode: 'SW1A 2AA',
      },
      0,
    );
    expect(composeAddress(london, { number: '10', complement: '' })).toBe(
      'Downing Street, 10\nBela Vista\nLondon - England\nSW1A 2AA',
    );
  });

  it('falls back to the one-line text when there is neither street nor city', () => {
    const vague = candidateOfPlace(
      {
        ...PLACE,
        street: null,
        city: null,
        neighborhood: null,
        state: null,
        postalCode: null,
        displayName: 'Parque Ibirapuera, São Paulo, Brasil',
      },
      0,
    );
    expect(composeAddress(vague, { number: '', complement: '' })).toBe(
      'Parque Ibirapuera, São Paulo, Brasil',
    );
  });

  it('never exceeds the 400 characters of the address field', () => {
    const long = candidateOfCep({ ...CEP, street: 'R'.repeat(500) });
    expect(composeAddress(long, none)).toHaveLength(400);
  });
});

describe('the API calls (mocked fetch)', () => {
  function clientWith(response: { status: number; body: unknown }) {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: async () => 'token',
      fetchImpl,
    });
    return { api, fetchImpl };
  }

  it('asks the CEP route with only the digits', async () => {
    const { api, fetchImpl } = clientWith({ status: 200, body: CEP });

    await expect(lookupCep(api, '01001000')).resolves.toEqual(CEP);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/v1/address/lookup?cep=01001000');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('asks the search route with the encoded text and the language', async () => {
    const { api, fetchImpl } = clientWith({ status: 200, body: { results: [PLACE] } });

    await expect(searchPlaces(api, 'Rua & Flores 10', 'pt-BR')).resolves.toEqual([PLACE]);

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.test/api/v1/address/search?q=Rua%20%26%20Flores%2010&lang=pt-BR');
  });

  it('turns a missing results list into an empty one', async () => {
    const { api } = clientWith({ status: 200, body: {} });

    await expect(searchPlaces(api, 'nowhere', undefined)).resolves.toEqual([]);
  });

  it('fails with the API error code on 404', async () => {
    const { api } = clientWith({ status: 404, body: { code: 'address_not_found' } });

    const error = await lookupCep(api, '99999999').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('address_not_found');
  });
});
