import type { BabyRoutineDb } from '../db/database';
import { createEvent, type CommandOptions } from '../db/eventCommands';
import type {
  BabyEvent,
  EventPayload,
  EventType,
  Medication,
  MedicationEventPayload,
} from '../db/models';
import {
  readLastUsed,
  readLastUsedMedications,
  recordLastUsed,
  recordLastUsedMedications,
} from '../events/lastUsedValues';
import { validatePayload } from '../events/payloadRules';
import { PresetNotRunnableError, type SheetPrefill, type UndoToken } from '../presets/actions';
import { presetStatus, type PresetStatus } from '../presets/status';
import type { MedicationStatus } from '../medications/statusCalculator';
import { getOwn } from '../util/ownProperty';
import {
  MINUTE_MS,
  payloadNumber,
  payloadString,
  payloadValue,
  pastLiveEvents,
  typeForKey,
} from './eventFacts';
import { isNursingEvent, startNursing, suggestedStartSide, type BreastSide } from './nursing';

/*
 * "Last and log" tiles and their choice trays (docs/design/01-ux-strategy.md "A. Now dashboard",
 * 03-interaction.md section 2): a tile shows when the thing last happened and opens a short tray
 * whose one tap logs. Defaults come from the newest event first (shared by every caregiver through
 * sync), then from this device's remembered values (events/lastUsedValues.ts).
 */

export type TileId = 'feed' | 'diaper' | 'meds' | 'more';

export type TileDetail =
  | {
      kind: 'feed';
      method: string | null;
      amountMl: number | null;
      bottleContent: string | null;
      side: string | null;
    }
  | { kind: 'diaper'; content: string | null }
  | {
      kind: 'meds';
      names: string[];
      /**
       * When the next dose is allowed. Always `null` for now: medications have no minimum interval
       * yet (SYNTHESIS.md wave 6, "medicine intervals (API: min interval per medication)").
       */
      nextAllowedAt: string | null;
    };

export interface QuickTile {
  id: TileId;
  /** The tile's event type; `null` for More. */
  typeId: string | null;
  /** `running` (a nursing session), the last start, or not tracked today; `null` for More. */
  status: PresetStatus | null;
  /** The newest event of the tile (detail line), if any. */
  last: BabyEvent | null;
  /** The tile's running timer (nursing), if any. */
  running: BabyEvent | null;
  detail: TileDetail | null;
  /** More: the other trackable types (bath, pump, custom types...). */
  moreTypeIds?: string[];
}

/** Type keys with their own place on Now (tiles or the sleep toggle). */
const NOW_KEYS = new Set(['feeding', 'diaper', 'medication', 'sleep']);

function newestOf(events: readonly BabyEvent[], typeId: string): BabyEvent | null {
  let newest: BabyEvent | null = null;
  for (const e of events) {
    if (e.typeId === typeId && (!newest || e.startedAt > newest.startedAt)) newest = e;
  }
  return newest;
}

function medicationNames(event: BabyEvent | null): string[] {
  const list = event ? payloadValue(event, 'medications') : undefined;
  if (!Array.isArray(list)) return [];
  return list
    .map((m: unknown) =>
      typeof m === 'object' && m !== null
        ? getOwn(m as Record<string, unknown>, 'name')
        : undefined,
    )
    .filter((name): name is string => typeof name === 'string');
}

function detailOf(id: TileId, last: BabyEvent | null): TileDetail | null {
  if (id === 'feed') {
    return {
      kind: 'feed',
      method: last ? (payloadString(last, 'method') ?? null) : null,
      amountMl: last ? (payloadNumber(last, 'amount_ml') ?? null) : null,
      bottleContent: last ? (payloadString(last, 'bottle_feeding_type') ?? null) : null,
      side: last ? (payloadString(last, 'side') ?? null) : null,
    };
  }
  if (id === 'diaper') {
    return { kind: 'diaper', content: last ? (payloadString(last, 'content') ?? null) : null };
  }
  if (id === 'meds') return { kind: 'meds', names: medicationNames(last), nextAllowedAt: null };
  return null;
}

const TILE_KEYS: [TileId, string][] = [
  ['feed', 'feeding'],
  ['diaper', 'diaper'],
  ['meds', 'medication'],
];

/**
 * The tiles of Now, in order Feed, Diaper, Meds, More. A tile whose built-in type is missing is
 * left out (More is always there). `events`: the baby's recent and running events, any order.
 */
