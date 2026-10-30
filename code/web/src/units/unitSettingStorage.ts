import { isUnitSetting, type UnitSetting } from './system';

const KEY = 'baby-routine.unit-setting';

/*
 * The measurement-units choice (docs/design/37a-measurement-units-web.md): a preference of the
 * signed-in account kept in the account's localStorage entries (cleared on sign-out and on an
 * account switch by `session/deviceState.ts`) and mirrored to the server (`/me/unit-settings`).
 * `pending` marks a local choice the server has not confirmed yet, so it is retried on the next
 * load instead of being overwritten by the server's older value.
 */

interface Stored {
  system: UnitSetting;
  pending: boolean;
}

export function loadUnitSetting(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { system: 'auto', pending: false };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const { system, pending } = parsed as Record<string, unknown>;
      if (isUnitSetting(system)) return { system, pending: pending === true };
    }
  } catch {
    // Unreadable or storage unavailable: the default.
  }
  return { system: 'auto', pending: false };
}

export function storeUnitSetting(system: UnitSetting, pending: boolean): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ system, pending }));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

export function clearUnitSetting(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing saved.
  }
}
