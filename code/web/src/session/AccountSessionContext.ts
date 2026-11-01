import { createContext, useContext } from 'react';

export interface AccountSession {
  /**
   * Unmounts every screen, deletes the account's local data and signs out (see
   * `endAccountSession`). Stop the sync engine before calling it.
   */
  end: () => Promise<void>;
}

export const AccountSessionContext = createContext<AccountSession | null>(null);

/** The current account session; `null` outside `AccountDataProvider` (tests inject a database). */
export function useAccountSession(): AccountSession | null {
  return useContext(AccountSessionContext);
}
