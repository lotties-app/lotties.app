import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { UnitsContext, type UnitsApi } from './UnitsContext';
import { currentUnitSystem, setUnitSetting, subscribeUnits } from './state';
import { getUnitSettings, putUnitSettings } from './unitSettingsApi';
import { loadUnitSetting, storeUnitSetting } from './unitSettingStorage';
import type { UnitSetting } from './system';

/**
 * Owns the measurement-units setting of the signed-in account: reads the per-account local value
 * first (so the first paint is right, offline too), then the server's (`/me/unit-settings`), and
 * writes every change through to the server. A failed write keeps the local value and is retried
 * on the next load and when the device comes back online; a failed read keeps the local value.
 * The subtree below is keyed by the resolved system, so every screen redraws when it changes.
 * Signed out there is no setting: metric, or the device region under `auto`.
 */
export function UnitsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return children;
  return <AccountUnits>{children}</AccountUnits>;
}

function AccountUnits({ children }: { children: ReactNode }) {
  const api = useApiClient();
  // `ApiClientProvider` builds a new client every render: keep the latest one without re-running effects.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const [state, setState] = useState(() => {
    const stored = loadUnitSetting();
    setUnitSetting(stored.system);
    return stored;
  });
  const [system, setSystem] = useState(currentUnitSystem);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  useEffect(() => subscribeUnits(() => setSystem(currentUnitSystem())), []);
  useEffect(() => {
    const stored = loadUnitSetting();
    setUnitSetting(stored.system);
    return () => setUnitSetting('auto');
  }, []);

  const push = useCallback(async (value: UnitSetting) => {
    try {
      await putUnitSettings(apiRef.current, value);
    } catch {
      return; // Stays pending: retried on the next load or when back online.
    }
    if (latest.current.system !== value) return; // A newer choice is on its way.
    storeUnitSetting(value, false);
    setState({ system: value, pending: false });
  }, []);

  // On load: send an unconfirmed local choice, else adopt the server's value.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = loadUnitSetting();
      if (local.pending) return push(local.system);
      try {
        const remote = await getUnitSettings(apiRef.current);
        if (cancelled || remote === null || latest.current.pending) return;
        if (remote === latest.current.system) return;
        storeUnitSetting(remote, false);
        setUnitSetting(remote);
        setState({ system: remote, pending: false });
      } catch {
        // 404, offline or any failure: the local value stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [push]);

  useEffect(() => {
    const retry = () => {
      if (latest.current.pending) void push(latest.current.system);
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [push]);

  const setSetting = useCallback(
    (next: UnitSetting) => {
      storeUnitSetting(next, true);
      setUnitSetting(next);
      latest.current = { system: next, pending: true };
      setState({ system: next, pending: true });
      void push(next);
    },
    [push],
  );

  const value = useMemo<UnitsApi>(
    () => ({ setting: state.system, system, pending: state.pending, setSetting }),
    [state, system, setSetting],
  );
  return (
    <UnitsContext value={value}>
      <Fragment key={system}>{children}</Fragment>
    </UnitsContext>
  );
}
