import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { CryEngine } from '../cry';
import type { CrySensitivity } from '../cry/sensitivity';
import { useDatabase } from '../db/DatabaseContext';
import type { EventType } from '../db/models';
import { usePushDevice } from '../notifications/PushDeviceContext';
import { endAutoSpell, startAutoSpell } from './autoSpells';
import { CLOSE_CRY_NOTIFICATIONS_EVERY_MS, closeCryNotifications } from './monitorNotifications';
import { initialMonitorState, monitorReducer, type MonitorState } from './monitorState';
import {
  hasCurrentConsent,
  readSensitivity,
  writeConsent,
  writeSensitivity,
} from './monitorStorage';
import {
  browserWakeLockEnvironment,
  ScreenWakeLock,
  type WakeLockEnvironment,
  type WakeLockStatus,
} from './screenWakeLock';
import { cryMonitorSupported } from './support';

/*
 * The cry monitor's controller (docs/design/35-cry-engine.md section 8): the page state machine, the
 * engine (loaded only when "Start monitoring" is pressed: nothing of src/cry is in the main bundle),
 * the screen wake lock, the auto spells and the clean-up of this device's cry alerts. Leaving the page
 * (unmount, route change, tab close: `pagehide`) stops everything the way Stop does.
 */

/** What the page needs of the engine; tests and the developer preview pass a fake. */
export type CryEngineLike = Pick<CryEngine, 'on' | 'start' | 'stop' | 'setSensitivity' | 'capture'>;
export type CreateCryEngine = () => Promise<CryEngineLike>;

/** The real engine, imported on demand (its own chunk; MediaPipe stays in the worker's). */
export const loadCryEngine: CreateCryEngine = async () =>
  (await import('../cry')).createCryEngine();

export interface CryMonitorOptions {
  babyId: string;
  types: readonly EventType[];
  createEngine?: CreateCryEngine;
  wakeLockEnvironment?: WakeLockEnvironment;
  /** Overrides the browser check (tests, the developer preview). */
  supported?: boolean;
}

export interface CryMonitor {
  state: MonitorState;
  sensitivity: CrySensitivity;
  /** The engine's smoothed score (0 before the first window): a level meter, never a number. */
  level: number;
  wakeLock: WakeLockStatus;
  /** The browser kept noise suppression or automatic gain on: sensitivity may be lower. */
  processingOn: boolean;
  /** Start of the cry the monitor is hearing now, if any. */
  cryingSince: number | null;
  start: () => Promise<void>;
  stop: () => void;
  agree: () => void;
  cancelConsent: () => void;
  setSensitivity: (level: CrySensitivity) => void;
}

