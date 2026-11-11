import { render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { forgetSelectedBaby, writeSelectedBabyId } from '../baby/selectedBabyStorage';
import type { BabyRoutineDb } from '../db/database';
import { createEvent, type CreateEventInput } from '../db/eventCommands';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { fakeNativeShell } from '../platform/nativeTestKit';
import { writeCachedPredictions } from '../predictions/predictionsCache';
import { mergeEventDelta } from '../sync/pull';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, serverEvent, testDatabase } from '../test/fakeApi';
import type { WidgetBridge } from './widgetBridge';
import { onWidgetInputsChanged } from './widgetInputs';
import { refreshWidgetNow } from './widgetStatus';
import { WidgetSync } from './WidgetSync';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

interface Mounted {
  db: BabyRoutineDb;
  snapshots: string[];
  setOutbox(entries: unknown[]): void;
  shell: ReturnType<typeof fakeNativeShell>;
  last(): {
    selectedBabyId: string | null;
    babies: { lastDiaper?: { kind: string; at: string } }[];
  };
  unmount(): void;
}

async function mount(debounceMs = 50): Promise<Mounted> {
  const db = testDatabase();
  await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' });
  await db.eventTypes.bulkPut([FEEDING_TYPE, SLEEP_TYPE, DIAPER_TYPE]);
  let outbox: unknown[] = [];
  const snapshots: string[] = [];
  const bridge: WidgetBridge = {
    writeSnapshot: async (json) => void snapshots.push(json),
    readOutbox: async () => JSON.stringify(outbox),
    removeOutbox: async (ids) => {
      outbox = outbox.filter((e) => !ids.includes((e as { id: string }).id));
    },
    clearAll: async () => undefined,
    diagnose: async () => 'test',
    probe: async () => 'test',
  };
  const shell = fakeNativeShell();
  const view = render(
    <DatabaseProvider db={db}>
      <WidgetSync bridge={bridge} shell={shell} debounceMs={debounceMs} />
    </DatabaseProvider>,
  );
  await waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
  // Let the live query's first answer and its (unchanged, so unwritten) rebuild settle.
  await sleep(Math.min(debounceMs * 3, 200));
  return {
    db,
    snapshots,
    shell,
    setOutbox: (entries) => {
      outbox = entries;
    },
    last: () => JSON.parse(snapshots[snapshots.length - 1]),
    unmount: () => view.unmount(),
  };
}

const diaperAt = (startedAt: string, content = 'WET'): CreateEventInput => ({
  babyId: BABY_ID,
  typeId: DIAPER_TYPE.id,
  startedAt,
  endedAt: startedAt,
  payload: { content },
});

afterEach(() => {
  forgetSelectedBaby();
});

