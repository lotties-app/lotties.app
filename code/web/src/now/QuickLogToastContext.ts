import { createContext, useContext } from 'react';
import type { QuickLogToast } from './useQuickLogToast';

/** The receipt toast of the Now commands (see `QuickLogToastProvider`); `null` outside it. */
export const QuickLogToastContext = createContext<QuickLogToast | null>(null);

/** The receipt toast, or `null` when no `QuickLogToastProvider` is above. */
export function useQuickLogToastContext(): QuickLogToast | null {
  return useContext(QuickLogToastContext);
}
