import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { I18nProvider } from '../i18n/I18nProvider';
import { BUILT_IN_TYPES } from '../presets/presetFixtures';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { QuickLogToastProvider } from './QuickLogToastProvider';
import { useQuickLogToastContext } from './QuickLogToastContext';
import { runSleepAction } from './sleepToggle';
import { TOAST_MS, INITIAL_TOAST, toastReducer, type ToastEntry } from './toastModel';
import { useQuickLogToast } from './useQuickLogToast';

const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m, 0);
const token = (createdIds: string[] = ['x']) => ({
  babyId: BABY_ID,
  createdIds,
  stopped: [],
  at: at(14, 12).toISOString(),
  shiftMinutes: 0,
});
const entry = (overrides: Partial<ToastEntry> = {}): ToastEntry => ({
  token: token(),
  receipt: { kind: 'sleep', action: 'fell_asleep', sleepKind: 'nap' },
  types: BUILT_IN_TYPES,
  ...overrides,
});

describe('toastReducer', () => {
  it('shows with a 6 s deadline, pauses with the time left and resumes', () => {
    let s = toastReducer(INITIAL_TOAST, { type: 'show', entry: entry(), now: 1000 });
    expect(s).toMatchObject({ id: 1, deadline: 1000 + TOAST_MS });
    s = toastReducer(s, { type: 'pause', now: 3000 });
    expect(s).toMatchObject({ deadline: null, remaining: TOAST_MS - 2000 });
    s = toastReducer(s, { type: 'resume', now: 10_000 });
    expect(s.deadline).toBe(10_000 + TOAST_MS - 2000);
  });

  it('a shift restarts the countdown; a stale hide or token is ignored', () => {
    let s = toastReducer(INITIAL_TOAST, { type: 'show', entry: entry(), now: 0 });
    s = toastReducer(s, { type: 'show', entry: entry(), now: 100 });
    const shifted = { ...token(), shiftMinutes: 10 };
    expect(toastReducer(s, { type: 'token', id: 1, token: shifted, now: 500 })).toBe(s);
    s = toastReducer(s, { type: 'token', id: 2, token: shifted, now: 500 });
    expect(s).toMatchObject({ deadline: 500 + TOAST_MS, entry: { token: { shiftMinutes: 10 } } });
    expect(toastReducer(s, { type: 'hide', id: 1 })).toBe(s);
    expect(toastReducer(s, { type: 'hide', id: 2 }).entry).toBeNull();
  });
});

describe('useQuickLogToast', () => {
  let db: BabyRoutineDb;
  beforeEach(() => {
    db = testDatabase();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await db.delete();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider>
      <DatabaseProvider db={db}>{children}</DatabaseProvider>
    </I18nProvider>
  );

  it('shows the message and hides after 6 s, not while paused', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { result } = renderHook(() => useQuickLogToast(), { wrapper });
    act(() => result.current.show(entry()));
    expect(result.current.current).toMatchObject({
      message: `Nap from ${'14:12'}`,
      shiftable: true,
      shiftOptions: [0, 5, 10, 15],
      shiftMinutes: 0,
    });

    act(() => vi.advanceTimersByTime(4000));
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.current).not.toBeNull();
    act(() => result.current.resume());
    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.current).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.current).toBeNull();
  });

  it('a new toast replaces the previous one; dismiss hides it', () => {
    const { result } = renderHook(() => useQuickLogToast(), { wrapper });
    act(() => result.current.show(entry()));
    const first = result.current.current!.id;
    act(() =>
      result.current.show(
        entry({ receipt: { kind: 'tray', choice: { kind: 'bottle', amountMl: 90 } } }),
      ),
    );
    expect(result.current.current).toMatchObject({ message: 'Bottle logged, 90 ml' });
    expect(result.current.current!.id).not.toBe(first);
    act(() => result.current.dismiss());
    expect(result.current.current).toBeNull();
  });

  it('shift moves the events and updates the message; undo reverts and hides', async () => {
    const { result } = renderHook(() => useQuickLogToastContext(), {
      wrapper: ({ children }) =>
        wrapper({ children: <QuickLogToastProvider>{children}</QuickLogToastProvider> }),
    });
    const now = new Date();
    const ran = await runSleepAction(db, 'fell_asleep', {
      babyId: BABY_ID,
      types: BUILT_IN_TYPES,
      options: { now: () => now },
    });
    act(() => result.current!.show(entry({ token: ran })));
    await act(() => result.current!.shift(10));
    await waitFor(() => expect(result.current!.current?.shiftMinutes).toBe(10));
    const moved = await db.events.get(ran.createdIds[0]);
    expect(Date.parse(moved!.startedAt)).toBe(now.getTime() - 10 * 60_000);

    await act(() => result.current!.undo());
    expect(result.current!.current).toBeNull();
    expect((await db.events.toArray()).every((e) => e.deletedAt !== null)).toBe(true);
    expect(result.current!.error).toBeNull();
  });

  it('a token that cannot shift offers no chips', () => {
    const { result } = renderHook(() => useQuickLogToast(), { wrapper });
    act(() =>
      result.current.show(entry({ token: { babyId: BABY_ID, createdIds: [], stopped: [] } })),
    );
    expect(result.current.current?.shiftable).toBe(false);
  });
});
