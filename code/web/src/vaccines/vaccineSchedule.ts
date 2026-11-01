import { getOwn } from '../util/ownProperty';

/*
 * The vaccine schedule as served by `GET /api/v1/vaccine-schedule` (the API's
 * code/api/data/vaccine-schedule.br.json, schema v2; docs/design/18-vaccines.md section 2). Facts
 * only: the app shows what is due according to this schedule and never tells a family to give or
 * skip a vaccine. Ages are whole days from the birth date.
 */

/** Language codes the schedule carries text in. */
export type ScheduleLanguage = 'en' | 'pt-BR';

export type LocalizedText = Partial<Record<ScheduleLanguage, string>> & Record<string, string>;

export type LocalizedList = Partial<Record<ScheduleLanguage, string[]>> & Record<string, string[]>;

/** Where a dose is offered: the public network (SUS, PNI) or private clinics only. */
export type VaccineNetwork = 'public' | 'private';

export interface VaccineSource {
  id: string;
  name: string;
  edition: string;
  url: string;
  retrievedOn: string;
  network: string;
  licenceNote?: string;
}

export interface VaccineDefinition {
  key: string;
  names: LocalizedText;
  protectsAgainst: LocalizedList;
  network: string;
}

export interface DoseRecurrence {
  everyDays: number;
  startAgeDays: number;
}

export interface ScheduledDose {
  vaccineKey: string;
  doseId: string;
  label: LocalizedText;
  recommendedAgeDays: number;
  earliestAgeDays: number;
  latestAgeDays: number | null;
  minIntervalDaysFromPrevious: number | null;
  sources: string[];
  network: VaccineNetwork;
  notes: LocalizedText;
  alternativeGroup: string | null;
  needsReview: boolean;
  needsReviewReason: string | null;
  /** The doses `minIntervalDaysFromPrevious` counts from (the latest given one). */
  previousDoseIds: string[];
  /** Other doses a combined product also satisfies. */
  covers: string[];
  recurrence: DoseRecurrence | null;
  condition: string | null;
  /** A combined product the family can record; never a slot of its own. */
  recordOnly: boolean;
}

export interface VaccineSchedule {
  schemaVersion: number;
  profile: string;
  generatedOn: string;
  sources: VaccineSource[];
  vaccines: VaccineDefinition[];
  doses: ScheduledDose[];
}

/** The schema version this code reads. */
export const SUPPORTED_SCHEMA_VERSION = 2;

/** Applies unless the mother got the RSV vaccine in pregnancy. */
export const RSV_MATERNAL_CONDITION = 'rsv-maternal-vaccination-unknown-or-no';

/** The text in `language`, else English, else any. */
export function localized(text: LocalizedText | undefined, language: string): string {
  if (!text) return '';
  return getOwn(text, language) ?? getOwn(text, 'en') ?? Object.values(text)[0] ?? '';
}

/** The slot a dose fills: its alternative group, or the dose itself. */
export function slotOf(dose: ScheduledDose): string {
  return dose.alternativeGroup ?? dose.doseId;
}
