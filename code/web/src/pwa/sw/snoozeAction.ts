/*
 * The Snooze action button: POST /api/v1/push/deliveries/{id}/actions with the per-delivery token
 * (docs/design/09-push-notifications.md section 6). No credentials: the worker has no access token
 * and the token can only snooze or dismiss this one reminder.
 */

/** `VITE_API_BASE_URL` normalised like src/config/appConfig.ts (trimmed, no trailing slash). */
export function normaliseApiBase(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

export function snoozeUrl(apiBaseUrl: string, deliveryId: string): string {
  return `${normaliseApiBase(apiBaseUrl)}/api/v1/push/deliveries/${encodeURIComponent(deliveryId)}/actions`;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean }>;

/** Posts the snooze; true on a 2xx answer, false on any other answer or network error. Never throws. */
export async function postSnooze(
  fetchFn: FetchLike,
  apiBaseUrl: string,
  deliveryId: string,
  token: string,
): Promise<boolean> {
  try {
    const response = await fetchFn(snoozeUrl(apiBaseUrl, deliveryId), {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'snooze', token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
