import { useEffect, useState } from 'react';
import { isNamespaceLoaded, loadNamespace } from './i18n';
import { useLocale } from './useLocale';

/**
 * Loads the landing catalog (namespace `landing`) for the shown language and reports when it is
 * ready, so the page never flashes English keys while a Portuguese catalog is fetched. A failed
 * load (offline) counts as ready: the text then falls back to what is available.
 */
export function useLandingCatalog(): boolean {
  const { locale } = useLocale();
  const [settled, setSettled] = useState<string | null>(null);

  useEffect(() => {
    if (isNamespaceLoaded('landing', locale)) return;
    let cancelled = false;
    const done = () => {
      if (!cancelled) setSettled(locale);
    };
    loadNamespace('landing', locale).then(done, done);
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return isNamespaceLoaded('landing', locale) || settled === locale;
}
