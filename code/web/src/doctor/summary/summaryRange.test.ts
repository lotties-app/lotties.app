import { describe, expect, it } from 'vitest';
import type { Baby, Note } from '../../db/models';
import {
  isValidRange,
  lastDays,
  MAX_RANGE_DAYS,
  notesInRange,
  rangeBounds,
  rangeFor,
  spanDays,
} from './summaryRange';

/* The summary period: local calendar days, inclusive, at most 92 (the server's limit). */

const today = new Date(2026, 9, 22, 15, 30);

describe('summary range', () => {
  it('counts the last 7, 14 and 30 local days ending today', () => {
    expect(rangeFor('last7', today)).toEqual({ from: '2026-10-16', to: '2026-10-22' });
    expect(rangeFor('last14', today)).toEqual({ from: '2026-10-09', to: '2026-10-22' });
    expect(rangeFor('last30', today)).toEqual({ from: '2026-09-23', to: '2026-10-22' });
    expect(lastDays(today, 1)).toEqual({ from: '2026-10-22', to: '2026-10-22' });
  });

  it('starts on the day of the latest note, at most 92 days back, or is not available', () => {
    expect(
      rangeFor('sinceNote', today, { lastNoteAt: new Date(2026, 9, 3, 9).toISOString() }),
    ).toEqual({ from: '2026-10-03', to: '2026-10-22' });
    expect(
      rangeFor('sinceNote', today, { lastNoteAt: new Date(2026, 9, 22, 8).toISOString() }),
    ).toEqual({ from: '2026-10-22', to: '2026-10-22' });
    expect(
      rangeFor('sinceNote', today, { lastNoteAt: new Date(2026, 0, 2).toISOString() }),
    ).toEqual(lastDays(today, MAX_RANGE_DAYS));
    expect(rangeFor('sinceNote', today, { lastNoteAt: null })).toBeNull();
  });

  it('accepts a custom range in order and at most 92 days long', () => {
    const custom = { from: '2026-10-01', to: '2026-10-05' };
    expect(rangeFor('custom', today, { custom })).toEqual(custom);
    expect(
      rangeFor('custom', today, { custom: { from: '2026-10-05', to: '2026-10-01' } }),
    ).toBeNull();
    expect(isValidRange({ from: '2026-07-23', to: '2026-10-22' })).toBe(true);
    expect(spanDays('2026-07-23', '2026-10-22')).toBe(92);
    expect(isValidRange({ from: '2026-07-22', to: '2026-10-22' })).toBe(false);
    expect(isValidRange({ from: 'yesterday', to: '2026-10-22' })).toBe(false);
  });

  it('spans whole local days, including a daylight saving change', () => {
    const bounds = rangeBounds({ from: '2026-10-20', to: '2026-10-21' });
    expect(bounds?.start.getTime()).toBe(new Date(2026, 9, 20).getTime());
    expect(bounds?.end.getTime()).toBe(new Date(2026, 9, 22).getTime());
    expect(spanDays('2026-03-07', '2026-03-09')).toBe(3);
  });

  it("keeps the doctor's own notes written in the range, newest first", () => {
    const baby: Baby = {
      id: 'lia',
      name: 'Lia',
      birthDate: '2026-08-01',
      role: 'Doctor',
      userId: 'doc',
    };
    const note = (id: string, createdAt: Date, extra: Partial<Note> = {}): Note => ({
      id,
      babyId: 'lia',
      authorUserId: 'doc',
      author: null,
      kind: 'note',
      visibility: 'shared',
      body: id,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      deletedAt: null,
      ...extra,
    });
    const notes = [
      note('in', new Date(2026, 9, 21, 10)),
      note('private', new Date(2026, 9, 20, 0, 0), { visibility: 'private' }),
      note('before', new Date(2026, 9, 19, 23, 59)),
      note('other', new Date(2026, 9, 21, 9), { authorUserId: 'other-doctor' }),
      note('deleted', new Date(2026, 9, 21, 9), { deletedAt: '2026-10-21T12:00:00Z' }),
      note('after', new Date(2026, 9, 22, 0, 0)),
    ];
    expect(
      notesInRange(baby, notes, { from: '2026-10-20', to: '2026-10-21' }).map((n) => n.id),
    ).toEqual(['in', 'private']);
  });
});
