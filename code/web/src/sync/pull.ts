import { ApiError } from '../api/ApiError';
import { canSeeAppointments } from '../baby/permissions';
import type { BabyRoutineDb } from '../db/database';
import { saveLatestWeight } from '../db/bodyWeight';
import { cacheProducts } from '../db/catalogCache';
import { isProduct } from '../medications/catalogApi';
import {
  BABIES_LISTED_KEY,
  editTimeOf,
  prescriptionEditTime,
  type Appointment,
  type BabyEvent,
  type Formula,
  type Prescription,
  type Vaccination,
} from '../db/models';
import { pendingEntityIds, rejectedStopIds } from '../db/outbox';
import { clearBabyDeviceState, deleteBabyRows, purgeTables } from '../db/purge';
import {
  apiPaths,
  fromAppointmentDto,
  fromBabyDto,
  fromEventDto,
  fromEventTypeDto,
  fromFormulaDto,
  fromMedicationDto,
  fromPrescriptionDto,
  fromVaccinationDto,
  type AppointmentDto,
  type BabyDto,
  type EventDto,
  type EventsDeltaResponse,
  type EventTypeDto,
  type FormulaDto,
  type MedicationDto,
  type MeasurementDto,
  type PrescriptionDto,
  type VaccinationDto,
  NEXT_CURSOR_HEADER,
} from './contract';
import { pullNotes } from '../notes/noteSync';
import { syncCareProviders } from './careProviderSync';
import { pullNoteReads, pullProposals } from '../proposals/proposalSync';
import { classifyFailure, describeFailure } from './failures';
import { syncRequest, syncRequestWithMeta, type SyncContext } from './syncContext';

function get<T>(ctx: SyncContext, path: string) {
  return syncRequest<T>(ctx, path);
}

/**
 * Replaces the local list of babies the user belongs to. A baby that is no longer listed (the
 * user left or was removed) is purged from this device, outbox and cached state included.
 */
export async function refreshBabies(ctx: SyncContext): Promise<string[]> {
  const babies = ((await get<BabyDto[]>(ctx, apiPaths.babies())) ?? []).map(fromBabyDto);
  const { db } = ctx;
  const kept = new Set(babies.map((b) => b.id));
  const dropped: string[] = [];
  await db.transaction('rw', purgeTables(db), async () => {
    const known = (await db.babies.toCollection().primaryKeys()) as string[];
    dropped.push(...known.filter((id) => !kept.has(id)));
    await deleteBabyRows(db, dropped);
    await db.babies.bulkPut(babies);
    // The list is now known, even when empty: Home may offer "Create baby".
    await db.syncState.put({
      babyId: BABIES_LISTED_KEY,
      entity: 'babies',
      lastSyncedAt: new Date(ctx.now()).toISOString(),
    });
  });
  clearBabyDeviceState(dropped);
  return babies.map((b) => b.id);
}

/**
 * Replaces a baby's event types (custom + built-in templates) and medication catalog. Medications
 * with a queued local change are left alone until it is pushed, so an offline edit or delete is
 * not undone by a pull that runs before the push succeeded.
 */
export async function refreshCatalogs(ctx: SyncContext, babyId: string): Promise<void> {
  const [types, medications] = await Promise.all([
    get<EventTypeDto[]>(ctx, apiPaths.eventTypes(babyId)),
    get<MedicationDto[]>(ctx, apiPaths.medications(babyId)),
  ]);
  const { db } = ctx;
  await db.transaction('rw', db.eventTypes, db.medications, db.outbox, async () => {
    const pending = await pendingEntityIds(db, babyId);
    await db.eventTypes.where('babyId').equals(babyId).delete();
    await db.eventTypes.bulkPut((types ?? []).map(fromEventTypeDto));
    await db.medications
      .where('babyId')
      .equals(babyId)
      .filter((m) => !pending.has(m.id))
      .delete();
    await db.medications.bulkPut(
      (medications ?? []).filter((m) => !pending.has(m.id)).map(fromMedicationDto),
    );
  });
}

