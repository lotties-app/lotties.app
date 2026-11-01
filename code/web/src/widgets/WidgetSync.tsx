import { useEffect } from 'react';
import { liveQuery } from 'dexie';
import { readSelectedBabyId } from '../baby/selectedBabyStorage';
import { useDatabase } from '../db/DatabaseContext';
import { capacitorShell, type NativeShell } from '../platform/nativeShell';
import { drainOutbox } from './outbox';
import { buildSnapshot } from './snapshot';
import { nativeWidgetBridge, type WidgetBridge } from './widgetBridge';
import { errorText, setWidgetStatus } from './widgetStatus';

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
      try {
        await bridge.writeSnapshot(json);
        setWidgetStatus({ state: 'ok', at: new Date().toISOString() });
      } catch (error) {
        lastJson = '';
        setWidgetStatus({ state: 'error', message: errorText(error) });
      }
    };
    const drain = () => drainOutbox(db, bridge).catch(() => 0);
    // One build at a time; a change that arrives meanwhile asks for one more.
    let running = false;
    let again = false;
    const refresh = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          await publish(JSON.stringify(await buildSnapshot(db, readSelectedBabyId())));
        } while (again && !stopped);
      } catch (error) {
        setWidgetStatus({ state: 'error', message: errorText(error) });
      } finally {
        running = false;
      }
    };

    void drain();
    // The live query only says "something changed" (counts, no cursors); the snapshot is built outside of it.
    const subscription = liveQuery(() =>
      Promise.all([db.events.count(), db.babies.count(), db.eventTypes.count(), db.outbox.count()]),
    ).subscribe({
      next: () => void refresh(),
      error: (error) => setWidgetStatus({ state: 'error', message: errorText(error) }),
    });
    // The selected baby is not in the database: re-read it when the app is left, where the widget takes over.
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void refresh();
    };
    document.addEventListener('visibilitychange', onHidden);
    const stopResume = shell.onResume(() => void drain().then(refresh));

    return () => {
      stopped = true;
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onHidden);
      void stopResume.then((stop) => stop());
    };
  }, [db, bridge, shell]);

  return null;
}
