import {
  isConsentCapacity,
  isOptionalConsentKind,
  type ConsentCapacity,
  type OptionalConsentKind,
} from './consentApi';

/*
 * What this device remembers about the signed-in account's consent (docs/design/38-consent-and-terms.md section 5), in localStorage.
 * The account owns these entries: `clearAccountDeviceState` removes them on sign-out and when another account signs in.
 *
 * - the last accepted core consent: the version she accepted and her declared capacity. It lets the app open offline with the
 *   consent the server last confirmed; it is a hint, never a proof (the server decides, `403 consent_required`);
 * - the "policy updated" notice she dismissed (the version she has seen);
 * - optional consents whose last change did not reach the server yet (turned on or off while offline): retried later.
 */

const ACCEPTED_KEY = 'baby-routine.consent';
const SEEN_KEY = 'baby-routine.consent-seen';
const PENDING_KEY = 'baby-routine.consent-optional-pending';

export interface AcceptedConsent {
  version: string;
  capacity: ConsentCapacity;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota): the app asks the server again next time.
  }
}

export function loadAcceptedConsent(): AcceptedConsent | null {
  const raw = read(ACCEPTED_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { version?: unknown; capacity?: unknown };
    return typeof value.version === 'string' && value.version && isConsentCapacity(value.capacity)
      ? { version: value.version, capacity: value.capacity }
      : null;
  } catch {
    return null;
  }
}

export function storeAcceptedConsent(consent: AcceptedConsent): void {
  write(ACCEPTED_KEY, JSON.stringify(consent));
}

export function loadSeenConsentVersion(): string | null {
  return read(SEEN_KEY);
}

export function storeSeenConsentVersion(version: string): void {
  write(SEEN_KEY, version);
}

export type PendingOptionalConsents = Partial<Record<OptionalConsentKind, boolean>>;

export function loadPendingOptionalConsents(): PendingOptionalConsents {
  const raw = read(PENDING_KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const pending: PendingOptionalConsents = {};
    for (const [kind, granted] of Object.entries(value)) {
      if (isOptionalConsentKind(kind) && typeof granted === 'boolean') pending[kind] = granted;
    }
    return pending;
  } catch {
    return {};
  }
}

export function storePendingOptionalConsents(pending: PendingOptionalConsents): void {
  write(PENDING_KEY, Object.keys(pending).length ? JSON.stringify(pending) : null);
}

/** Removes everything above (sign-out, another account signing in). */
export function clearConsentState(): void {
  write(ACCEPTED_KEY, null);
  write(SEEN_KEY, null);
  write(PENDING_KEY, null);
}