export function lastAndLogTiles(
  types: readonly EventType[],
  events: readonly BabyEvent[],
  now: Date,
): QuickTile[] {
  const past = pastLiveEvents(events, now);
  const tiles: QuickTile[] = [];
  for (const [id, key] of TILE_KEYS) {
    const type = typeForKey(types, key);
    if (!type) continue;
    const mode = id === 'feed' ? 'timer' : 'instant';
    const status = presetStatus({ typeId: type.id, payloadDefaults: {}, mode }, past, now);
    const last = newestOf(past, type.id);
    const running =
      id === 'feed'
        ? (past.find((e) => e.endedAt === null && isNursingEvent(e, type.id)) ?? null)
        : null;
    tiles.push({ id, typeId: type.id, status, last, running, detail: detailOf(id, last) });
  }
  const moreTypeIds = types.filter((t) => !NOW_KEYS.has(t.key)).map((t) => t.id);
  tiles.push({
    id: 'more',
    typeId: null,
    status: null,
    last: null,
    running: null,
    detail: null,
    moreTypeIds,
  });
  return tiles;
}

/* ---------- trays ---------- */

export const DEFAULT_BOTTLE_AMOUNTS: readonly number[] = [60, 90, 120, 150];
const DEFAULT_BOTTLE_AMOUNT = 90;
const CHIP_COUNT = 4;

function fieldOf(type: EventType, key: string) {
  return type.fields.find((f) => f.key === key);
}

function inFieldRange(type: EventType, key: string, value: number): boolean {
  const field = fieldOf(type, key);
  if (!field) return true;
  return (field.min === null || value >= field.min) && (field.max === null || value <= field.max);
}

export interface BottleTray {
  /** Amount chips (ml), ascending: recent amounts of this baby topped up with the defaults. */
  amounts: number[];
  /** Pre-selected amount: the last bottle, else the remembered one, else 90 ml. */
  amountMl: number;
  /** Pre-selected content (`formula` / `breast_milk`), when known. */
  content: string | null;
  /** The content options of the type. */
  contents: string[];
  /** "Same as last time": the newest bottle. */
  same: { amountMl: number; content: string | null; at: string } | null;
}

export interface FeedTray {
  typeId: string;
  /** Method of the newest feed (the tray opens on it). */
  lastMethod: string | null;
  bottle: BottleTray;
  /** Nursing: the side to start on and the running session, if any. */
  breast: {
    side: BreastSide;
    lastSide: BreastSide | null;
    lastAt: string | null;
    runningId: string | null;
  };
  /** Solid food opens the event sheet prefilled. */
  solid: SheetPrefill;
}

