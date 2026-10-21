import type { ReactNode } from 'react';
import { QuickLogToastContext } from './QuickLogToastContext';
import { useQuickLogToast } from './useQuickLogToast';

/**
 * Holds the receipt toast state for everything below it (needs `DatabaseProvider` above). The
 * toast itself is rendered by the Now screen from `useQuickLogToastContext()`.
 */
export function QuickLogToastProvider({ children }: { children: ReactNode }) {
  const toast = useQuickLogToast();
  return <QuickLogToastContext value={toast}>{children}</QuickLogToastContext>;
}
