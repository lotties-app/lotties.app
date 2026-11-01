import type { Baby } from '../db/models';

/*
 * Doctor sharing sections ("scopes", docs/design/19-doctor-dashboard.md): the owner chooses, per
 * doctor, what she may see. The server enforces them on every route; the client only uses them to
 * decide what to fetch, what to show as "Not shared" and what to purge from the device.
 */

/** The six sections, in the order the server and every screen list them. */
export const DOCTOR_SCOPES = [
  'daily_log',
  'growth',
  'medications',
  'vaccines',
  'formulas',
  'notes',
] as const;

export type DoctorScope = (typeof DOCTOR_SCOPES)[number];

/** A new doctor sees every section until the owner turns some off. */
export const DEFAULT_DOCTOR_SCOPES: readonly DoctorScope[] = DOCTOR_SCOPES;

const isScope = (value: unknown): value is DoctorScope =>
  typeof value === 'string' && (DOCTOR_SCOPES as readonly string[]).includes(value);

/**
 * The known codes of a server list, de-duplicated and in canonical order. Unknown codes (a newer
 * server) are dropped; `null`/absent means the defaults.
 */
export function parseScopes(raw: unknown): DoctorScope[] {
  if (!Array.isArray(raw)) return [...DEFAULT_DOCTOR_SCOPES];
  const known = new Set(raw.filter(isScope));
  return DOCTOR_SCOPES.filter((scope) => known.has(scope));
}

/** The sections the user sees of `baby`: all six for every role but the Doctor. */
export function scopesOf(baby: Pick<Baby, 'role' | 'doctorScopes'>): readonly DoctorScope[] {
  if (baby.role !== 'Doctor') return DOCTOR_SCOPES;
  return baby.doctorScopes ?? DEFAULT_DOCTOR_SCOPES;
}

export function hasScope(baby: Pick<Baby, 'role' | 'doctorScopes'>, scope: DoctorScope): boolean {
  return scopesOf(baby).includes(scope);
}

/** The sections `previous` had and `next` lacks (what the device must forget). */
export function revokedScopes(
  previous: readonly DoctorScope[],
  next: readonly DoctorScope[],
): DoctorScope[] {
  return previous.filter((scope) => !next.includes(scope));
}

/** Same sections, whatever the order. */
export function sameScopes(a: readonly DoctorScope[], b: readonly DoctorScope[]): boolean {
  return a.length === b.length && a.every((scope) => b.includes(scope));
}