/** Newest raw `updatedAt` among `items` and the current cursor (never moves backwards). */
function newestCursor(items: EventDto[], current: string | undefined): string | undefined {
  let newest = current;
  for (const item of items) {
    if (!newest || Date.parse(item.updatedAt) > Date.parse(newest)) newest = item.updatedAt;
  }
  return newest;
}

/**
 * Whether a pulled copy replaces the local row: last-write-wins on the client edit clock
 * (`clientUpdatedAt ?? updatedAt` on both sides; the server's `updatedAt` is only the cursor
 * clock). A server soft delete is final (the server never undeletes), so it always wins.
 */
function remoteWins(remote: BabyEvent, local: BabyEvent | undefined): boolean {
  if (!local || remote.deletedAt) return true;
  return Date.parse(editTimeOf(remote)) >= Date.parse(editTimeOf(local));
}

/**
 * Merges a delta into the local store (see `remoteWins`), skipping events that still have a
 * pending local mutation (they win until pushed) and running copies of timers whose stop the
 * server rejected (the user fixes and re-sends the stop; a running copy would silently restart
 * them). The cursor (server `updatedAt`) is written in the same transaction, so it only advances
 * when the merge commits.
 */
export async function mergeEventDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: EventDto[],
): Promise<void> {
  await db.transaction('rw', db.events, db.outbox, db.syncState, async () => {
    const pending = await pendingEntityIds(db, babyId);
    const stopped = await rejectedStopIds(db, babyId);
    const resurrects = (dto: EventDto) =>
      stopped.has(dto.id) && dto.endedAt === null && !dto.deletedAt;
    const incoming = items
      .filter((dto) => !pending.has(dto.id) && !resurrects(dto))
      .map(fromEventDto);
    const locals = await db.events.bulkGet(incoming.map((e) => e.id));
    const winners = incoming.filter((e, i) => remoteWins(e, locals[i]));
    await db.events.bulkPut(winners);

    const cursor = await db.syncState.get([babyId, 'events']);
    const next = newestCursor(items, cursor?.lastSyncedAt);
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'events', lastSyncedAt: next });
    }
  });
}

/**
 * Re-pull window: rows whose transaction committed late can carry an `updatedAt` slightly older
 * than rows already received, so each pull starts this much before the stored cursor.
 */
export const PULL_OVERLAP_MS = 5_000;

export class RepeatedCursorError extends Error {
  constructor(cursor: string) {
    super(`Events delta paging returned the same cursor twice (${cursor}); stopped.`);
    this.name = 'RepeatedCursorError';
  }
}

function overlappedSince(lastSyncedAt: string | undefined): string | undefined {
  if (!lastSyncedAt) return undefined;
  const ms = Date.parse(lastSyncedAt);
  return Number.isNaN(ms) ? lastSyncedAt : new Date(ms - PULL_OVERLAP_MS).toISOString();
}

/**
 * Pulls the events delta from the stored cursor (minus the overlap) and follows `X-Next-Cursor`
 * pages until it is absent. Each page is merged in its own transaction, so the stored cursor only
 * advances with a committed page and an interrupted pull resumes where it stopped.
 */
export async function pullEvents(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'events']);
  const seen = new Set<string>();
  let path = apiPaths.eventsDelta(babyId, { since: overlappedSince(cursor?.lastSyncedAt) });
  for (;;) {
    const { data, headers } = await syncRequestWithMeta<EventsDeltaResponse>(ctx, path);
    await mergeEventDelta(ctx.db, babyId, data ?? []);
    const next = headers.get(NEXT_CURSOR_HEADER);
    if (!next) return;
    if (seen.has(next)) throw new RepeatedCursorError(next);
    seen.add(next);
    path = apiPaths.eventsDelta(babyId, { after: next });
  }
}

