import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApiClient } from '../api/ApiClientContext';
import { CONSENT_REQUIRED_EVENT } from '../api/apiClient';
import { ApiError } from '../api/ApiError';
import { useAuth } from '../auth/useAuth';
import { accountDatabaseName } from '../session/accountDatabase';
import { claimDeviceState } from '../session/deviceState';
import { useLocale } from '../i18n/useLocale';
import { CONSENT_VERSION, hasMinorChangeSince, requiresAcceptance } from '../legal/consentVersions';
import {
  acceptCoreConsent,
  getConsents,
  setOptionalConsent,
  type ConsentCapacity,
  type ConsentsView,
  type OptionalConsentKind,
} from './consentApi';
import {
  ConsentContext,
  SIGNED_OUT_CONSENT,
  type ConsentApi,
  type ConsentStatus,
} from './ConsentContext';
import {
  loadAcceptedConsent,
  loadPendingOptionalConsents,
  loadSeenConsentVersion,
  storeAcceptedConsent,
  storePendingOptionalConsents,
  storeSeenConsentVersion,
} from './consentStorage';

/**
 * Knows where the signed-in account stands with the core consent and gates what needs it
 * (docs/design/38-consent-and-terms.md section 5). Signed out there is nothing to ask. The subtree is keyed by account, so one
 * person's answer never opens another's.
 *
 * Offline decision: the device remembers the version the server last confirmed (per account, `consentStorage.ts`). A cached version
 * that is still current opens the app at once, offline too, so nobody is locked out of reading her own cached data; the server is
 * asked in the background and its answer wins. The gate applies when the version is known to be stale: the server says so, or the
 * cached version is older than the newest material version this build carries (an app update while she was offline). Accepting
 * needs the server, so a stale or never-accepted account offline sees the consent screen with an "offline" note instead of the data.
 * With no cache and no answer from the server (first start, server down) the local data is readable and nothing is synced until
 * the server answers: the server refuses baby data to anyone without a consent anyway.
 */
export function ConsentProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, accountId } = useAuth();
  if (!isAuthenticated || !accountId) {
    return <ConsentContext value={SIGNED_OUT_CONSENT}>{children}</ConsentContext>;
  }
  return (
    <AccountConsent key={accountId} accountId={accountId}>
      {children}
    </AccountConsent>
  );
}

interface Standing {
  status: ConsentStatus;
  view: ConsentsView | null;
  /** The server answered at least once in this session. */
  verified: boolean;
  /** This device knew a still-current acceptance when it started. */
  cached: boolean;
}

function initialStanding(): Standing {
  const remembered = loadAcceptedConsent();
  if (!remembered) return { status: 'checking', view: null, verified: false, cached: false };
  return requiresAcceptance(remembered.version)
    ? { status: 'required', view: null, verified: false, cached: false }
    : { status: 'accepted', view: null, verified: false, cached: true };
}

function AccountConsent({ accountId, children }: { accountId: string; children: ReactNode }) {
  const api = useApiClient();
  const { locale } = useLocale();
  // `ApiClientProvider` builds a new client every render: keep the latest one without re-running effects.
  const apiRef = useRef(api);
  const localeRef = useRef(locale);
  useEffect(() => {
    apiRef.current = api;
    localeRef.current = locale;
  }, [api, locale]);

  const [standing, setStanding] = useState<Standing>(() => {
    // The device entries below belong to one account: claim them first, so another account never reads this one's answer.
    claimDeviceState(accountDatabaseName(accountId));
    return initialStanding();
  });
  const [seen, setSeen] = useState(loadSeenConsentVersion);

  const adopt = useCallback((view: ConsentsView) => {
    if (view.requiresAcceptance || !view.core?.capacity) {
      setStanding((previous) => ({ ...previous, status: 'required', view, verified: true }));
      return;
    }
    storeAcceptedConsent({ version: view.core.version, capacity: view.core.capacity });
    setStanding((previous) => ({ ...previous, status: 'accepted', view, verified: true }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      adopt(await getConsents(apiRef.current));
    } catch (error) {
      // 403 consent_required cannot come from this route; any other failure (offline, server down): keep what the device knows.
      if (error instanceof ApiError && error.code === 'consent_required') {
        setStanding((previous) => ({ ...previous, status: 'required', verified: true }));
        return;
      }
      setStanding((previous) =>
        previous.status === 'checking' ? { ...previous, status: 'accepted' } : previous,
      );
    }
  }, [adopt]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    // Back online, or the server just refused a request for want of a consent: ask again.
    const again = () => void refresh();
    window.addEventListener('online', again);
    window.addEventListener(CONSENT_REQUIRED_EVENT, again);
    return () => {
      window.removeEventListener('online', again);
      window.removeEventListener(CONSENT_REQUIRED_EVENT, again);
    };
  }, [refresh]);

  const accept = useCallback(
    async (capacity: ConsentCapacity) => {
      const view = await acceptCoreConsent(
        apiRef.current,
        CONSENT_VERSION,
        capacity,
        localeRef.current,
      );
      storeSeenConsentVersion(view.currentVersion);
      setSeen(view.currentVersion);
      adopt(view);
    },
    [adopt],
  );

  const flushOptional = useCallback(async () => {
    const pending = loadPendingOptionalConsents();
    for (const kind of Object.keys(pending) as OptionalConsentKind[]) {
      const granted = pending[kind];
      if (granted === undefined) continue;
      try {
        await setOptionalConsent(apiRef.current, kind, granted, localeRef.current);
      } catch {
        return; // Offline or the server is down: kept, retried later.
      }
      const latest = loadPendingOptionalConsents();
      // A newer change of the same kind arrived meanwhile: it stays pending.
      if (latest[kind] === granted) delete latest[kind];
      storePendingOptionalConsents(latest);
    }
  }, []);

  const recordOptional = useCallback(
    (kind: OptionalConsentKind, granted: boolean) => {
      storePendingOptionalConsents({ ...loadPendingOptionalConsents(), [kind]: granted });
      void flushOptional();
    },
    [flushOptional],
  );

  useEffect(() => {
    if (standing.status !== 'accepted') return;
    const retry = () => void flushOptional();
    retry();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [standing.status, flushOptional]);

  const dismissNotice = useCallback(() => {
    storeSeenConsentVersion(CONSENT_VERSION);
    setSeen(CONSENT_VERSION);
  }, []);

  const accepted = standing.view?.core?.version ?? loadAcceptedConsent()?.version ?? null;
  const noticeVersion =
    standing.status === 'accepted' && hasMinorChangeSince(accepted) && seen !== CONSENT_VERSION
      ? CONSENT_VERSION
      : null;

  const value = useMemo<ConsentApi>(
    () => ({
      status: standing.status,
      view: standing.view,
      syncAllowed: standing.status === 'accepted' && (standing.verified || standing.cached),
      noticeVersion,
      accept,
      refresh,
      dismissNotice,
      recordOptional,
    }),
    [standing, noticeVersion, accept, refresh, dismissNotice, recordOptional],
  );
  return <ConsentContext value={value}>{children}</ConsentContext>;
}
