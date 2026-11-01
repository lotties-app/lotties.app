import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/ApiError';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import {
  createFormula,
  setCurrentFormula,
  setFormulaArchived,
  updateFormula,
  type FormulaTerms,
} from '../db/formulaCommands';
import { enqueueMutation } from '../db/outbox';
import { formulaMembers } from '../formulas/formulaModel';
import { FEEDING_TYPE } from '../test/builtInTypes';
import {
  BABY_ID,
  SERVER_TIME,
  fakeApi,
  httpError,
  testDatabase,
  type ApiCall,
  type ApiHandler,
} from '../test/fakeApi';
import { toFormulaUpsertRequest, type FormulaDto } from './contract';
import { mergeFormulaDelta } from './pull';
import { SyncEngine } from './SyncEngine';

/*
 * Formulas sync like prescriptions (docs/design/14-formulas.md): pushed before the bottles that
 * name them, merged by client edit time, never deleted; a bottle keeps its name snapshot.
 */

let db: BabyRoutineDb;
let engines: SyncEngine[];

beforeEach(() => {
  db = testDatabase();
  engines = [];
});

afterEach(async () => {
  engines.forEach((e) => e.stop());
  vi.useRealTimers();
  await db.delete();
});

function setup(handler?: ApiHandler) {
  const fake = fakeApi(handler);
  const engine = new SyncEngine({
    db,
    api: fake.api,
    locks: null,
    eventTarget: new EventTarget(),
    isOnline: () => true,
    backoff: { baseMs: 1_000, maxMs: 60_000, random: () => 0.5 },
  });
  engines.push(engine);
  return { engine, ...fake };
}

const TERMS: FormulaTerms = {
  name: 'Nan 1',
  brand: 'Nestlé',
  stage: '1',
  notes: null,
  startedOn: '2026-10-01',
  isCurrent: true,
  archived: false,
};

const label = (c: ApiCall) => {
  const match = /\/(events|formulas)\/([^/?]+)$/.exec(c.path);
  return `${c.method} ${match?.[1]} ${match?.[2]}`;
};

function echoFormula(call: ApiCall): FormulaDto {
  const id = /formulas\/([^/?]+)/.exec(call.path)![1];
  const body = call.body as ReturnType<typeof toFormulaUpsertRequest>;
  return {
    id,
    babyId: BABY_ID,
    ...body,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: body.updatedAt ?? SERVER_TIME,
  };
}

const echo: ApiHandler = (call) =>
  call.method === 'PUT' && call.path.includes('/formulas/') ? echoFormula(call) : undefined;

const bottleOf = (formula: { id: string; name: string }) => ({
  babyId: BABY_ID,
  typeId: FEEDING_TYPE.id,
  payload: {
    method: 'bottle',
    amount_ml: 120,
    bottle_feeding_type: 'formula',
    ...formulaMembers(formula),
  },
});

