/* Shared fixtures for the worker push tests (synthetic ids and names only). */
export const DELIVERY_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const BABY_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const RX_ID = '16fd2706-8baf-433b-82eb-8c7fada847da';
export const TOKEN = 'dGVzdC10b2tlbi10aGF0LWlzLWxvbmctZW5vdWdoLTEyMzQ';

export const dosePayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'dose_due',
  babyId: BABY_ID,
  rxId: RX_ID,
  at: '2026-10-21T21:00:00Z',
  lang: 'en',
  token: TOKEN,
  ...overrides,
});

export const napPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'nap_window',
  babyId: BABY_ID,
  at: '2026-10-21T17:20:00Z',
  lang: 'en',
  ...overrides,
});

/** The belly pain heads-up for a window starting at 17:30 São Paulo (20:30 UTC). */
export const bellyPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'belly_pain_pattern',
  babyId: BABY_ID,
  at: '2026-10-21T20:30:00Z',
  lang: 'en',
  token: TOKEN,
  ...overrides,
});

/** The overtired heads-up for an awake stretch reaching the usual limit at 15:30 São Paulo (18:30 UTC). */
export const overtiredPayload = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'overtired_warning',
  babyId: BABY_ID,
  at: '2026-10-21T18:30:00Z',
  lang: 'en',
  token: TOKEN,
  ...overrides,
});

/** The fussy pattern heads-up for a window starting at 17:30 São Paulo (20:30 UTC). */
export const fussyPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'fussy_pattern',
  babyId: BABY_ID,
  at: '2026-10-21T20:30:00Z',
  lang: 'en',
  token: TOKEN,
  ...overrides,
});

/** The wet diaper heads-up for a wet diaper expected at 15:40 São Paulo (18:40 UTC). */
export const wetPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'diaper_wet_headsup',
  babyId: BABY_ID,
  at: '2026-10-21T18:40:00Z',
  lang: 'en',
  token: TOKEN,
  ...overrides,
});

/** The dirty diaper heads-up for a dirty diaper expected at 16:05 São Paulo (19:05 UTC). */
export const dirtyPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'diaper_dirty_headsup',
  babyId: BABY_ID,
  at: '2026-10-21T19:05:00Z',
  lang: 'en',
  token: TOKEN,
  ...overrides,
});

export const testPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'test',
  at: '2026-10-21T12:00:00Z',
  lang: 'en',
  ...overrides,
});
