import { useState } from 'react';
import { describeApiError, offlineMessage, type ErrorOverrides } from '../api/errorMessages';
import { useOnline } from '../sync/useOnline';

export interface ServerAction {
  /** Runs `action`; resolves `true` on success. A failure sets `error` and resolves `false`. */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  pending: boolean;
  error: string | null;
  online: boolean;
  clearError: () => void;
}

/** Wraps an online-only server call with pending/error state and an offline guard. */
export function useServerAction(messages?: ErrorOverrides): ServerAction {
  const online = useOnline();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    if (!online) {
      setError(offlineMessage());
      return false;
    }
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(describeApiError(e, messages));
      return false;
    } finally {
      setPending(false);
    }
  };

  return { run, pending, error, online, clearError: () => setError(null) };
}
