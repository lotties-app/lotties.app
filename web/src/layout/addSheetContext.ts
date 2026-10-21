import { createContext, useContext, useEffect, useRef } from 'react';

export interface AddSheetValue {
  /** Whether the "+" is offered at all (viewers and a missing baby cannot log). */
  enabled: boolean;
  /** Counts the presses of "+"; screens open their More sheet when it changes. */
  token: number;
  request: () => void;
}

export const AddSheetContext = createContext<AddSheetValue | null>(null);

export function useAddSheet(): AddSheetValue | null {
  return useContext(AddSheetContext);
}

/** Runs `onRequest` each time "+" is pressed after this component mounted. */
export function useAddRequests(onRequest: () => void): void {
  const add = useAddSheet();
  const token = add?.token ?? 0;
  const handled = useRef(token);
  const callback = useRef(onRequest);
  useEffect(() => {
    callback.current = onRequest;
  });
  useEffect(() => {
    if (token === handled.current) return;
    handled.current = token;
    callback.current();
  }, [token]);
}
