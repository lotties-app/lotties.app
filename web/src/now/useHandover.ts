import { useCallback, useEffect, useState } from 'react';
import { readLastSeenAt, writeLastSeenAt } from './lastSeen';

export interface Handover {
  /** When this device last showed the baby, as read when the screen opened; `null` the first time. */
  since: string | null;
  /** "Got it": the card is done, the next catch-up starts now. */
  acknowledge: () => void;
}

/**
 * The hand-over period of a baby: the stored "last seen" time is read once per baby when the
 * screen shows it, and the current time is stored when the page is hidden or the screen leaves the
 * baby (so the next open lists only what happened after), or on "Got it".
 */
export function useHandover(babyId: string): Handover {
  const [snapshot, setSnapshot] = useState(() => ({ babyId, since: readLastSeenAt(babyId) }));
  // Another baby: take its own stored time (adjusting state while rendering, as React documents).
  if (snapshot.babyId !== babyId) setSnapshot({ babyId, since: readLastSeenAt(babyId) });

  useEffect(() => {
    const store = () => writeLastSeenAt(babyId, new Date().toISOString());
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') store();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', store);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', store);
      store();
    };
  }, [babyId]);

  const acknowledge = useCallback(() => {
    const now = new Date().toISOString();
    writeLastSeenAt(babyId, now);
    setSnapshot({ babyId, since: now });
  }, [babyId]);

  return { since: snapshot.babyId === babyId ? snapshot.since : null, acknowledge };
}
