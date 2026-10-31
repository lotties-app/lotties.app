import { useEffect } from 'react';
import { liveQuery } from 'dexie';
import { readSelectedBabyId } from '../baby/selectedBabyStorage';
import { useDatabase } from '../db/DatabaseContext';
import { capacitorShell, type NativeShell } from '../platform/nativeShell';
import { drainOutbox } from './outbox';
import { buildSnapshot } from './snapshot';
import { nativeWidgetBridge, type WidgetBridge } from './widgetBridge';

interface Props {
  bridge?: WidgetBridge;
  shell?: Pick<NativeShell, 'onResume'>;
}

/**
 * Keeps the iOS widget and the Siri intents in step with the local data (docs/design/37-widgets-siri.md):
 * writes the snapshot after every local change, and turns what the intents left in the outbox into events when the
 * app opens, resumes or is left. Renders nothing; mounted only in the native app, inside the account's database.
 */
export function WidgetSync({ bridge = nativeWidgetBridge, shell = capacitorShell }: Props) {
  const db = useDatabase();

  useEffect(() => {
    let stopped = false;
    let lastJson = '';

    const publish = async (json: string) => {
      if (stopped) return;
      const stable = JSON.stringify({ ...JSON.parse(json), updatedAt: '' });
      if (stable === lastJson) return;
      lastJson = stable;
      await bridge.writeSnapshot(json);
    };
    const drain = () => drainOutbox(db, bridge).catch(() => 0);
    const refresh = async () => {
      await publish(JSON.stringify(await buildSnapshot(db, readSelectedBabyId())));
    };

    void drain();
    const subscription = liveQuery(() => buildSnapshot(db, readSelectedBabyId())).subscribe({
      next: (snapshot) => void publish(JSON.stringify(snapshot)).catch(() => undefined),
      error: () => undefined,
    });
    // The selected baby is not in the database: re-read it when the app is left, where the widget takes over.
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void refresh().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onHidden);
    const stopResume = shell.onResume(() => void drain());

    return () => {
      stopped = true;
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onHidden);
      void stopResume.then((stop) => stop());
    };
  }, [db, bridge, shell]);

  return null;
}
