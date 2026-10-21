import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { DEEP_LINK_PATH, linkOfMessage, type NotificationLink } from '../pwa/sw/deepLink';
import { SyncEngineContext } from '../sync/SyncEngineContext';
import { NotificationLinkContext } from './notificationLinkContext';
import { linkFromLocation, pullBriefly, scrubNotificationHash } from './notificationLinks';

/**
 * Opens what a notification points at (docs/design/09-push-notifications.md section 11): from the
 * `/#notify=...` deep link of a new window, or from the worker's message to an open one. The baby
 * is selected only when the user belongs to it (else the link is ignored), a sync pull runs for at
 * most 3 s, then the Now screen takes the link. Nothing is logged or confirmed here.
 */
export function NotificationLinkProvider({ children }: { children: ReactNode }) {
  const { babies, select } = useSelectedBaby();
  const engine = useContext(SyncEngineContext);
  const navigate = useNavigate();
  const [incoming, setIncoming] = useState<NotificationLink | null>(() =>
    typeof window === 'undefined' ? null : linkFromLocation(window.location),
  );
  const [ready, setReady] = useState<NotificationLink | null>(null);
  const handled = useRef<NotificationLink | null>(null);

  useEffect(scrubNotificationHash, []);

  useEffect(() => {
    const worker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const link = linkOfMessage(event.data);
      if (!link) return;
      setIncoming(link);
      navigate(DEEP_LINK_PATH);
    };
    worker.addEventListener('message', onMessage);
    return () => worker.removeEventListener('message', onMessage);
  }, [navigate]);

  useEffect(() => {
    if (!incoming || babies === undefined || handled.current === incoming) return;
    handled.current = incoming;
    if (!babies.some((baby) => baby.id === incoming.babyId)) return;
    select(incoming.babyId);
    void pullBriefly(engine).then(() => setReady(incoming));
  }, [incoming, babies, select, engine]);

  return (
    <NotificationLinkContext value={{ link: ready, consume: () => setReady(null) }}>
      {children}
    </NotificationLinkContext>
  );
}
