import { liveQuery } from 'dexie';
import { readSelectedBabyId } from '../baby/selectedBabyStorage';
import type { BabyRoutineDb } from '../db/database';
import { i18n } from '../i18n/i18n';
import type { NativeShell } from '../platform/nativeShell';
import { drainOutboxDetailed } from './outbox';
import { buildSnapshot } from './snapshot';
import type { WidgetBridge } from './widgetBridge';
import { onWidgetInputsChanged } from './widgetInputs';
import { errorText, setWidgetRefresher, setWidgetStatus } from './widgetStatus';

/** A burst of data changes (a sync pull merged page by page, a drain, several quick edits) makes one snapshot write. */
export const WIDGET_DEBOUNCE_MS = 400;

export interface WidgetSyncOptions {
  db: BabyRoutineDb;
  bridge: WidgetBridge;
  shell: Pick<NativeShell, 'onResume' | 'onPause'>;
  debounceMs?: number;
}

/** A native call that never answers must show up as an error, not as "waiting" forever. */
function withTimeout<T>(promise: Promise<T>, message: string, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const NOTHING_DRAINED = { written: 0, removed: 0 };

/**
 * Keeps `widget-snapshot.json` in step with the account's local data (docs/design/37-widgets-siri.md "Freshness")
 * and returns the stop. Each write makes the native side redraw the widgets (iOS `reloadAllTimelines`, the Android
 * `LottiesStore` listener). Triggers:
 * - start and resume: right away;
 * - a change of events, babies, event types, the sync outbox or the age norms in Dexie (any screen's write, a sync
 *   pull merging what other phones logged, a drain): debounced;
 * - the selected baby, the cached predictions or the app language changing: debounced;
 * - the app leaving the foreground (appStateChange, visibilitychange): right away, the OS suspends it soon after;
 * - Hub > About "send now" (`refreshWidgetNow`): right away, even when nothing changed;
 * - a silent push's sync (`flushWidgetSnapshot`, widgets/silentPush.ts): right away, only when something changed.
 * Every run drains the widget outbox first, so the app never writes a snapshot that hides a widget tap it has not
 * applied yet. Runs never overlap; a trigger during a run asks for one more.
 */
export function startWidgetSync({
  db,
  bridge,
  shell,
  debounceMs = WIDGET_DEBOUNCE_MS,
}: WidgetSyncOptions): () => void {
  let stopped = false;
  let lastJson = '';
  let loop: Promise<void> | undefined;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = async (json: string) => {
    const stable = JSON.stringify({ ...JSON.parse(json), updatedAt: '' });
    if (stable === lastJson) return;
    lastJson = stable;
    try {
      setWidgetStatus({ state: 'working', step: 'sending' });
      await withTimeout(bridge.writeSnapshot(json), 'no answer from the native plugin');
      const detail = await bridge.diagnose().catch(() => undefined);
      setWidgetStatus({ state: 'ok', at: new Date().toISOString(), detail });
    } catch (error) {
      lastJson = '';
      const ping = await bridge.diagnose().catch(() => 'no answer');
      const probe = await bridge.probe().catch((e) => errorText(e));
      setWidgetStatus({ state: 'error', message: `${errorText(error)} [${ping}] [${probe}]` });
    }
  };

  const runOnce = async () => {
    const drained = await drainOutboxDetailed(db, bridge).catch(() => NOTHING_DRAINED);
    // The widget wrote its tap into the file itself: ours must replace it even when our copy did not change.
    if (drained.removed > 0) lastJson = '';
    if (stopped) return;
    setWidgetStatus({ state: 'working', step: 'reading' });
    const json = JSON.stringify(await buildSnapshot(db, readSelectedBabyId()));
    // Signed out meanwhile: the file was (or is being) deleted, never write it back.
    if (stopped) return;
    await publish(json);
  };

  const runLoop = async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again && !stopped);
    } catch (error) {
      setWidgetStatus({ state: 'error', message: errorText(error) });
    } finally {
      loop = undefined;
    }
  };

  /** Runs now, or asks the running run for one more; resolves when the snapshot is written (or found unchanged). */
  const refresh = (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (stopped) return Promise.resolve();
    if (loop) {
      again = true;
      return loop;
    }
    loop = runLoop();
    return loop;
  };

  const refreshSoon = () => {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void refresh();
    }, debounceMs);
  };

  void refresh();
  setWidgetRefresher(async (force) => {
    if (force) lastJson = '';
    await refresh();
  });

  // The live query only says "something changed" (a count over the whole table also sees updates of existing rows);
  // the snapshot is built outside of it. Its first answer only costs one more build (same text: no write).
  const subscription = liveQuery(() =>
    Promise.all([
      db.events.count(),
      db.babies.count(),
      db.eventTypes.count(),
      db.outbox.count(),
      db.ageNorms.count(),
    ]),
  ).subscribe({
    next: refreshSoon,
    error: (error) => setWidgetStatus({ state: 'error', message: errorText(error) }),
  });
  const stopInputs = onWidgetInputsChanged(refreshSoon);
  i18n.on('languageChanged', refreshSoon);
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void refresh();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const stopResume = shell.onResume(() => void refresh());
  const stopPause = shell.onPause(() => void refresh());

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    setWidgetRefresher(undefined);
    subscription.unsubscribe();
    stopInputs();
    i18n.off('languageChanged', refreshSoon);
    document.removeEventListener('visibilitychange', onVisibility);
    void stopResume.then((stop) => stop());
    void stopPause.then((stop) => stop());
  };
}
