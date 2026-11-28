import { useCallback, useEffect, useRef, useState } from 'react';
import {
  speechErrorCode,
  type ListenResult,
  type ListenState,
  type SpeechEngineKind,
  type SpeechErrorCode,
  type SpeechPlatform,
} from '../platform/speechTypes';
import type { SpeechLocale } from '../voice/numberWords';
import { speechHints } from '../voice/speechHints';

/** Section 7.2: five alternatives. */
const MAX_RESULTS = 5;
/** No speech, no answer: the engine gives up. */
const LISTEN_TIMEOUT_MS = 15_000;

export type ListenOutcome =
  { listen: ListenResult; error: null } | { listen: null; error: SpeechErrorCode };

export interface Listener {
  /** The engine's state while a listen runs, null when idle. */
  state: ListenState | null;
  /** Listens once; resolves with what was heard or the error (never throws). Ignored while busy. */
  listen: (engine: SpeechEngineKind, locale: SpeechLocale) => Promise<ListenOutcome | null>;
  cancel: () => void;
}

/**
 * One listen at a time (a second tap while listening does nothing), cancelled when the page is hidden
 * (the app went to the background) or left, so the microphone is always released.
 */
export function useListen(platform: SpeechPlatform): Listener {
  const [state, setState] = useState<ListenState | null>(null);
  const running = useRef<{ kind: SpeechEngineKind; interrupted: boolean } | null>(null);

  const cancel = useCallback(() => {
    const current = running.current;
    if (current) void platform.engine(current.kind)?.cancel();
  }, [platform]);

  const listen = useCallback(
    async (kind: SpeechEngineKind, locale: SpeechLocale): Promise<ListenOutcome | null> => {
      if (running.current) return null;
      const engine = platform.engine(kind);
      if (!engine) return { listen: null, error: 'not_available' };
      const session = { kind, interrupted: false };
      running.current = session;
      setState('starting');
      try {
        const result = await engine.listen(
          {
            locale,
            hints: speechHints(locale),
            maxResults: MAX_RESULTS,
            timeoutMs: LISTEN_TIMEOUT_MS,
          },
          setState,
        );
        return { listen: result, error: null };
      } catch (error) {
        return {
          listen: null,
          error: session.interrupted ? 'interrupted' : speechErrorCode(error),
        };
      } finally {
        running.current = null;
        setState(null);
      }
    },
    [platform],
  );

  useEffect(() => {
    const interrupt = () => {
      if (!running.current) return;
      running.current.interrupted = true;
      cancel();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') interrupt();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', interrupt);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', interrupt);
      cancel();
    };
  }, [cancel]);

  return { state, listen, cancel };
}
