import type { ApiClient } from '../api/apiClient';
import type { BabyEvent, EventType, Formula, Prescription } from '../db/models';
import { deviceTimeZone, utcOffsetMinutes } from '../predictions/usePredictions';
import {
  apiPaths,
  fromEventDto,
  fromEventTypeDto,
  fromFormulaDto,
  fromPrescriptionDto,
  type EventDto,
  type EventTypeDto,
  type FormulaDto,
  type MeasurementDto,
  type PrescriptionDto,
} from '../sync/contract';
import { parseScopes, type DoctorScope } from './scopes';

/*
 * The doctor's on-demand reads (docs/design/19-doctor-dashboard.md): a doctor may follow dozens of
 * patients, so her device never delta-syncs their event history. The dashboard asks the server
 * for exactly what a screen shows, filtered by the sections the family shared, and TanStack Query
 * keeps a short-lived cache. Every parser below tolerates a missing member.
 */

/* ---------- Wire shapes ---------- */

export interface PatientWeekDto {
  from: string;
  to: string;
  sleepMinutesPerDay: number | null;
  feedsPerDay: number | null;
  bottleMlPerDay: number | null;
  diapersPerDay: number | null;
}

export interface DoctorPatientDto {
  babyId: string;
  name: string;
  birthDate: string;
  doctorScopes?: string[] | null;
  lastEventAt?: string | null;
  week?: PatientWeekDto | null;
  latestWeight?: { weightKg: number; date: string } | null;
  pendingProposals?: number | null;
  vaccinesDue?: number | null;
  sharedNotes?: number | null;
}

export interface SleepDayDto {
  date: string;
  totalMinutes: number;
  nightMinutes: number;
  napMinutes: number;
  naps: number;
  longestMinutes: number;
}

export interface SleepSectionDto {
  days: SleepDayDto[];
  averageTotalMinutes: number | null;
  averageNightMinutes: number | null;
  averageNapMinutes: number | null;
  napsPerDay: number | null;
  daysCounted: number;
  longestStretchMinutes: number | null;
  longestStretchStartedAt: string | null;
  bedtimeMedian: string | null;
  wakeMedian: string | null;
}

export interface FeedingDayDto {
  date: string;
  feeds: number;
  bottleMl: number;
  breast: number;
  bottle: number;
  solid: number;
}

export interface FormulaUsageDto {
  formulaId: string | null;
  name: string;
  feeds: number;
  ml: number;
}

export interface FeedingSectionDto {
  days: FeedingDayDto[];
  feedsPerDay: number | null;
  averageIntervalMinutes: number | null;
  bottleMlPerDay: number | null;
  breastCount: number;
  bottleCount: number;
  solidCount: number;
  formulas: FormulaUsageDto[];
}

export interface DiaperDayDto {
  date: string;
  total: number;
  wet: number;
  dirty: number;
}

export interface DiaperSectionDto {
  days: DiaperDayDto[];
  perDay: number | null;
  wetPerDay: number | null;
  dirtyPerDay: number | null;
}

export interface DoseCountDto {
  medicationId: string | null;
  name: string;
  count: number;
  lastGivenAt: string;
}

export interface DueDoseDto {
  doseId: string;
  vaccineKey: string;
  vaccineNames: Record<string, string>;
  doseLabel: Record<string, string>;
  state: 'due' | 'overdue';
  dueOn: string;
}

export interface VaccinesSectionDto {
  given: number;
  due: number;
  overdue: number;
  upcoming: number;
  dueDoses: DueDoseDto[];
}

export interface ClinicalSummaryDto {
  babyId: string;
  from: string;
  to: string;
  today: string;
  timeZone: string | null;
  generatedAt: string;
  scopes?: string[];
  sleep?: SleepSectionDto | null;
  feeding?: FeedingSectionDto | null;
  diapers?: DiaperSectionDto | null;
  symptoms?: { items?: EventDto[] } | null;
  medications?: { doses?: DoseCountDto[]; activePrescriptions?: PrescriptionDto[] } | null;
  vaccines?: VaccinesSectionDto | null;
  growth?: { measurements?: MeasurementDto[] } | null;
  formulas?: { current?: FormulaDto | null; history?: FormulaDto[] } | null;
}

/* ---------- Client shapes ---------- */

export interface DoctorPatient {
  babyId: string;
  name: string;
  birthDate: string;
  scopes: DoctorScope[];
  lastEventAt: string | null;
  week: PatientWeekDto | null;
  latestWeight: { weightKg: number; date: string } | null;
  pendingProposals: number | null;
  vaccinesDue: number | null;
  sharedNotes: number | null;
}

