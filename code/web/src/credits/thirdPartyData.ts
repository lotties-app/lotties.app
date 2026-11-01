import { useCallback, useEffect, useState } from 'react';

/** One package of the generated list (code/web/scripts/generate-credits.mjs). */
export interface ThirdPartyPackage {
  ecosystem: 'npm' | 'nuget';
  name: string;
  version: string;
  license: string;
  homepage: string | null;
  repository: string | null;
  direct: boolean;
  sources: string[];
  /** Key into the license texts; null when the package ships no license file. */
  licenseId: string | null;
}

/*
 * The package list (about 55 kB) and the license texts (about 100 kB) are separate lazy chunks: the
 * landing page only imports the tiny summary, the credits page loads the list, and a license text
 * is fetched when the first one is opened. Failed loads are forgotten so the next try retries.
 */
let packagesPromise: Promise<ThirdPartyPackage[]> | undefined;
let licensesPromise: Promise<Record<string, string>> | undefined;

export function loadPackages(): Promise<ThirdPartyPackage[]> {
  packagesPromise ??= import('./third-party.generated.json').then(
    (m) => m.default.packages as ThirdPartyPackage[],
  );
  packagesPromise.catch(() => (packagesPromise = undefined));
  return packagesPromise;
}

export function loadLicenses(): Promise<Record<string, string>> {
  licensesPromise ??= import('./third-party-licenses.generated.json').then(
    (m) => m.default as Record<string, string>,
  );
  licensesPromise.catch(() => (licensesPromise = undefined));
  return licensesPromise;
}

export type LoadState<T> =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: T };

function useLoaded<T>(load: () => Promise<T>, enabled = true): [LoadState<T>, () => void] {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    load().then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      () => !cancelled && setState({ status: 'failed' }),
    );
    return () => {
      cancelled = true;
    };
  }, [load, enabled, attempt]);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  return [state, retry];
}

export const usePackages = () => useLoaded(loadPackages);
/** The license texts, fetched once `enabled` turns true. */
export const useLicenses = (enabled: boolean) => useLoaded(loadLicenses, enabled);
