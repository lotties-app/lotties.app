import { describe, expect, it } from 'vitest';
import type { BabyRole } from '../db/models';
import type { MemberDto } from '../sync/contract';
import type { BabyEvent } from '../db/models';
import {
  canChangeEvent,
  canControlTimer,
  canLog,
  canWrite,
  isCaregiver,
  isOwnEvent,
  isOwner,
  isRunningControlChange,
} from './permissions';
import { eventAccess } from './useEventAccess';

const ROLES: BabyRole[] = ['Owner', 'Parent', 'Caregiver', 'Viewer'];
const ME = 'user-me';
const mine = { createdBy: ME };
const unsynced = { createdBy: null };
const anas = { createdBy: 'user-ana' };
const members: MemberDto[] = [
  { userId: 'user-ana', displayName: ' Ana ', role: 'Parent', joinedAt: '2026-10-01' },
  { userId: ME, displayName: 'Lu', role: 'Caregiver', joinedAt: '2026-10-02' },
];

describe('role rules', () => {
  it.each([
    ['Owner', true, true, false, true],
    ['Parent', true, true, false, false],
    ['Caregiver', false, true, true, false],
    ['Viewer', false, false, false, false],
  ] as const)('%s: write %s, log %s, caregiver %s, owner %s', (role, write, log, care, owner) => {
    const baby = { role };
    expect([canWrite(baby), canLog(baby), isCaregiver(baby), isOwner(baby)]).toEqual([
      write,
      log,
      care,
      owner,
    ]);
  });

  it('Owners and Parents change anyone’s events; a Caregiver only their own; a Viewer none', () => {
    const table = ROLES.map((role) => {
      const baby = { role, userId: ME };
      return [
        role,
        canChangeEvent(baby, mine),
        canChangeEvent(baby, unsynced),
        canChangeEvent(baby, anas),
      ];
    });
    expect(table).toEqual([
      ['Owner', true, true, true],
      ['Parent', true, true, true],
      ['Caregiver', true, true, false],
      ['Viewer', false, false, false],
    ]);
  });

  it('without the user’s id only unsynced events count as their own', () => {
    expect(isOwnEvent({ userId: null }, unsynced)).toBe(true);
    expect(isOwnEvent({}, mine)).toBe(false);
    expect(canChangeEvent({ role: 'Caregiver' }, mine)).toBe(false);
  });
});

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const running: BabyEvent = {
  id: 'e1',
  babyId: 'b1',
  typeId: 'feeding',
  startedAt: '2026-10-22T11:40:00.000Z',
  endedAt: null,
  payload: { method: 'bottle', bottle_feeding_type: 'formula', food: '', pause_count: 1 },
  notes: 'from Ana',
  createdBy: 'user-ana',
  createdAt: '2026-10-22T11:40:00.000Z',
  updatedAt: '2026-10-22T11:40:00.000Z',
  deletedAt: null,
};
const change = (next: Partial<BabyEvent>) => ({ ...running, ...next });

describe('isRunningControlChange (mirrors the API’s RunningEventControl)', () => {
  it.each([
    ['a stop', change({ endedAt: '2026-10-22T12:00:00.000Z' })],
    ['a stop a moment ahead of the clock', change({ endedAt: '2026-10-22T12:04:00.000Z' })],
    ['a pause', change({ payload: { ...running.payload, paused_at: '2026-10-22T11:50:00.000Z' } })],
    [
      'the amount filled at the stop',
      change({
        endedAt: '2026-10-22T12:00:00.000Z',
        payload: { ...running.payload, amount_ml: 90 },
      }),
    ],
    ['an empty value filled', change({ payload: { ...running.payload, food: 'rice' } })],
    ['the note re-trimmed', change({ notes: ' from Ana ' })],
  ])('allows %s', (_, next) => {
    expect(isRunningControlChange(running, next, NOW)).toBe(true);
  });

  it.each([
    ['a moved start', change({ startedAt: '2026-10-22T11:30:00.000Z' })],
    ['a changed note', change({ notes: 'mine' })],
    ['another type', change({ typeId: 'sleep' })],
    [
      'an overwritten value',
      change({ payload: { ...running.payload, bottle_feeding_type: 'breast_milk' } }),
    ],
    ['a removed value', change({ payload: { method: 'bottle' } })],
    ['an end before the start', change({ endedAt: '2026-10-22T11:00:00.000Z' })],
    ['an end an hour ahead', change({ endedAt: '2026-10-22T13:00:00.000Z' })],
  ])('refuses %s', (_, next) => {
    expect(isRunningControlChange(running, next, NOW)).toBe(false);
  });

  it('refuses any change to a stopped or deleted event', () => {
    const stopped = change({ endedAt: '2026-10-22T11:55:00.000Z' });
    expect(
      isRunningControlChange(stopped, change({ endedAt: '2026-10-22T12:00:00.000Z' }), NOW),
    ).toBe(false);
    const deleted = change({ deletedAt: '2026-10-22T11:55:00.000Z' });
    expect(isRunningControlChange(deleted, deleted, NOW)).toBe(false);
  });
});

describe('canControlTimer', () => {
  const caregiver = { role: 'Caregiver' as const, userId: ME };

  it('lets a Caregiver stop, pause and resume someone else’s running timer', () => {
    expect(canControlTimer(caregiver, running, NOW)).toBe(true);
  });

  it('not a nursing session (resuming moves its side clock) nor a stopped one; not for Viewers', () => {
    const nursing = change({
      payload: { method: 'breast', side: 'left', side_since: '2026-10-22T11:40:00.000Z' },
    });
    expect(canControlTimer(caregiver, nursing, NOW)).toBe(false);
    expect(canControlTimer(caregiver, change({ endedAt: '2026-10-22T11:55:00.000Z' }), NOW)).toBe(
      false,
    );
    expect(canControlTimer({ role: 'Viewer', userId: ME }, running, NOW)).toBe(false);
    expect(canControlTimer({ role: 'Parent', userId: ME }, nursing, NOW)).toBe(true);
  });
});

describe('eventAccess', () => {
  it('names who logged someone else’s entry, never the user’s own', () => {
    const access = eventAccess({ role: 'Parent', userId: ME }, members);
    expect(access.authorOf(anas)).toBe('Ana');
    expect(access.authorOf(mine)).toBeNull();
    expect(access.authorOf(unsynced)).toBeNull();
    expect(access.authorOf({ createdBy: 'user-gone' })).toBe('');
    expect(eventAccess({ role: 'Parent', userId: ME }, undefined).authorOf(anas)).toBe('');
  });

  it('locks other people’s entries for a Caregiver only', () => {
    const caregiver = eventAccess({ role: 'Caregiver', userId: ME }, members);
    expect(caregiver.lockedBy(anas)).toBe('Ana');
    expect(caregiver.lockedBy(mine)).toBeNull();
    expect(caregiver.lockedBy(undefined)).toBeNull();
    expect(eventAccess({ role: 'Parent', userId: ME }, members).lockedBy(anas)).toBeNull();
    // Viewers change nothing and get the view-only notice instead of per-entry locks.
    expect(eventAccess({ role: 'Viewer', userId: ME }, members).lockedBy(anas)).toBeNull();
  });
});