export interface ClinicalSummary {
  babyId: string;
  from: string;
  to: string;
  today: string;
  generatedAt: string;
  scopes: DoctorScope[];
  sleep: SleepSectionDto | null;
  feeding: FeedingSectionDto | null;
  diapers: DiaperSectionDto | null;
  symptoms: { items: BabyEvent[] } | null;
  medications: { doses: DoseCountDto[]; activePrescriptions: Prescription[] } | null;
  vaccines: VaccinesSectionDto | null;
  growth: { measurements: MeasurementDto[] } | null;
  formulas: { current: Formula | null; history: Formula[] } | null;
}

const list = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);
const count = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function fromPatientDto(dto: DoctorPatientDto): DoctorPatient {
  return {
    babyId: dto.babyId,
    name: dto.name,
    birthDate: dto.birthDate,
    scopes: parseScopes(dto.doctorScopes),
    lastEventAt: dto.lastEventAt ?? null,
    week: dto.week ?? null,
    latestWeight: dto.latestWeight ?? null,
    pendingProposals: count(dto.pendingProposals),
    vaccinesDue: count(dto.vaccinesDue),
    sharedNotes: count(dto.sharedNotes),
  };
}

export function fromSummaryDto(dto: ClinicalSummaryDto): ClinicalSummary {
  return {
    babyId: dto.babyId,
    from: dto.from,
    to: dto.to,
    today: dto.today,
    generatedAt: dto.generatedAt,
    scopes: parseScopes(dto.scopes),
    sleep: dto.sleep ? { ...dto.sleep, days: list(dto.sleep.days) } : null,
    feeding: dto.feeding
      ? { ...dto.feeding, days: list(dto.feeding.days), formulas: list(dto.feeding.formulas) }
      : null,
    diapers: dto.diapers ? { ...dto.diapers, days: list(dto.diapers.days) } : null,
    symptoms: dto.symptoms ? { items: list(dto.symptoms.items).map(fromEventDto) } : null,
    medications: dto.medications
      ? {
          doses: list(dto.medications.doses),
          activePrescriptions: list(dto.medications.activePrescriptions).map(fromPrescriptionDto),
        }
      : null,
    vaccines: dto.vaccines ? { ...dto.vaccines, dueDoses: list(dto.vaccines.dueDoses) } : null,
    growth: dto.growth ? { measurements: list(dto.growth.measurements) } : null,
    formulas: dto.formulas
      ? {
          current: dto.formulas.current ? fromFormulaDto(dto.formulas.current) : null,
          history: list(dto.formulas.history).map(fromFormulaDto),
        }
      : null,
  };
}

/* ---------- Calls ---------- */

export async function fetchPatients(api: ApiClient, signal?: AbortSignal) {
  const path = apiPaths.doctorPatients(deviceTimeZone(), utcOffsetMinutes());
  const body = await api.request<DoctorPatientDto[]>(path, { signal });
  return list(body).map(fromPatientDto);
}

export async function fetchClinicalSummary(
  api: ApiClient,
  babyId: string,
  range: { from: string; to: string },
  signal?: AbortSignal,
): Promise<ClinicalSummary> {
  const path = apiPaths.clinicalSummary(babyId, range, deviceTimeZone(), utcOffsetMinutes());
  const body = await api.request<unknown>(path, { signal });
  const empty: ClinicalSummaryDto = {
    babyId,
    ...range,
    today: range.to,
    timeZone: null,
    generatedAt: new Date().toISOString(),
  };
  // An empty or unexpected answer is a summary without any section (never a crash).
  const usable = typeof body === 'object' && body !== null && !Array.isArray(body);
  return fromSummaryDto(usable ? { ...empty, ...(body as Partial<ClinicalSummaryDto>) } : empty);
}

/** The events overlapping `[from, to)` (one local day), oldest first. */
export async function fetchTimeline(
  api: ApiClient,
  babyId: string,
  from: Date,
  to: Date,
  signal?: AbortSignal,
): Promise<BabyEvent[]> {
  const path = apiPaths.timeline(babyId, from.toISOString(), to.toISOString());
  return list(await api.request<EventDto[]>(path, { signal })).map(fromEventDto);
}

export async function fetchEventTypes(
  api: ApiClient,
  babyId: string,
  signal?: AbortSignal,
): Promise<EventType[]> {
  return list(await api.request<EventTypeDto[]>(apiPaths.eventTypes(babyId), { signal })).map(
    fromEventTypeDto,
  );
}