/**
 * Merges pulled prescriptions like events: a copy with a queued local change is skipped until that
 * is pushed, a server soft delete is final, otherwise the newer client edit time wins. The delta
 * cursor moves with the same transaction.
 */
export async function mergePrescriptionDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: PrescriptionDto[],
): Promise<void> {
  await db.transaction('rw', db.prescriptions, db.outbox, db.syncState, async () => {
    const pending = await pendingEntityIds(db, babyId);
    const incoming = items.filter((dto) => !pending.has(dto.id)).map(fromPrescriptionDto);
    const locals = await db.prescriptions.bulkGet(incoming.map((p) => p.id));
    const wins = (remote: Prescription, local: Prescription | undefined) =>
      !local ||
      remote.deletedAt !== null ||
      Date.parse(prescriptionEditTime(remote)) >= Date.parse(prescriptionEditTime(local));
    await db.prescriptions.bulkPut(incoming.filter((p, i) => wins(p, locals[i])));

    const cursor = await db.syncState.get([babyId, 'prescriptions']);
    let next = cursor?.lastSyncedAt;
    for (const item of items) {
      if (!next || Date.parse(item.updatedAt) > Date.parse(next)) next = item.updatedAt;
    }
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'prescriptions', lastSyncedAt: next });
    }
  });
}

/** Pulls the prescriptions changed since the stored cursor (minus the overlap), deleted included. */
export async function pullPrescriptions(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'prescriptions']);
  const since = overlappedSince(cursor?.lastSyncedAt);
  const items = await get<PrescriptionDto[]>(ctx, apiPaths.prescriptions(babyId, since));
  await mergePrescriptionDelta(ctx.db, babyId, items ?? []);
}

/**
 * Merges pulled formulas like prescriptions: a copy with a queued local change is skipped until
 * that is pushed, otherwise the newer client edit time wins (formulas are never deleted). The
 * server's clearing of the previous current formula arrives here too. The cursor moves in the
 * same transaction.
 */
export async function mergeFormulaDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: FormulaDto[],
): Promise<void> {
  await db.transaction('rw', db.formulas, db.outbox, db.syncState, async () => {
    const pending = await pendingEntityIds(db, babyId);
    const incoming = items.filter((dto) => !pending.has(dto.id)).map(fromFormulaDto);
    const locals = await db.formulas.bulkGet(incoming.map((f) => f.id));
    const editTime = (f: Formula) => Date.parse(f.clientUpdatedAt ?? f.updatedAt);
    const wins = (remote: Formula, local: Formula | undefined) =>
      !local || editTime(remote) >= editTime(local);
    await db.formulas.bulkPut(incoming.filter((f, i) => wins(f, locals[i])));

    const cursor = await db.syncState.get([babyId, 'formulas']);
    let next = cursor?.lastSyncedAt;
    for (const item of items) {
      if (!next || Date.parse(item.updatedAt) > Date.parse(next)) next = item.updatedAt;
    }
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'formulas', lastSyncedAt: next });
    }
  });
}

/** Pulls the formulas changed since the stored cursor (minus the overlap), archived included. */
export async function pullFormulas(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'formulas']);
  const since = overlappedSince(cursor?.lastSyncedAt);
  const items = await get<FormulaDto[]>(ctx, apiPaths.formulas(babyId, since));
  await mergeFormulaDelta(ctx.db, babyId, items ?? []);
}

/**
 * Merges pulled appointments like formulas: a copy with a queued local change is skipped until it
 * is pushed, otherwise the newer client edit time wins (appointments are never deleted: a
 * cancelled one arrives like any edit). The cursor moves in the same transaction.
 */