describe('WidgetSync', () => {
  it('publishes the snapshot and drains the outbox when the app resumes', async () => {
    const m = await mount();
    expect(m.last().babies[0]).toBeDefined();
    expect(JSON.parse(m.snapshots[0]).babies[0].name).toBe('Lia');

    m.setOutbox([
      {
        id: crypto.randomUUID(),
        babyId: BABY_ID,
        type: 'diaper',
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
        payload: { kind: 'wet' },
        source: 'widget',
      },
    ]);
    await act(async () => m.shell.resume());
    await waitFor(() => expect(m.db.events.count()).resolves.toBe(1));
    await waitFor(() => expect(m.last().babies[0].lastDiaper?.kind).toBe('wet'));

    m.unmount();
    await waitFor(() => expect(m.shell.listenerCount()).toBe(0));
  });

  it('writes once after a burst of local writes', async () => {
    const m = await mount(150);
    const before = m.snapshots.length;

    await createEvent(m.db, diaperAt(minutesAgo(30), 'WET'));
    await createEvent(m.db, diaperAt(minutesAgo(20), 'MIXED'));
    await createEvent(m.db, diaperAt(minutesAgo(10), 'DIRTY'));

    await waitFor(() => expect(m.snapshots.length).toBe(before + 1));
    expect(m.last().babies[0].lastDiaper?.kind).toBe('dirty');
    await sleep(400);
    expect(m.snapshots.length).toBe(before + 1);
    m.unmount();
  });

  it('writes after a sync pull merges what another phone logged', async () => {
    const m = await mount();
    const at = minutesAgo(5);

    await mergeEventDelta(m.db, BABY_ID, [
      serverEvent({
        id: 'evt-other-phone',
        typeId: DIAPER_TYPE.id,
        startedAt: at,
        endedAt: at,
        payload: { content: 'DIRTY' },
        createdBy: 'user-2',
      }),
    ]);

    await waitFor(() => expect(m.last().babies[0].lastDiaper).toEqual({ at, kind: 'dirty' }));
    m.unmount();
  });

  it('writes when the selected baby changes (it is not in the database)', async () => {
    const m = await mount();
    expect(m.last().selectedBabyId).toBeNull();

    writeSelectedBabyId(BABY_ID);

    await waitFor(() => expect(m.last().selectedBabyId).toBe(BABY_ID));
    m.unmount();
  });

  it('writes at once when the app leaves the foreground, without waiting for the debounce', async () => {
    const m = await mount(60_000);
    const before = m.snapshots.length;
    await createEvent(m.db, diaperAt(minutesAgo(3), 'MIXED'));
    await sleep(100);
    expect(m.snapshots.length).toBe(before);

    await act(async () => m.shell.pause());

    await waitFor(() => expect(m.last().babies[0].lastDiaper?.kind).toBe('mixed'));
    m.unmount();
  });

  it('writes at once when the page is hidden', async () => {
    const m = await mount(60_000);
    await createEvent(m.db, diaperAt(minutesAgo(3), 'DIRTY'));
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(m.last().babies[0].lastDiaper?.kind).toBe('dirty'));
    } finally {
      if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
      else delete (document as { visibilityState?: unknown }).visibilityState;
    }
    m.unmount();
  });

  it('rewrites the file when a widget entry was dropped, even though its own copy did not change', async () => {
    const m = await mount();
    const before = m.snapshots.length;

    // Nothing in the outbox and nothing changed: nothing to write.
    await act(async () => m.shell.resume());
    await sleep(150);
    expect(m.snapshots.length).toBe(before);

    // The widget showed this tap in the file already; the app drops it (unknown activity), so its copy must win.
    m.setOutbox([
      {
        id: crypto.randomUUID(),
        babyId: BABY_ID,
        type: 'activity',
        occurredAt: minutesAgo(1),
        payload: { kind: 'not_an_activity' },
        source: 'widget',
      },
    ]);
    await act(async () => m.shell.resume());
    await waitFor(() => expect(m.snapshots.length).toBe(before + 1));
    expect(await m.db.events.count()).toBe(0);
    m.unmount();
  });

  it('never writes after it stopped (sign-out), even with a change pending', async () => {
    const m = await mount(100);
    const before = m.snapshots.length;
    await createEvent(m.db, diaperAt(minutesAgo(2)));

    m.unmount();
    await sleep(300);

    expect(m.snapshots.length).toBe(before);
    await refreshWidgetNow();
    expect(m.snapshots.length).toBe(before);
  });
});

describe('widget inputs outside the database', () => {
  it('signals the selected baby and the cached predictions', () => {
    let calls = 0;
    const stop = onWidgetInputsChanged(() => {
      calls += 1;
    });
    writeSelectedBabyId(BABY_ID);
    writeCachedPredictions(BABY_ID, {
      data: {
        babyId: BABY_ID,
        generatedAt: new Date().toISOString(),
        predictions: [],
        insufficientData: [],
      },
      fetchedAt: Date.now(),
    });
    stop();
    writeSelectedBabyId(BABY_ID);

    expect(calls).toBe(2);
  });
});
