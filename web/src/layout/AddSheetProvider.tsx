import { useMemo, useState, type ReactNode } from 'react';
import { AddSheetContext, type AddSheetValue } from './addSheetContext';

/**
 * The "+" of the bottom navigation, as a request: pressing it bumps a counter, and whichever
 * screen is showing opens its More sheet (Now has its trays, Day the full event sheet, the other
 * tabs a host in the shell). Without a provider there is no "+".
 */
export function AddSheetProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [token, setToken] = useState(0);
  const value = useMemo<AddSheetValue>(
    () => ({ enabled, token, request: () => setToken((current) => current + 1) }),
    [enabled, token],
  );
  return <AddSheetContext value={value}>{children}</AddSheetContext>;
}
