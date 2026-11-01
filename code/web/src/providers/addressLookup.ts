import type { ApiClient } from '../api/apiClient';
import { apiPaths } from '../sync/contract';
import { PROVIDER_LIMITS } from './providerModel';

/*
 * The address lookup of the provider sheet (docs/design/23-address-lookup.md): the two API calls
 * (a Brazilian CEP, a free-text place search) and the pure helpers that turn an answer into the
 * address text the provider stores. Only the typed CEP or search text goes to the API.
 */

/** The API's answer for a CEP (`GET /address/lookup`). */
export interface CepAddressDto {
  postalCode: string;
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  source: string;
}

/** One OpenStreetMap place (`GET /address/search`). */
export interface PlaceDto {
  displayName: string;
  name: string | null;
  street: string | null;
  houseNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
}

/** An address candidate, whichever service found it: the pieces a form can fill. */
export interface AddressCandidate {
  key: string;
  street: string | null;
  houseNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** The service's one-line text, used when there are no pieces to compose from. */
  fallback: string | null;
  /** A place's own name (a clinic), shown in the result list. */
  name: string | null;
  fromSearch: boolean;
}

/** Shortest and longest search text the API accepts. */
export const SEARCH_MIN_LENGTH = 3;
export const SEARCH_MAX_LENGTH = 120;

const CEP_PATTERN = /^\d{5}-?\d{3}$/;

/** Whether the text is a Brazilian postal code (8 digits, hyphen optional). */
export function isCep(text: string): boolean {
  return CEP_PATTERN.test(text.trim());
}

/** `01001000` shown as `01001-000`; any other text is returned unchanged. */
export function formatCep(code: string): string {
  const digits = code.trim();
  return /^\d{8}$/.test(digits) ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export function candidateOfCep(dto: CepAddressDto): AddressCandidate {
  return {
    key: `cep:${dto.postalCode}`,
    street: dto.street,
    houseNumber: null,
    neighborhood: dto.neighborhood,
    city: dto.city,
    state: dto.state,
    postalCode: dto.postalCode,
    fallback: null,
    name: null,
    fromSearch: false,
  };
}

export function candidateOfPlace(place: PlaceDto, index: number): AddressCandidate {
  return {
    key: `place:${index}:${place.latitude},${place.longitude}`,
    street: place.street,
    houseNumber: place.houseNumber,
    neighborhood: place.neighborhood,
    city: place.city,
    state: place.state,
    postalCode: place.postalCode,
    fallback: place.displayName,
    name: place.name,
    fromSearch: true,
  };
}

export interface AddressExtras {
  /** Typed by the user: the lookup never knows it. */
  number: string;
  complement: string;
}

const clean = (text: string | null | undefined) => (text ?? '').trim();

/**
 * The multi-line address text the provider stores, Brazilian order:
 * `Street, number - complement` / neighborhood / `City - State` / `CEP 01001-000`. A candidate with
 * neither street nor city falls back to the service's one-line text. Within the 400-character
 * limit of the field.
 */
export function composeAddress(candidate: AddressCandidate, extras: AddressExtras): string {
  const street = clean(candidate.street);
  const number = clean(extras.number);
  const complement = clean(extras.complement);
  const city = clean(candidate.city);
  const first = [street, number].filter(Boolean).join(', ');
  const lines = [
    complement ? [first, complement].filter(Boolean).join(' - ') : first,
    clean(candidate.neighborhood),
    [city, clean(candidate.state)].filter(Boolean).join(' - '),
    postalLine(candidate.postalCode),
  ].filter(Boolean);
  const composed =
    !street && !city && candidate.fallback
      ? [clean(candidate.fallback), number, complement].filter(Boolean).join(', ')
      : lines.join('\n');
  return composed.slice(0, PROVIDER_LIMITS.address);
}

function postalLine(postalCode: string | null): string {
  const code = clean(postalCode);
  if (!code) return '';
  return CEP_PATTERN.test(code) ? `CEP ${formatCep(code.replace('-', ''))}` : code;
}

/**
 * What the typed text asks for: a CEP (hyphen dropped), a search (whitespace collapsed, cut to the
 * API's limit) or nothing worth asking (shorter than the API's minimum).
 */
export function lookupText(input: string): { kind: 'cep' | 'search' | 'short'; text: string } {
  const text = input.trim().replace(/\s+/g, ' ');
  if (isCep(text)) return { kind: 'cep', text: text.replace('-', '') };
  if (text.length < SEARCH_MIN_LENGTH) return { kind: 'short', text };
  return { kind: 'search', text: text.slice(0, SEARCH_MAX_LENGTH) };
}

export function lookupCep(api: ApiClient, cep: string, signal?: AbortSignal) {
  return api.request<CepAddressDto>(apiPaths.addressLookup(cep), { signal });
}

export async function searchPlaces(
  api: ApiClient,
  text: string,
  language: string | undefined,
  signal?: AbortSignal,
): Promise<PlaceDto[]> {
  const answer = await api.request<{ results?: PlaceDto[] }>(
    apiPaths.addressSearch(text, language),
    { signal },
  );
  return answer?.results ?? [];
}