export function useCryMonitor({
  babyId,
  types,
  createEngine = loadCryEngine,
  wakeLockEnvironment,
  supported,
}: CryMonitorOptions): CryMonitor {
  const db = useDatabase();
  const device = usePushDevice();
  const [state, dispatch] = useReducer(monitorReducer, undefined, () =>
    initialMonitorState(supported ?? cryMonitorSupported()),
  );
  const [sensitivity, setSensitivityState] = useState<CrySensitivity>(readSensitivity);
  const [level, setLevel] = useState(0);
  const [wakeLock, setWakeLock] = useState<WakeLockStatus>('off');
  const [processingOn, setProcessingOn] = useState(false);
  const [cryingSince, setCryingSince] = useState<number | null>(null);

  const engine = useRef<CryEngineLike | null>(null);
  const unsubscribe = useRef<(() => void)[]>([]);
  const lock = useRef<ScreenWakeLock | null>(null);
  /** The spell this monitor started or kept, until its cry ends. */
  const spell = useRef<string | null>(null);
  /** Spell writes run one after another (an end never overtakes its start). */
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  /** Bumped by every start and stop: a start still importing the engine is abandoned. */
  const run = useRef(0);
  const latest = useRef({ babyId, types, device, sensitivity });
  useEffect(() => {
    latest.current = { babyId, types, device, sensitivity };
  });

  const enqueue = useCallback((task: () => Promise<unknown>) => {
    writes.current = writes.current.then(task).catch(() => undefined);
  }, []);

  const releaseScreen = useCallback(() => {
    lock.current?.stop();
    lock.current = null;
    setLevel(0);
    setCryingSince(null);
  }, []);

  const attach = useCallback(
    (target: CryEngineLike) => {
      unsubscribe.current = [
        target.on('state', ({ state: next, error }) => {
          if (next === 'listening') {
            setProcessingOn((target.capture?.processingOn.length ?? 0) > 0);
            dispatch({ type: 'listening', at: Date.now() });
          } else if (next === 'error' && error) {
            releaseScreen();
            dispatch({ type: 'error', code: error, at: Date.now() });
          }
        }),
        target.on('score', ({ smoothed }) => setLevel(smoothed)),
        target.on('cry_started', ({ at }) => {
          setCryingSince(at);
          const { babyId: baby, types: babyTypes, device: push } = latest.current;
          void closeCryNotifications(push, baby);
          enqueue(async () => {
            const result = await startAutoSpell(db, { babyId: baby, types: babyTypes }, at);
            spell.current = result.kind === 'created' || result.kind === 'kept' ? result.id : null;
          });
        }),
        target.on('cry_ended', ({ at }) => {
          setCryingSince(null);
          enqueue(async () => {
            const id = spell.current;
            spell.current = null;
            if (id) await endAutoSpell(db, id, at);
          });
        }),
        target.on('stalled', ({ at, lastFrameAt }) => {
          // Never claim to listen without sound: stop (the running cry ends at the last frame).
          run.current++;
          target.stop();
          releaseScreen();
          dispatch({ type: 'stalled', at: lastFrameAt ?? at });
        }),
      ];
    },
    [db, enqueue, releaseScreen],
  );

  const stop = useCallback(() => {
    run.current++;
    engine.current?.stop();
    releaseScreen();
    dispatch({ type: 'stop' });
  }, [releaseScreen]);

  const start = useCallback(async () => {
    if (!hasCurrentConsent()) {
      dispatch({ type: 'consentNeeded' });
      return;
    }
    const attempt = ++run.current;
    dispatch({ type: 'start' });
    lock.current?.stop();
    lock.current = new ScreenWakeLock(
      wakeLockEnvironment ?? browserWakeLockEnvironment(),
      setWakeLock,
    );
    lock.current.start();
    let target = engine.current;
    if (!target) {
      try {
        target = await createEngine();
      } catch {
        if (attempt === run.current) {
          releaseScreen();
          dispatch({ type: 'error', code: 'model_missing', at: Date.now() });
        }
        return;
      }
      engine.current = target;
      attach(target);
    }
    if (attempt !== run.current) return;
    await target.start({ sensitivity: latest.current.sensitivity });
  }, [attach, createEngine, releaseScreen, wakeLockEnvironment]);

  const agree = useCallback(() => {
    writeConsent();
    dispatch({ type: 'consentGiven' });
  }, []);

  const cancelConsent = useCallback(() => dispatch({ type: 'consentCancelled' }), []);

  const setSensitivity = useCallback((next: CrySensitivity) => {
    setSensitivityState(next);
    writeSensitivity(next);
    engine.current?.setSensitivity(next);
  }, []);

  // Leaving the page, closing the tab or unmounting stops everything, like Stop.
  useEffect(() => {
    const onPageHide = () => stop();
    const attempts = run;
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      attempts.current++;
      engine.current?.stop();
      for (const off of unsubscribe.current) off();
      unsubscribe.current = [];
      engine.current = null;
      lock.current?.stop();
      lock.current = null;
    };
  }, [stop]);

  // While listening, this device's cry alert of the baby is closed now and then.
  const listening = state.phase === 'listening';
  useEffect(() => {
    if (!listening) return;
    void closeCryNotifications(device, babyId);
    const timer = window.setInterval(
      () => void closeCryNotifications(device, babyId),
      CLOSE_CRY_NOTIFICATIONS_EVERY_MS,
    );
    return () => window.clearInterval(timer);
  }, [listening, device, babyId]);

  return {
    state,
    sensitivity,
    level,
    wakeLock,
    processingOn,
    cryingSince,
    start,
    stop,
    agree,
    cancelConsent,
    setSensitivity,
  };
}