export async function mergeAppointmentDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: AppointmentDto[],
): Promise<void> {
  await db.transaction('rw', db.appointments, db.outbox, db.syncState, async () => {
    const pending = await pendingEntityIds(db, babyId);
    const incoming = items.filter((dto) => !pending.has(dto.id)).map(fromAppointmentDto);
    const locals = await db.appointments.bulkGet(incoming.map((a) => a.id));
    const editTime = (a: Appointment) => Date.parse(a.clientUpdatedAt ?? a.updatedAt);
    const wins = (remote: Appointment, local: Appointment | undefined) =>
      !local || editTime(remote) >= editTime(local);
    await db.appointments.bulkPut(incoming.filter((a, i) => wins(a, locals[i])));

    const cursor = await db.syncState.get([babyId, 'appointments']);
    let next = cursor?.lastSyncedAt;
    for (const item of items) {
      if (!next || Date.parse(item.updatedAt) > Date.parse(next)) next = item.updatedAt;
    }
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'appointments', lastSyncedAt: next });
    }
  });
}

/** Pulls the appointments changed since the stored cursor (minus the overlap), cancelled included. */
export async function pullAppointments(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'appointments']);
  const since = overlappedSince(cursor?.lastSyncedAt);
  const items = await get<AppointmentDto[]>(ctx, apiPaths.appointments(babyId, since));
  await mergeAppointmentDelta(ctx.db, babyId, items ?? []);
}

/**
 * Removes a baby's appointments and their cursor from this device. Run for a Doctor on every pull:
 * she never holds the family's appointments (docs/design/16-doctor-access.md, "Doctor read
 * audit"), so copies stored while the user had a family role are purged as soon as the role is
 * Doctor, and a later change back to a family role pulls them all again from scratch.
 */
export async function dropAppointments(db: BabyRoutineDb, babyId: string): Promise<void> {
  await db.transaction('rw', db.appointments, db.syncState, async () => {
    await db.appointments.where('babyId').equals(babyId).delete();
    await db.syncState.delete([babyId, 'appointments']);
  });
}

/** Pulls the appointments for the family roles; for a Doctor, never asks and drops local copies. */
export async function syncAppointments(ctx: SyncContext, babyId: string): Promise<void> {
  const baby = await ctx.db.babies.get(babyId);
  if (baby && !canSeeAppointments(baby)) {
    await dropAppointments(ctx.db, babyId);
    return;
  }
  await pullAppointments(ctx, babyId);
}

/**
 * Merges pulled vaccinations like prescriptions: a copy with a queued local change is skipped until
 * it is pushed, a server soft delete is final, otherwise the newer client edit time wins. The cursor
 * moves in the same transaction.
 */
export async function mergeVaccinationDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: VaccinationDto[],
): Promise<void> {
  await db.transaction('rw', db.vaccinations, db.outbox, db.syncState, async () => {
    const pending = await pendingEntityIds(db, babyId);
    const incoming = items.filter((dto) => !pending.has(dto.id)).map(fromVaccinationDto);
    const locals = await db.vaccinations.bulkGet(incoming.map((v) => v.id));
    const editTime = (v: Vaccination) => Date.parse(v.clientUpdatedAt ?? v.updatedAt);
    const wins = (remote: Vaccination, local: Vaccination | undefined) =>
      !local || remote.deletedAt !== null || editTime(remote) >= editTime(local);
    await db.vaccinations.bulkPut(incoming.filter((v, i) => wins(v, locals[i])));

    const cursor = await db.syncState.get([babyId, 'vaccinations']);
    let next = cursor?.lastSyncedAt;
    for (const item of items) {
      if (!next || Date.parse(item.updatedAt) > Date.parse(next)) next = item.updatedAt;
    }
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'vaccinations', lastSyncedAt: next });
    }
  });
}

/** Pulls the vaccinations changed since the stored cursor (minus the overlap), deleted included. */
export async function pullVaccinations(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'vaccinations']);
  const since = overlappedSince(cursor?.lastSyncedAt);
  let items: VaccinationDto[] | undefined;
  try {
    items = await get<VaccinationDto[]>(ctx, apiPaths.vaccinations(babyId, since));
  } catch (error) {
    // A server that does not have vaccinations yet (the web app updated first): nothing to pull,
    // and the events that follow in this run must not be held back.
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
  await mergeVaccinationDelta(ctx.db, babyId, Array.isArray(items) ? items : []);
}

