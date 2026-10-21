import { createContext, useContext } from 'react';
import type { NotificationLink } from '../pwa/sw/deepLink';

export interface NotificationLinkApi {
  /** A validated link for a baby the user belongs to, after the short sync pull; else `null`. */
  link: NotificationLink | null;
  /** The screen handled the link: forget it. */
  consume: () => void;
}

export const NotificationLinkContext = createContext<NotificationLinkApi | null>(null);

/** `null` outside the app shell (tests, previews): nothing to open. */
export function useNotificationLink(): NotificationLinkApi | null {
  return useContext(NotificationLinkContext);
}
