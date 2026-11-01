import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '../api/ApiClientContext';
import { useLocale } from '../i18n/useLocale';
import { useOnline } from '../sync/useOnline';
import {
  getNotificationSettings,
  getPushConfig,
  listBabyPreferences,
  listPushDevices,
  type PushConfigDto,
} from './pushApi';
import { thisDeviceId, type PushContext } from './pushActions';
import { usePushDevice } from './PushDeviceContext';

/* Server state of push (online-only, cached by TanStack Query like measurements). */

export const pushKeys = {
  all: ['push'] as const,
  config: ['push', 'config'] as const,
  settings: ['push', 'settings'] as const,
  preferences: ['push', 'preferences'] as const,
  devices: ['push', 'devices'] as const,
  thisDevice: ['push', 'thisDevice'] as const,
};

/** The config rarely changes: one fetch per app session is plenty. */
const CONFIG_STALE_MS = 30 * 60_000;

export function pushConfigQuery(api: ReturnType<typeof useApiClient>) {
  return {
    queryKey: pushKeys.config,
    queryFn: (): Promise<PushConfigDto> => getPushConfig(api),
    staleTime: CONFIG_STALE_MS,
  };
}

export function usePushConfig() {
  const api = useApiClient();
  const online = useOnline();
  return useQuery({ ...pushConfigQuery(api), enabled: online });
}

export function useNotificationSettings(enabled: boolean) {
  const api = useApiClient();
  const online = useOnline();
  return useQuery({
    queryKey: pushKeys.settings,
    queryFn: () => getNotificationSettings(api),
    enabled: enabled && online,
  });
}

export function useBabyPreferences(enabled: boolean) {
  const api = useApiClient();
  const online = useOnline();
  return useQuery({
    queryKey: pushKeys.preferences,
    queryFn: () => listBabyPreferences(api),
    enabled: enabled && online,
  });
}

export function usePushDevices(enabled: boolean) {
  const api = useApiClient();
  const online = useOnline();
  return useQuery({
    queryKey: pushKeys.devices,
    queryFn: () => listPushDevices(api),
    enabled: enabled && online,
  });
}

export interface ThisDeviceState {
  permission: ReturnType<ReturnType<typeof usePushDevice>['permission']>;
  /** The browser's subscription endpoint, `null` when not subscribed. */
  endpoint: string | null;
  /** The server id of this device, when this session learnt it. */
  subscriptionId: string | null;
}

/** This browser's permission and subscription (local; no server call). */
export function useThisDevice(enabled: boolean) {
  const device = usePushDevice();
  return useQuery({
    queryKey: pushKeys.thisDevice,
    queryFn: async (): Promise<ThisDeviceState> => {
      const subscription = device.support() === 'supported' ? await device.getSubscription() : null;
      const endpoint = subscription?.endpoint ?? null;
      return { permission: device.permission(), endpoint, subscriptionId: thisDeviceId(endpoint) };
    },
    enabled,
    networkMode: 'always',
  });
}

/** What the push actions need: API, device port, notification language and device label. */
export function usePushContext(): PushContext {
  const api = useApiClient();
  const device = usePushDevice();
  const { locale } = useLocale();
  const { t } = useTranslation();
  const parts = device.parts();
  return {
    api,
    device,
    locale,
    deviceLabel: parts ? t('notifications.deviceLabel', { ...parts }) : undefined,
  };
}

/** Refetch everything push-related after a change on this device. */
export function useRefreshPush() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: pushKeys.all });
}
