import { render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { fakeNativeShell } from '../platform/nativeTestKit';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import type { WidgetBridge } from './widgetBridge';
import { WidgetSync } from './WidgetSync';

describe('WidgetSync', () => {
  it('publishes the snapshot and drains the outbox when the app resumes', async () => {
    const db = testDatabase();
    await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' });
    await db.eventTypes.bulkPut([FEEDING_TYPE, SLEEP_TYPE, DIAPER_TYPE]);
    let outbox: unknown[] = [];
    const snapshots: string[] = [];
    const bridge: WidgetBridge = {
      writeSnapshot: async (json) => void snapshots.push(json),
      readOutbox: async () => JSON.stringify(outbox),
      removeOutbox: async () => {
        outbox = [];
      },
      clearAll: async () => undefined,
      diagnose: async () => 'test',
      probe: async () => 'test',
    };
    const shell = fakeNativeShell();
    const view = render(
      <DatabaseProvider db={db}>
        <WidgetSync bridge={bridge} shell={shell} />
      </DatabaseProvider>,
    );
    await waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
    expect(JSON.parse(snapshots[0]).babies[0].name).toBe('Lia');

    outbox = [
      {
        id: crypto.randomUUID(),
        babyId: BABY_ID,
        type: 'diaper',
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
        payload: { kind: 'wet' },
        source: 'widget',
      },
    ];
    await act(async () => shell.resume());
    await waitFor(() => expect(db.events.count()).resolves.toBe(1));
    await waitFor(() =>
      expect(JSON.parse(snapshots[snapshots.length - 1]).babies[0].lastDiaper?.kind).toBe('wet'),
    );

    view.unmount();
    await waitFor(() => expect(shell.listenerCount()).toBe(0));
  });
});
