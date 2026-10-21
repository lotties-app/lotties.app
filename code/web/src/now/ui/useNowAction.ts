import { useCallback, useRef, useState } from 'react';
import { describeApiError } from '../../api/errorMessages';

export interface NowAction {
  /** Message of the last failed command, until the next one starts. */
  error: string | null;
  /** Runs `command`; a failure becomes `error` (never thrown), the result is `undefined` then. */
  run: <T>(command: () => Promise<T>) => Promise<T | undefined>;
  clearError: () => void;
}

/**
 * Wraps the Now commands: one at a time (a double tap does not log twice; a command that arrives
 * while another still runs is dropped) and a failure becomes a calm message instead of an
 * unhandled rejection. Buttons are not disabled meanwhile: a local write takes a few milliseconds.
 */
export function useNowAction(): NowAction {
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(async <T>(command: () => Promise<T>) => {
    if (running.current) return undefined;
    running.current = true;
    setError(null);
    try {
      return await command();
    } catch (e) {
      setError(describeApiError(e));
      return undefined;
    } finally {
      running.current = false;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { error, run, clearError };
}
