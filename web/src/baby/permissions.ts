import type { Baby } from '../db/models';

/** Parents and owners log events and edit catalogs; viewers only read. */
export function canWrite(baby: Pick<Baby, 'role'>): boolean {
  return baby.role !== 'Viewer';
}

/** Owners edit the baby, manage members and invites. */
export function isOwner(baby: Pick<Baby, 'role'>): boolean {
  return baby.role === 'Owner';
}

export const VIEWER_NOTICE = 'You have view-only access to this baby, so logging is turned off.';