describe('pushing formulas', () => {
  it('pushes a formula created offline before the bottle that names it', async () => {
    const formula = await createFormula(db, BABY_ID, TERMS);
    const event = await createEvent(db, bottleOf(formula));
    const { engine, writes } = setup(echo);

    await engine.syncNow();

    expect(writes().map(label)).toEqual([`PUT formulas ${formula.id}`, `PUT events ${event.id}`]);
    expect(writes()[0].body).toMatchObject({ name: 'Nan 1', isCurrent: true, archived: false });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.formulas.get(formula.id)).toMatchObject({ updatedAt: SERVER_TIME });
  });

  it('still pushes the formula first when a later rename absorbed its create, and the bottle keeps the old name', async () => {
    const formula = await createFormula(db, BABY_ID, TERMS);
    const event = await createEvent(db, bottleOf(formula));
    await updateFormula(db, formula.id, { ...TERMS, name: 'Nan Supreme 1' });
    const { engine, writes } = setup(echo);

    await engine.syncNow();

    const sent = writes();
    expect(sent.map(label)).toEqual([`PUT formulas ${formula.id}`, `PUT events ${event.id}`]);
    expect((sent[0].body as { name: string }).name).toBe('Nan Supreme 1');
    expect((sent[1].body as { payload: { formula_name: string } }).payload.formula_name).toBe(
      'Nan 1',
    );
    expect((await db.events.get(event.id))?.payload).toMatchObject({ formula_name: 'Nan 1' });
  });

  it('retries a bottle rejected for its formula once the queued formula is pushed', async () => {
    const event = await createEvent(db, bottleOf({ id: 'f-late', name: 'Nan 1' }));
    let rejected = false;
    const { engine, writes } = setup((call) => {
      if (call.method === 'PUT' && call.path.includes('/events/') && !rejected) {
        rejected = true;
        void enqueueMutation(db, {
          babyId: BABY_ID,
          kind: 'upsert',
          entityType: 'formula',
          entityId: 'f-late',
          payload: toFormulaUpsertRequest({
            ...TERMS,
            id: 'f-late',
            babyId: BABY_ID,
            createdBy: null,
            createdAt: SERVER_TIME,
            updatedAt: SERVER_TIME,
          }),
          createdAt: SERVER_TIME,
        });
        throw new ApiError(400, {
          title: 'status 400',
          code: 'validation_failed',
          field: 'formula_id',
        });
      }
      return echo(call);
    });

    await engine.syncNow();

    expect(writes().map(label)).toEqual([
      `PUT events ${event.id}`,
      'PUT formulas f-late',
      `PUT events ${event.id}`,
    ]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('retries a formula the server refused as a concurrent change instead of dead-lettering it', async () => {
    const formula = await createFormula(db, BABY_ID, TERMS);
    let calls = 0;
    const { engine, writes } = setup((call) => {
      calls += 1;
      if (calls === 1) throw httpError(409, 'concurrent_modification');
      return echo(call);
    });

    await engine.syncNow();

    expect(await db.outbox.where('status').equals('dead').count()).toBe(0);
    expect(writes().map(label)).toEqual([`PUT formulas ${formula.id}`]);
    expect((await db.outbox.toArray())[0]?.attempts).toBe(1);
  });

  it('queues set-current and archive as full states with the edit time', async () => {
    const formula = await createFormula(db, BABY_ID, { ...TERMS, isCurrent: false });
    await setCurrentFormula(db, formula.id, { now: () => new Date('2026-10-20T10:00:00.000Z') });
    await setFormulaArchived(db, formula.id, true, {
      now: () => new Date('2026-10-20T11:00:00.000Z'),
    });

    const queued = (await db.outbox.orderBy('id').toArray()).map((m) => m.payload);

    expect(queued.at(1)).toMatchObject({
      isCurrent: true,
      archived: false,
      updatedAt: '2026-10-20T10:00:00.000Z',
    });
    expect(queued.at(2)).toMatchObject({
      isCurrent: false,
      archived: true,
      updatedAt: '2026-10-20T11:00:00.000Z',
    });
  });
});

describe('pulling formulas', () => {
  const dto = (id: string, overrides: Partial<FormulaDto> = {}): FormulaDto => ({
    id,
    babyId: BABY_ID,
    name: id,
    isCurrent: false,
    archived: false,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: SERVER_TIME,
    ...overrides,
  });

  it('brings the cleared copy of the previous current formula and moves the cursor', async () => {
    await db.formulas.put({
      id: 'old',
      babyId: BABY_ID,
      name: 'Nan 1',
      brand: null,
      stage: null,
      notes: null,
      startedOn: null,
      isCurrent: true,
      archived: false,
      createdBy: 'u1',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      clientUpdatedAt: '2026-10-01T10:00:00.000Z',
    });

    await mergeFormulaDelta(db, BABY_ID, [
      dto('old', { name: 'Nan 1', isCurrent: false, updatedAt: '2026-10-20T12:00:01.000Z' }),
      dto('new', { isCurrent: true, archived: true }),
    ]);

    expect(await db.formulas.get('old')).toMatchObject({ isCurrent: false });
    // An archived copy is never current on the device either.
    expect(await db.formulas.get('new')).toMatchObject({ isCurrent: false, archived: true });
    expect(await db.syncState.get([BABY_ID, 'formulas'])).toMatchObject({
      lastSyncedAt: '2026-10-20T12:00:01.000Z',
    });
  });

  it('keeps a formula with a queued local change and a newer local edit', async () => {
    const formula = await createFormula(db, BABY_ID, TERMS, {
      now: () => new Date('2026-10-20T13:00:00.000Z'),
    });

    await mergeFormulaDelta(db, BABY_ID, [dto(formula.id, { name: 'Server name' })]);

    expect((await db.formulas.get(formula.id))?.name).toBe('Nan 1');
  });
});
