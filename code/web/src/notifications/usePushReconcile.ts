import { useEffect, useEffectEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { useLocale } from '../i18n/useLocale';
import { useOnline } from '../sync/useOnline';
import { reconcilePush } from './pushActions';
import { usePushDevice } from './PushDeviceContext';
import { pushConfigQuery, pushKeys, usePushContext } from './usePush';

/**
 * Reconciles this browser's push subscription with the server on app start (signed in, online,
 * permission granted) and again when the language changes. Never prompts, never throws.
 */
export function usePushReconcile(): void {
  const api = useApiClient();
  const device = usePushDevice();
  const context = usePushContext();
  const queryClient = useQueryClient();
  const online = useOnline();
  const { locale } = useLocale();

  const run = useEffectEvent(async () => {
    if (device.support() !== 'supported' || device.permission() !== 'granted') return;
    try {
      const config = await queryClient.fetchQuery(pushConfigQuery(api));
      if (!config.enabled || !config.publicKey) return;
      const outcome = await reconcilePush(context, config.publicKey);
      if (outcome !== 'not-opted-in') {
        await queryClient.invalidateQueries({ queryKey: pushKeys.thisDevice });
        await queryClient.invalidateQueries({ queryKey: pushKeys.devices });
      }
    } catch {
      // Retried on the next start; Settings shows the real state.
    }
  });

  useEffect(() => {
    if (online) void run();
  }, [online, locale]);
}
