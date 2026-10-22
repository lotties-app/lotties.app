import type { ApiClient } from '../api/apiClient';
import { apiPaths } from '../sync/contract';

/*
 * Online-only push notification calls (docs/SPEC.md "Push notifications"). Endpoints and keys go
 * to the server in bodies only; the server never returns them.
 */

export interface PushConfigDto {
  enabled: boolean;
  /** base64url uncompressed P-256 key, `null` when push is off. */
  publicKey: string | null;
}

export interface SubscribePushRequest {
  endpoint: string;
  /** Milliseconds since the Unix epoch, as `PushSubscription.toJSON()` reports it. */
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  locale: string;
  deviceLabel?: string;
}

export interface PushDeviceDto {
  id: string;
  deviceLabel: string | null;
  locale: string;
  createdAt: string;
  lastSeenAt: string;
  lastSuccessAt: string | null;
}

export interface QuietHoursDto {
  enabled: boolean;
  /** `HH:mm` in the user's time zone. */
  start: string;
  end: string;
}

export interface NotificationSettingsDto {
  /** IANA zone; `null` before the first PUT (required on PUT). */
  timeZone: string | null;
  quietHours: QuietHoursDto;
  quietIncludesMedicine: boolean;
  showNames: boolean;
}

export type DoseLead = 0 | 5 | 15;
export type NapLead = 0 | 10 | 20;

/**
 * The state sent by `PUT /babies/{id}/notification-preferences`. The server merges: a field left
 * out keeps its stored value, so a client that does not know a newer kind never turns it off.
 */
export interface ReminderPreferences {
  doseDue: boolean;
  doseLeadMinutes: DoseLead;
  napWindow: boolean;
  napLeadMinutes: NapLead;
  /** The belly pain pattern heads-up (`belly_pain_pattern`); off by default. */
  bellyPainPattern: boolean;
  /** The overtired heads-up (`overtired_warning`); off by default. */
  overtiredWarning: boolean;
  /** The fussy pattern heads-up (`fussy_pattern`); off by default. */
  fussyPattern: boolean;
  /** The wet diaper heads-up (`diaper_wet_headsup`); off by default. */
  diaperWetHeadsUp: boolean;
  /** The dirty diaper heads-up (`diaper_dirty_headsup`); off by default. */
  diaperDirtyHeadsUp: boolean;
  /** The appointment reminders (`appointment_reminder`); ON by default (the family created the appointment). */
  appointmentReminders: boolean;
  /** The doctor's suggestions and recommendations (`doctor_suggestion`); off by default. */
  doctorSuggestions: boolean;
}

/**
 * The kinds added after the first release: absent on older servers (= off, except the appointment
 * reminders, which such a server does not send at all).
 */
type AdditiveKinds =
  | 'bellyPainPattern'
  | 'overtiredWarning'
  | 'fussyPattern'
  | 'diaperWetHeadsUp'
  | 'diaperDirtyHeadsUp'
  | 'appointmentReminders'
  | 'doctorSuggestions';

export interface BabyPreferencesDto
  extends
    Omit<ReminderPreferences, AdditiveKinds>,
    Partial<Pick<ReminderPreferences, AdditiveKinds>> {
  babyId: string;
  /** False for Viewers: they never get baby reminders. */
  canReceive: boolean;
}

export type PushTestStatus = 'sent' | 'gone' | 'failed';

export interface PushTestResponse {
  results: { subscriptionId: string; status: PushTestStatus }[];
}

export const DOSE_LEADS: readonly DoseLead[] = [0, 5, 15];
export const NAP_LEADS: readonly NapLead[] = [0, 10, 20];

export const getPushConfig = (api: ApiClient) => api.request<PushConfigDto>(apiPaths.pushConfig());

/** 201 new, 200 refreshed (keys, locale, label, last seen; un-revokes; transfers the endpoint). */
export const subscribePush = (api: ApiClient, request: SubscribePushRequest) =>
  api.request<PushDeviceDto>(apiPaths.pushSubscriptions(), { method: 'POST', body: request });

/** 204 always: an unknown or foreign endpoint is a no-op. */
export async function revokePushByEndpoint(
  api: ApiClient,
  endpoint: string,
  signal?: AbortSignal,
): Promise<void> {
  await api.request<unknown>(apiPaths.pushRevokeByEndpoint(), {
    method: 'POST',
    body: { endpoint },
    signal,
    // Used during sign-out: never bounce to the login page from here.
    skipUnauthorizedHandler: true,
  });
}

export async function listPushDevices(api: ApiClient): Promise<PushDeviceDto[]> {
  return (await api.request<PushDeviceDto[]>(apiPaths.pushSubscriptions())) ?? [];
}

export async function revokePushDevice(api: ApiClient, subscriptionId: string): Promise<void> {
  await api.request<unknown>(apiPaths.pushSubscription(subscriptionId), { method: 'DELETE' });
}

export const getNotificationSettings = (api: ApiClient) =>
  api.request<NotificationSettingsDto>(apiPaths.pushSettings());

export const putNotificationSettings = (
  api: ApiClient,
  settings: NotificationSettingsDto & { timeZone: string },
) =>
  api.request<NotificationSettingsDto>(apiPaths.pushSettings(), { method: 'PUT', body: settings });

export async function listBabyPreferences(api: ApiClient): Promise<BabyPreferencesDto[]> {
  return (await api.request<BabyPreferencesDto[]>(apiPaths.pushPreferences())) ?? [];
}

export const putBabyPreferences = (api: ApiClient, babyId: string, prefs: ReminderPreferences) =>
  api.request<BabyPreferencesDto>(apiPaths.notificationPreferences(babyId), {
    method: 'PUT',
    body: prefs,
  });

/** `endpoint` limits the test to this device; without it every device of the caller gets one. */
export const sendTestPush = (api: ApiClient, endpoint?: string) =>
  api.request<PushTestResponse>(apiPaths.pushTest(), {
    method: 'POST',
    body: endpoint ? { endpoint } : {},
  });

export type DeliveryAction = 'snooze' | 'dismiss';

/**
 * Snooze (30 minutes, at most 3 times: the fourth is 409 `snooze_limit_reached`) or dismiss ("Stop
 * reminders for this dose") one reminder with its per-delivery token. 404
 * `notification_action_not_found` for an unknown, expired (12 h) or wrong-token delivery.
 */
export async function postDeliveryAction(
  api: ApiClient,
  deliveryId: string,
  action: DeliveryAction,
  token: string,
): Promise<void> {
  await api.request<unknown>(apiPaths.pushDeliveryAction(deliveryId), {
    method: 'POST',
    body: { action, token },
  });
}