/**
 * Keeps the latest weight on the device (growth is online-only) for per-kg suggestions. Best
 * effort: a failure leaves the stored weight as it was.
 */
export async function refreshLatestWeight(ctx: SyncContext, babyId: string): Promise<void> {
  try {
    const list = await get<MeasurementDto[]>(ctx, apiPaths.measurements(babyId));
    if (Array.isArray(list)) await saveLatestWeight(ctx.db, babyId, list);
  } catch {
    // Offline or not allowed: keep what is stored.
  }
}

/** Most catalog products fetched per baby and pull (the rest follow on later pulls). */
export const LINKED_PRODUCTS_PER_PULL = 20;

/**
 * Keeps the shared-catalog products the family's medications link to on this device, so the
 * product details and the offline search work on every device of the family. Only linked products
 * missing from the device cache are fetched (`GET /catalog/products/{id}`): the shared catalog
 * itself (thousands of official ANVISA products) is never pulled. Best effort: a failure leaves the
 * cache as it was.
 */
export async function refreshLinkedProducts(ctx: SyncContext, babyId: string): Promise<void> {
  const { db } = ctx;
  const linked = new Set(
    (await db.medications.where('babyId').equals(babyId).toArray())
      .map((m) => m.productId)
      .filter((id): id is string => !!id),
  );
  const cached = new Set((await db.catalogProducts.bulkGet([...linked])).map((row) => row?.id));
  const missing = [...linked].filter((id) => !cached.has(id)).slice(0, LINKED_PRODUCTS_PER_PULL);
  for (const productId of missing) {
    try {
      const product = await get<unknown>(ctx, apiPaths.catalogProduct(productId));
      if (isProduct(product)) await cacheProducts(db, [product]);
    } catch {
      // Offline or unknown product: keep what is cached.
    }
  }
}

/**
 * The doctor suggestions of one baby (docs/design/16-doctor-access.md section 10): the proposals
 * for the Doctor (her own) and the Owners and Parents (all of them), the user's own note reads for
 * the Owners and Parents (the recommendations inbox). Caregivers and Viewers have neither.
 */
export async function pullSuggestions(ctx: SyncContext, babyId: string): Promise<void> {
  const role = (await ctx.db.babies.get(babyId))?.role;
  const decides = role === 'Owner' || role === 'Parent';
  if (decides || role === 'Doctor') await pullProposals(ctx, babyId);
  if (decides) await pullNoteReads(ctx, babyId);
}

/**
 * Refreshes babies, then each baby's catalogs and events. A permanent (4xx) failure or a paging
 * loop for one baby is collected and the others continue; network/401/transient failures are
 * rethrown.
 */
export async function pullAll(ctx: SyncContext): Promise<string[]> {
  const errors: string[] = [];
  for (const babyId of await refreshBabies(ctx)) {
    try {
      await refreshCatalogs(ctx, babyId);
      await refreshLinkedProducts(ctx, babyId);
      await pullPrescriptions(ctx, babyId);
      await pullFormulas(ctx, babyId);
      await syncAppointments(ctx, babyId);
      await syncCareProviders(ctx, babyId);
      await pullVaccinations(ctx, babyId);
      await pullNotes(ctx, babyId);
      await pullEvents(ctx, babyId);
      await refreshLatestWeight(ctx, babyId);
      await pullSuggestions(ctx, babyId);
    } catch (error) {
      const perBaby =
        error instanceof RepeatedCursorError || classifyFailure(error) === 'permanent';
      if (!perBaby) throw error;
      errors.push(describeFailure(error));
    }
  }
  return errors;
}
