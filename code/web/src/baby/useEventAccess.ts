import { useMemo } from 'react';
import type { Baby, BabyEvent } from '../db/models';
import { useMembers } from '../now/useMembers';
import type { MemberDto } from '../sync/contract';
import { canChangeEvent, canControlTimer, canLog, isOwnEvent } from './permissions';
import { personShownName } from './shownName';

/** Who may do what with the baby's events, for one screen (docs/SPEC.md "Roles and permissions"). */
export interface EventAccess {
  /** Owners, Parents and Caregivers log events; Viewers only read. */
  canLog: boolean;
  /** Whether the user may edit or delete the event (Caregivers: only their own). */
  canChange: (event: Pick<BabyEvent, 'createdBy'>) => boolean;
  /**
   * Who logged the event when it was someone else: their display name, `''` while the name is
   * unknown (offline, members not loaded); `null` for the user's own (or not yet synced) events.
   */
  authorOf: (event: Pick<BabyEvent, 'createdBy'>) => string | null;
  /**
   * For an event the user can see and log around but may not change (a Caregiver and someone
   * else's entry): who logged it, as `authorOf`. `null` when the user may change it, and for
   * Viewers (who change nothing and see the view-only notice instead).
   */
  lockedBy: (event: Pick<BabyEvent, 'createdBy'> | undefined) => string | null;
  /**
   * As `lockedBy`, for the stop, pause and resume of a running timer: `null` when the user may use
   * them, which a Caregiver may on someone else's running timer (`canControlTimer`).
   */
  controlLockedBy: (event: BabyEvent | undefined) => string | null;
}

function nameIn(members: readonly MemberDto[] | undefined, userId: string): string {
  const member = members?.find((m) => m.userId === userId);
  return member ? personShownName(member) : '';
}

/** The rules of `permissions.ts` bound to `baby`, plus the members' names (online). */
export function eventAccess(
  baby: Pick<Baby, 'role' | 'userId'>,
  members: readonly MemberDto[] | undefined,
): EventAccess {
  const logs = canLog(baby);
  const authorOf = (event: Pick<BabyEvent, 'createdBy'>) =>
    isOwnEvent(baby, event) || event.createdBy === null ? null : nameIn(members, event.createdBy);
  return {
    canLog: logs,
    canChange: (event) => canChangeEvent(baby, event),
    authorOf,
    lockedBy: (event) =>
      event && logs && !canChangeEvent(baby, event) ? (authorOf(event) ?? '') : null,
    controlLockedBy: (event) =>
      event && logs && !canControlTimer(baby, event) ? (authorOf(event) ?? '') : null,
  };
}

/** `eventAccess` for the selected baby, with the members list shared with Settings and Now. */
export function useEventAccess(baby: Baby): EventAccess {
  const members = useMembers(baby);
  return useMemo(() => eventAccess(baby, members), [baby, members]);
}
