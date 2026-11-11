import { useEffect, useRef, useState } from 'react';
import type { ApiClient, RequestOptions } from '../api/apiClient';
import { useApiClient } from '../api/ApiClientContext';
import { useConsent } from '../consent/ConsentContext';
import { capacitorShell, type NativeShell } from '../platform/nativeShell';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { startSilentPush } from './silentPush';
import { nativeSilentPush, type SilentPushNative } from './silentPushBridge';
import { flushWidgetSnapshot } from './widgetStatus';

interface Props {
  native?: SilentPushNative;
  shell?: Pick<NativeShell, 'onResume'>;
}

/**
 * Keeps this install registered for the widgets' silent pushes and answers each ping with a sync and a snapshot write
 * (docs/design/37b-widget-silent-push.md section 5, `startSilentPush`). Renders nothing; mounted next to `WidgetSync` in
 * the native app only, and runs only while the app may sync (current consent).
 */
export function WidgetPushSync({ native = nativeSilentPush, shell = capacitorShell }: Props) {
  const api = useStableApiClient();
  const engine = useSyncEngine();
  const { syncAllowed } = useConsent();

  useEffect(() => {
    if (!syncAllowed) return;
    return startSilentPush({
      api,
      native,
      shell,
      syncNow: async () => {
        await engine.syncNow();
        await flushWidgetSnapshot();
      },
    });
  }, [api, engine, native, shell, syncAllowed]);

  return null;
}

/** The provider makes a new client on every render: one that always calls the latest keeps the effect from restarting. */
function useStableApiClient(): ApiClient {
  const api = useApiClient();
  const latest = useRef(api);
  useEffect(() => {
    latest.current = api;
  }, [api]);
  const [stable] = useState<ApiClient>(() => ({
    request: <T,>(path: string, options?: RequestOptions) =>
      latest.current.request<T>(path, options),
    requestWithMeta: <T,>(path: string, options?: RequestOptions) =>
      latest.current.requestWithMeta<T>(path, options),
  }));
  return stable;
}
