import { dismissalStore, LOCAL_DATE } from './dismissalStore';

/*
 * "Not today" of the belly pain suggestion: the local date of the window it was chosen for, per
 * baby, in localStorage. The entry is per account (cleared with the account's other device state,
 * session/deviceState.ts); the next day's window shows again.
 */

const store = dismissalStore('baby-routine.belly-pattern-dismissed.', LOCAL_DATE);

/** The window date (`yyyy-mm-dd`) "Not today" was chosen for, or `null`. */
export const readBellyDismissal = (babyId: string): string | null => store.read(babyId);

export const writeBellyDismissal = (babyId: string, windowDate: string): void =>
  store.write(babyId, windowDate);

export const clearAllBellyDismissals = (): void => store.clearAll();