function bottleTray(babyId: string, type: EventType, feeds: BabyEvent[]): BottleTray {
  const bottles = feeds
    .filter(
      (e) => payloadString(e, 'method') === 'bottle' && payloadNumber(e, 'amount_ml') !== undefined,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const remembered = readLastUsed(babyId, type.id);
  const rememberedAmount = getOwn(remembered, 'amount_ml');
  const rememberedContent = getOwn(remembered, 'bottle_feeding_type');
  const last = bottles[0];
  const lastAmount = last ? payloadNumber(last, 'amount_ml') : undefined;
  const lastContent = last ? (payloadString(last, 'bottle_feeding_type') ?? null) : null;

  const recent = [
    ...bottles.map((e) => payloadNumber(e, 'amount_ml') as number),
    ...(typeof rememberedAmount === 'number' ? [rememberedAmount] : []),
  ].filter((a) => inFieldRange(type, 'amount_ml', a));
  const amounts: number[] = [];
  for (const amount of [...recent, ...DEFAULT_BOTTLE_AMOUNTS]) {
    if (amounts.length < CHIP_COUNT && !amounts.includes(amount)) amounts.push(amount);
  }
  const contents = fieldOf(type, 'bottle_feeding_type')?.options ?? [];
  const content = lastContent ?? (typeof rememberedContent === 'string' ? rememberedContent : null);
  return {
    amounts: amounts.sort((a, b) => a - b),
    amountMl:
      lastAmount ??
      (typeof rememberedAmount === 'number' ? rememberedAmount : DEFAULT_BOTTLE_AMOUNT),
    content: content !== null && contents.includes(content) ? content : null,
    contents,
    same:
      last && lastAmount !== undefined
        ? { amountMl: lastAmount, content: lastContent, at: last.startedAt }
        : null,
  };
}

/** The Feed tray, or `null` without the feeding type. */
export function feedTrayOptions(
  babyId: string,
  types: readonly EventType[],
  events: readonly BabyEvent[],
  now: Date,
): FeedTray | null {
  const type = typeForKey(types, 'feeding');
  if (!type) return null;
  const feeds = pastLiveEvents(events, now).filter((e) => e.typeId === type.id);
  const newest = feeds.reduce<BabyEvent | null>(
    (n, e) => (!n || e.startedAt > n.startedAt ? e : n),
    null,
  );
  const suggestion = suggestedStartSide(feeds, type.id);
  const running = feeds.find((e) => e.endedAt === null && isNursingEvent(e, type.id));
  const startedAt = now.toISOString();
  return {
    typeId: type.id,
    lastMethod: newest ? (payloadString(newest, 'method') ?? null) : null,
    bottle: bottleTray(babyId, type, feeds),
    breast: { ...suggestion, runningId: running?.id ?? null },
    solid: { typeId: type.id, startedAt, endedAt: startedAt, payload: { method: 'solid' } },
  };
}

export interface DiaperTray {
  typeId: string;
  /** The content options as the type defines them (`WET`, `DIRTY`, `MIXED`); never pre-selected. */
  options: string[];
}

export function diaperTray(types: readonly EventType[]): DiaperTray | null {
  const type = typeForKey(types, 'diaper');
  if (!type) return null;
  return { typeId: type.id, options: fieldOf(type, 'content')?.options ?? [] };
}

export type MedicationEntry = MedicationEventPayload['medications'][number];

/** An active prescription with its medication and computed state, as the Meds tray lists it. */
export interface TrayPrescription {
  status: MedicationStatus;
  medication: Medication;
}

export interface MedsTray {
  typeId: string;
  /** Active prescriptions, oldest course first, each with its state (offline calculator). */
  prescriptions: TrayPrescription[];
  /** The catalog without an active prescription, usual first (as `medicationsFor` sorts it). */
  usual: Medication[];
  others: Medication[];
  /** Ids this device logged last time that are still in the catalog. */
  lastUsedIds: string[];
  /** "Same as last time": the newest medication event's entries (doses as given then). */
  same: { medications: MedicationEntry[]; at: string } | null;
}

function medicationEntries(event: BabyEvent): MedicationEntry[] {
  const list = payloadValue(event, 'medications');
  if (!Array.isArray(list)) return [];
  return list.filter(
    (m: unknown): m is MedicationEntry =>
      typeof m === 'object' &&
      m !== null &&
      typeof getOwn(m as Record<string, unknown>, 'medicationId') === 'string' &&
      typeof getOwn(m as Record<string, unknown>, 'name') === 'string',
  );
}

export function medsTray(
  babyId: string,
  types: readonly EventType[],
  medications: readonly Medication[],
  events: readonly BabyEvent[],
  now: Date,
  statuses: readonly MedicationStatus[] = [],
): MedsTray | null {
  const type = typeForKey(types, 'medication');
  if (!type) return null;
  const prescriptions = statuses.flatMap((status) => {
    const medication = medications.find((m) => m.id === status.prescription.medicationId);
    return medication ? [{ status, medication }] : [];
  });
  const prescribed = new Set(prescriptions.map((p) => p.medication.id));
  const free = medications.filter((m) => !prescribed.has(m.id));
  const last = newestOf(pastLiveEvents(events, now), type.id);
  // A dose given under a prescription is logged from its own card (confirm step, interval check).
  const entries = (last ? medicationEntries(last) : []).filter(
    (m) => m.prescriptionId === undefined,
  );
  const known = new Set(medications.map((m) => m.id));
  return {
    typeId: type.id,
    prescriptions,
    usual: free.filter((m) => m.isUsual),
    others: free.filter((m) => !m.isUsual),
    lastUsedIds: readLastUsedMedications(babyId).filter((id) => known.has(id)),
    same: last && entries.length > 0 ? { medications: entries, at: last.startedAt } : null,
  };
}

/** Entries of the selected catalog medications, in catalog order, each with its default dose. */
export function medicationPayloadEntries(
  selectedIds: readonly string[],
  medications: readonly Medication[],
): MedicationEntry[] {
  return medications
    .filter((m) => selectedIds.includes(m.id))
    .map((m) => ({
      medicationId: m.id,
      name: m.name,
      ...(m.defaultDosage ? { dose: { ...m.defaultDosage } } : {}),
    }));
}

export interface BellyPainTray {
  typeId: string;
  /** Intensities offered (the field's min..max, default 1-5). */
  intensities: number[];
}

export function bellyPainTray(types: readonly EventType[]): BellyPainTray | null {
  const type = typeForKey(types, 'belly_pain');
  if (!type) return null;
  const field = fieldOf(type, 'intensity');
  const min = Math.ceil(field?.min ?? 1);
  const max = Math.floor(field?.max ?? 5);
  const intensities = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
  return { typeId: type.id, intensities };
}

/* ---------- committing a tray choice ---------- */

export type TrayChoice =
  | { kind: 'bottle'; amountMl: number; content?: string | null }
  | { kind: 'diaper'; content: string }
  | { kind: 'medication'; medications: MedicationEntry[] }
  | { kind: 'belly_pain'; intensity: number }
  /** Starts a nursing session (see nursing.ts). */
  | { kind: 'breast'; side?: BreastSide };

export interface TrayContext {
  babyId: string;
  types: readonly EventType[];
  /** The tray's "When" chip: log this many minutes before the tap (default 0). */
  minutesAgo?: number;
  /** `options.now` is the tap moment. */
  options?: CommandOptions;
}

/** The choice would be rejected by the server (or logs nothing): nothing was written. */
export class TrayChoiceInvalidError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Invalid tray choice: ${fields.join(', ') || 'nothing selected'}.`);
    this.name = 'TrayChoiceInvalidError';
    this.fields = fields;
  }
}

const TYPE_KEY: Record<Exclude<TrayChoice['kind'], 'breast'>, string> = {
  bottle: 'feeding',
  diaper: 'diaper',
  medication: 'medication',
  belly_pain: 'belly_pain',
};

function payloadOf(choice: Exclude<TrayChoice, { kind: 'breast' }>): EventPayload {
  switch (choice.kind) {
    case 'bottle':
      return {
        method: 'bottle',
        amount_ml: choice.amountMl,
        ...(choice.content ? { bottle_feeding_type: choice.content } : {}),
      };
    case 'diaper':
      return { content: choice.content };
    case 'medication':
      return { medications: choice.medications } satisfies MedicationEventPayload;
    case 'belly_pain':
      return { intensity: choice.intensity };
  }
}

/**
 * Logs a tray choice as one instant event (a bottle is a zero-length feed) at the tap moment minus
 * `minutesAgo`, checked with the server's payload rules first, and remembers the values. Breast
 * starts a nursing session instead. Returns the token `undoPreset` reverts; its `at` is the tap
 * moment and `shiftMinutes` the "When" chip, so the toast's chips continue from it.
 */
export async function runTrayChoice(
  db: BabyRoutineDb,
  choice: TrayChoice,
  ctx: TrayContext,
): Promise<UndoToken> {
  const tap = ctx.options?.now?.() ?? new Date();
  const minutesAgo = Math.max(0, ctx.minutesAgo ?? 0);
  const when = new Date(tap.getTime() - minutesAgo * MINUTE_MS);
  const options: CommandOptions = { ...ctx.options, now: () => tap };
  if (choice.kind === 'breast') {
    return startNursing(db, {
      babyId: ctx.babyId,
      types: ctx.types,
      options: { ...ctx.options, now: () => when },
      ...(choice.side ? { side: choice.side } : {}),
    });
  }

  const type = typeForKey(ctx.types, TYPE_KEY[choice.kind]);
  if (!type) throw new PresetNotRunnableError(choice.kind);
  const payload = payloadOf(choice);
  const problems = validatePayload(type, payload, true).map((p) => p.field);
  if (problems.length > 0) throw new TrayChoiceInvalidError(problems);
  if (choice.kind === 'medication' && choice.medications.length === 0) {
    throw new TrayChoiceInvalidError([]);
  }

  const iso = when.toISOString();
  const created = await createEvent(
    db,
    { babyId: ctx.babyId, typeId: type.id, startedAt: iso, endedAt: iso, payload },
    options,
  );
  recordLastUsed(ctx.babyId, type, payload);
  if (choice.kind === 'medication') {
    recordLastUsedMedications(
      ctx.babyId,
      choice.medications.map((m) => m.medicationId),
    );
  }
  return {
    babyId: ctx.babyId,
    createdIds: [created.id],
    stopped: [],
    at: tap.toISOString(),
    shiftMinutes: minutesAgo,
  };
}
