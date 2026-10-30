import type { ApiClient } from '../api/apiClient';
import { API_PREFIX } from '../sync/contract';

/*
 * Caregiver rest (docs/design/41-caregiver-rest.md section 11): account-level routes under
 * `/me`. The answers are about the signed-in person only and are never written to Dexie,
 * localStorage or the outbox: they live in the react-query cache (memory) and nowhere else.
 */

export interface WorkWindow {
  /** ISO weekdays, 1 (Monday) to 7 (Sunday). */
  days: number[];
  /** Local wall-clock `HH:mm` in the settings' time zone. */
  start: string;
  end: string;
}

export interface RestSettings {
  enabled: boolean;
  timeZone: string;
  workWindows: WorkWindow[];
  nightStart: string;
  nightEnd: string;
  fallAsleepMinutes: number;
  wakeLeadMinutes: number;
}

export type RestStartSource = 'babyLog' | 'workWindowEnd';
export type RestEndSource = 'ownEvent' | 'confirmed' | 'babyFinalWake' | 'workWindow' | 'ongoing';

export interface RestPart {
  /** UTC ISO instants; `end` is `null` while the part is ongoing. */
  start: string;
  end: string | null;
  startSource: RestStartSource;
  endSource: RestEndSource;
  confidence: 'normal' | 'low';
}

export type RestStatus = 'ok' | 'notEnoughLog' | 'disabled';

export interface RestEstimate {
  /** The local date the night started (`yyyy-mm-dd`). */
  night: string;
  status: RestStatus;
  parts: RestPart[];
  askMorning: boolean;
  constants: { fallAsleepMinutes: number; wakeLeadMinutes: number };
}

export const MAX_WORK_WINDOWS = 14;
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 60;

export const DEFAULT_REST_SETTINGS: RestSettings = {
  enabled: false,
  timeZone: 'UTC',
  workWindows: [],
  nightStart: '19:00',
  nightEnd: '07:00',
  fallAsleepMinutes: 20,
  wakeLeadMinutes: 20,
};

const settingsPath = `${API_PREFIX}/me/rest-settings`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isWindow(value: unknown): value is WorkWindow {
  return (
    isRecord(value) &&
    Array.isArray(value.days) &&
    value.days.every((d) => typeof d === 'number') &&
    typeof value.start === 'string' &&
    typeof value.end === 'string'
  );
}

/** The settings, or `null` when the answer is not shaped like them (an older server). */
export function parseRestSettings(body: unknown): RestSettings | null {
  if (!isRecord(body) || typeof body.enabled !== 'boolean') return null;
  const fallback = DEFAULT_REST_SETTINGS;
  return {
    enabled: body.enabled,
    timeZone: typeof body.timeZone === 'string' ? body.timeZone : fallback.timeZone,
    workWindows: Array.isArray(body.workWindows) ? body.workWindows.filter(isWindow) : [],
    nightStart: typeof body.nightStart === 'string' ? body.nightStart : fallback.nightStart,
    nightEnd: typeof body.nightEnd === 'string' ? body.nightEnd : fallback.nightEnd,
    fallAsleepMinutes:
      typeof body.fallAsleepMinutes === 'number'
        ? body.fallAsleepMinutes
        : fallback.fallAsleepMinutes,
    wakeLeadMinutes:
      typeof body.wakeLeadMinutes === 'number' ? body.wakeLeadMinutes : fallback.wakeLeadMinutes,
  };
}

export function parseRestEstimate(body: unknown): RestEstimate | null {
  if (!isRecord(body) || typeof body.night !== 'string' || typeof body.status !== 'string') {
    return null;
  }
  return {
    night: body.night,
    status: body.status as RestStatus,
    parts: Array.isArray(body.parts) ? (body.parts as RestPart[]) : [],
    askMorning: body.askMorning === true,
    constants: isRecord(body.constants)
      ? (body.constants as RestEstimate['constants'])
      : { fallAsleepMinutes: 20, wakeLeadMinutes: 20 },
  };
}

export async function getRestSettings(api: ApiClient): Promise<RestSettings | null> {
  return parseRestSettings(await api.request<unknown>(settingsPath));
}

/** The full state (idempotent). */
export async function putRestSettings(api: ApiClient, settings: RestSettings): Promise<void> {
  await api.request(settingsPath, { method: 'PUT', body: settings });
}

/** Turns the feature off: deletes the settings and every morning answer (204). */
export async function deleteRestSettings(api: ApiClient): Promise<void> {
  await api.request(settingsPath, { method: 'DELETE' });
}

/** The estimate of `night` (`yyyy-mm-dd`), or of the latest night when omitted. */
export async function getRestEstimate(
  api: ApiClient,
  night?: string,
): Promise<RestEstimate | null> {
  const query = night ? `?night=${encodeURIComponent(night)}` : '';
  return parseRestEstimate(await api.request<unknown>(`${API_PREFIX}/me/rest${query}`));
}

export async function putRestMorning(api: ApiClient, night: string, upAt: string): Promise<void> {
  await api.request(`${API_PREFIX}/me/rest/morning`, { method: 'PUT', body: { night, upAt } });
}
