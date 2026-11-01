import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext } from '../auth/AuthContext';
import type { BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, Medication } from '../db/models';
import { I18nProvider } from '../i18n/I18nProvider';
import { BUILT_IN_TYPES, DIAPER_T, event } from '../presets/presetFixtures';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { testQueryClient } from '../test/renderApp';
import { writeLastSeenAt } from './lastSeen';
import { QuickLogToastProvider } from './QuickLogToastProvider';
import { useQuickLogToastContext } from './QuickLogToastContext';
import { pinClock } from './ui/nowKit';
import { useNowScreen } from './useNow';

const BABY: Baby = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const MED: Medication = {
  id: 'm1',
  babyId: BABY_ID,
  name: 'Colidis',
  defaultDosage: null,
  notes: null,
  isUsual: true,
  createdAt: '2026-10-01T00:00:00.000Z',
};

let db: BabyRoutineDb;
let api: ReturnType<typeof fakeApi>['api'];
let client: ReturnType<typeof testQueryClient>;
beforeEach(async () => {
  db = testDatabase();
  api = fakeApi((call) =>
    call.path.endsWith('/members')
      ? [{ userId: 'u-vini', displayName: 'Vini', role: 'Parent', joinedAt: '2026-10-01' }]
      : undefined,
  ).api;
  client = testQueryClient();
  await db.eventTypes.bulkPut(BUILT_IN_TYPES);
  await db.medications.put(MED);
});
afterEach(async () => {
  vi.useRealTimers();
  await db.delete();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <AuthContext value={fakeAuth()}>
        <ApiClientContext value={api}>
          <QueryClientProvider client={client}>
            <DatabaseProvider db={db}>
              <QuickLogToastProvider>{children}</QuickLogToastProvider>
            </DatabaseProvider>
          </QueryClientProvider>
        </ApiClientContext>
      </AuthContext>
    </I18nProvider>
  );
}

function renderNow(baby: Baby = BABY) {
  return renderHook(() => ({ model: useNowScreen(baby), toast: useQuickLogToastContext() }), {
    wrapper,
  });
}

describe('useNowScreen', () => {
  it('loads the model: unknown state, tiles, trays and the read/write flag', async () => {
    const { result } = renderNow();
    await waitFor(() => expect(result.current.model).toBeDefined());
    const model = result.current.model!;
    expect(model.state.kind).toBe('unknown');
    expect(model.sleepActions[0]).toEqual({ kind: 'fell_asleep', primary: true });
    expect(model.tiles.map((t) => t.id)).toEqual(['feed', 'diaper', 'meds', 'more']);
    expect(model.trays.meds?.usual).toEqual([MED]);
    expect(model.readOnly).toBe(false);
    expect(model.catchUp).toBeNull();
  });

  it('a sleep command updates the state through the live query and shows the toast', async () => {
    // Early afternoon: a sleep started now is a nap (woke_up follows), whatever time the suite runs at.
    pinClock(14);
    const { result } = renderNow();
    await waitFor(() => expect(result.current.model).toBeDefined());
    await act(() => result.current.model!.commands.sleep('fell_asleep', 'nap'));
    await waitFor(() => expect(result.current.model!.state.kind).toBe('asleep'));
    expect(result.current.model!.sleepActions.map((a) => a.kind)).toContain('woke_up');
    expect(result.current.toast?.current?.message).toMatch(/^(Nap|Night sleep) from \d\d:\d\d$/);

    await act(() => result.current.toast!.undo());
    await waitFor(() => expect(result.current.model!.state.kind).toBe('unknown'));
  });

  it('a tray command logs and the tile follows', async () => {
    const { result } = renderNow();
    await waitFor(() => expect(result.current.model).toBeDefined());
    await act(() => result.current.model!.commands.tray({ kind: 'diaper', content: 'WET' }));
    await waitFor(() =>
      expect(result.current.model!.tiles[1]).toMatchObject({ detail: { content: 'WET' } }),
    );
    expect(result.current.toast?.current?.message).toBe('Diaper logged, Wet');
  });

  it('lists what another caregiver logged since the last open, with the member name', async () => {
    const lastOpen = new Date(Date.now() - 3_600_000).toISOString();
    writeLastSeenAt(BABY_ID, lastOpen);
    const now = new Date(Date.now() - 60_000).toISOString();
    await db.events.put(
      event({
        id: 'remote',
        typeId: DIAPER_T,
        startedAt: now,
        endedAt: now,
        payload: { content: 'WET' },
        createdBy: 'u-vini',
        createdAt: now,
      }),
    );
    const { result } = renderNow();
    await waitFor(() => expect(result.current.model?.catchUp?.groups[0]?.name).toBe('Vini'));
    expect(result.current.model!.catchUp).toMatchObject({ since: lastOpen, total: 1 });

    act(() => result.current.model!.acknowledgeCatchUp());
    await waitFor(() => expect(result.current.model!.catchUp).toBeNull());
  });

  it('viewers get a read-only model', async () => {
    const { result } = renderNow({ ...BABY, role: 'Viewer' });
    await waitFor(() => expect(result.current.model?.readOnly).toBe(true));
  });
});
