import { useEffect } from 'react';
import { useDatabase } from '../db/DatabaseContext';
import { capacitorShell, type NativeShell } from '../platform/nativeShell';
import { nativeWidgetBridge, type WidgetBridge } from './widgetBridge';
import { startWidgetSync } from './widgetSyncRunner';

interface Props {
  bridge?: WidgetBridge;
  shell?: Pick<NativeShell, 'onResume' | 'onPause'>;
  debounceMs?: number;
}

/**
 * Keeps the home-screen widgets and the intents in step with the local data (docs/design/37-widgets-siri.md
 * "Freshness"): writes the snapshot after every local change and sync pull, and turns what the widget buttons left in
 * the outbox into events (`startWidgetSync`). Renders nothing; mounted only in the native app, inside the account's
 * database.
 */
export function WidgetSync({
  bridge = nativeWidgetBridge,
  shell = capacitorShell,
  debounceMs,
}: Props) {
  const db = useDatabase();

  useEffect(
    () => startWidgetSync({ db, bridge, shell, debounceMs }),
    [db, bridge, shell, debounceMs],
  );

  return null;
}
