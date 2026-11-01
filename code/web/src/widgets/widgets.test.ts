import { beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { drainOutbox, parseOutbox, type OutboxEntry } from './outbox';
import { buildSnapshot } from './snapshot';
import type { WidgetBridge } from './widgetBridge';

const NOW = new Date('2026-10-31T12:00:00.000Z');

async function seeded(): Promise<BabyRoutineDb> {
  const db = testDatabase();
  await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' });
  await db.eventTypes.bulkPut([FEEDING_TYPE, SLEEP_TYPE, DIAPER_TYPE]);
  return db;
}

function fakeBridge(entries: unknown[]): WidgetBridge & { text: string[]; removed: string[] } {
  const bridge = {
    text: [] as string[],
    removed: [] as string[],
    writeSnapshot: async (json: string) => void bridge.text.push(json),
    readOutbox: async () => JSON.stringify(entries),
    removeOutbox: async (ids: string[]) => void bridge.removed.push(...ids),
    clearAll: async () => undefined,
    diagnose: async () => 'test',
    probe: async () => 'test',
  };
  return bridge;
}

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: crypto.randomUUID(),
  babyId: BABY_ID,
  type: 'diaper',
  occurredAt: '2026-10-31T11:30:00.000Z',
  payload: { kind: 'wet' },
  source: 'siri',
  ...over,
});

describe('parseOutbox', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const good = entry();
    const text = JSON.stringify([good, { id: 1 }, null, { ...good, type: 'bogus' }]);
    expect(parseOutbox(text)).toEqual([good]);
    expect(parseOutbox('not json')).toEqual([]);
    expect(parseOutbox('{}')).toEqual([]);
  });
});

describe('buildSnapshot', () => {
  let db: BabyRoutineDb;
  beforeEach(async () => {
    db = await seeded();
  });

  it('lists each baby with the last feed and diaper as facts', async () => {
    await db.events.bulkPut([
      ev('f1', FEEDING_TYPE.id, '2026-10-31T09:00:00.000Z', { method: 'bottle', amount_ml: 120 }),
      ev('d1', DIAPER_TYPE.id, '2026-10-31T10:00:00.000Z', { content: 'WET' }),
    ]);
    const snapshot = await buildSnapshot(db, BABY_ID, NOW);
    expect(snapshot).toMatchObject({ version: 1, signedIn: true, selectedBabyId: BABY_ID });
    expect(snapshot.hideNamesOnLockScreen).toBe(true);
    expect(snapshot.babies[0]).toMatchObject({
      id: BABY_ID,
      name: 'Lia',
      lastFeed: { at: '2026-10-31T09:00:00.000Z', kind: 'bottle', amountMl: 120 },
      lastDiaper: { at: '2026-10-31T10:00:00.000Z', kind: 'wet' },
    });
  });

  it('says asleep while a sleep timer runs', async () => {
    await db.events.put(ev('s1', SLEEP_TYPE.id, '2026-10-31T11:00:00.000Z', {}, null));
    const [baby] = (await buildSnapshot(db, null, NOW)).babies;
    expect(baby.sleep?.state).toBe('asleep');
  });
});

describe('drainOutbox', () => {
  it('writes a diaper and a bottle as local events and removes the entries', async () => {
    const db = await seeded();
    const diaper = entry();
    const bottle = entry({ type: 'feed', payload: { kind: 'bottle', amountMl: 90 } });
    const bridge = fakeBridge([diaper, bottle]);
    expect(await drainOutbox(db, bridge)).toBe(2);
    const events = await db.events.toArray();
    expect(events.map((e) => e.id).sort()).toEqual([diaper.id, bottle.id].sort());
    expect(events.find((e) => e.id === diaper.id)?.payload).toMatchObject({ content: 'WET' });
    expect(bridge.removed.sort()).toEqual([diaper.id, bottle.id].sort());
  });

  it('does not log an entry twice when the removal was lost', async () => {
    const db = await seeded();
    const e = entry();
    await drainOutbox(db, fakeBridge([e]));
    const again = fakeBridge([e]);
    expect(await drainOutbox(db, again)).toBe(0);
    expect(await db.events.count()).toBe(1);
    expect(again.removed).toEqual([e.id]);
  });

  it('drops an entry for an unknown baby', async () => {
    const db = await seeded();
    const bridge = fakeBridge([entry({ babyId: 'nobody' })]);
    expect(await drainOutbox(db, bridge)).toBe(0);
    expect(await db.events.count()).toBe(0);
    expect(bridge.removed).toHaveLength(1);
  });

  it('writes sleep start and end', async () => {
    const db = await seeded();
    await drainOutbox(
      db,
      fakeBridge([entry({ type: 'sleep_start', occurredAt: '2026-10-31T10:00:00.000Z' })]),
    );
    expect((await buildSnapshot(db, null, NOW)).babies[0].sleep?.state).toBe('asleep');
    await drainOutbox(
      db,
      fakeBridge([entry({ type: 'sleep_end', occurredAt: '2026-10-31T11:00:00.000Z' })]),
    );
    expect((await buildSnapshot(db, null, NOW)).babies[0].sleep?.state).toBe('awake');
  });
});

function ev(
  id: string,
  typeId: string,
  startedAt: string,
  payload: Record<string, unknown>,
  endedAt: string | null = startedAt,
) {
  return {
    id,
    babyId: BABY_ID,
    typeId,
    startedAt,
    endedAt,
    payload,
    deletedAt: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    clientUpdatedAt: startedAt,
    createdByUserId: 'u1',
  } as never;
}
