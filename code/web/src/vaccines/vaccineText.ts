import type { TFunction } from 'i18next';
import type { Vaccination } from '../db/models';
import { formatDate, formatList } from '../i18n/format';
import { ageBucketOf, type AgeBucket, type DoseView, type StatusDescriptor } from './vaccineModel';
import {
  localized,
  type ScheduledDose,
  type VaccineDefinition,
  type VaccineSchedule,
} from './vaccineSchedule';
import { getOwn } from '../util/ownProperty';

/*
 * The words of the vaccines page: names and dose labels from the schedule in the UI language, the
 * age headings, the status lines and the history entries. The schedule is server data: names and
 * ids are looked up as own properties only, and an unknown key reads as its own words.
 */

export function vaccineOf(
  schedule: VaccineSchedule | null | undefined,
  key: string | null,
): VaccineDefinition | undefined {
  return key === null ? undefined : schedule?.vaccines.find((vaccine) => vaccine.key === key);
}

/** `meningo-acwy` -> `Meningo acwy`: a readable name for a vaccine the schedule no longer lists. */
function humanized(key: string): string {
  const spaced = key.replaceAll('-', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The vaccine's name in `language`; the key in words when the schedule has no such vaccine. */
export function vaccineName(
  schedule: VaccineSchedule | null | undefined,
  key: string,
  language: string,
): string {
  const vaccine = vaccineOf(schedule, key);
  return vaccine ? localized(vaccine.names, language) || humanized(key) : humanized(key);
}

export function doseLabelOf(dose: ScheduledDose, language: string): string {
  return localized(dose.label, language) || dose.doseId;
}

/** "diphtheria, tetanus and pertussis" in `language`; `null` when the schedule lists nothing. */
export function protectsLine(
  t: TFunction,
  vaccine: VaccineDefinition | undefined,
  language: string,
): string | null {
  const list = vaccine
    ? (getOwn(vaccine.protectsAgainst, language) ?? vaccine.protectsAgainst.en)
    : [];
  return list && list.length > 0 ? t('vaccines.dose.protects', { list: formatList(list) }) : null;
}

/** "At birth", "2 months", "4 years, 3 months": the heading of a group of doses. */
export function ageLabel(t: TFunction, bucket: AgeBucket): string {
  if (bucket.kind === 'birth') return t('vaccines.age.birth');
  if (bucket.kind === 'months') return t('age.month', { count: bucket.months });
  const years = t('age.year', { count: bucket.years });
  return bucket.months === 0
    ? years
    : t('age.join', { first: years, second: t('age.month', { count: bucket.months }) });
}

/** "Recommended at 2 months" / "Recommended at birth". */
export function recommendedLine(t: TFunction, days: number): string {
  const bucket = ageBucketOf(days);
  return bucket.kind === 'birth'
    ? t('vaccines.dose.recommendedAtBirth')
    : t('vaccines.dose.recommendedAt', { age: ageLabel(t, bucket) });
}

/** The badge text of a source id: PNI, SBP and SBIm are names, not words, so they are not translated. */
export function sourceBadge(t: TFunction, id: string): string {
  if (id === 'pni') return t('vaccines.dose.sources.pni');
  if (id === 'sbp') return t('vaccines.dose.sources.sbp');
  if (id === 'sbim') return t('vaccines.dose.sources.sbim');
  return id.toUpperCase();
}

/** The main status line of a dose card. */
export function statusLine(
  t: TFunction,
  status: StatusDescriptor,
  options: { product?: string } = {},
): string {
  switch (status.kind) {
    case 'given':
      return options.product
        ? t('vaccines.dose.givenWith', {
            date: formatDate(status.givenOn),
            product: options.product,
          })
        : t('vaccines.dose.given', { date: formatDate(status.givenOn) });
    case 'due':
      return t('vaccines.dose.due');
    case 'overdue':
      return t('vaccines.dose.overdue');
    case 'dueIn':
      return t('vaccines.dose.dueIn', { count: status.days });
    case 'dueOn':
      return t('vaccines.dose.dueOn', { date: formatDate(status.date) });
    case 'waiting':
      return t('vaccines.dose.waiting');
    case 'notInPublic':
      return t('vaccines.dose.notInPublic');
    case 'expired':
      return t('vaccines.dose.expired');
  }
}

/** The second line under a status chip: why it is overdue, when a yearly dose comes next. */
export function secondaryLine(
  t: TFunction,
  view: DoseView,
  status: StatusDescriptor,
): string | null {
  if (status.kind === 'overdue') return recommendedLine(t, view.dose.recommendedAgeDays);
  if (status.kind === 'given' && status.nextDueOn !== null) {
    return t('vaccines.dose.nextOn', { date: formatDate(status.nextDueOn) });
  }
  return null;
}

/** What a record is called: its custom name, or the schedule's name for its vaccine. */
export function recordName(
  schedule: VaccineSchedule | null | undefined,
  record: Pick<Vaccination, 'vaccineKey' | 'customName'>,
  language: string,
): string {
  if (record.vaccineKey !== null) return vaccineName(schedule, record.vaccineKey, language);
  return record.customName ?? '';
}

/**
 * The dose a record names: the schedule's label while the dose is still in the schedule (in the UI
 * language), otherwise the label saved with the record (in the language it was recorded in);
 * `null` for a record with neither.
 */
export function recordDoseLabel(
  schedule: VaccineSchedule | null | undefined,
  record: Pick<Vaccination, 'doseId' | 'doseLabel'>,
  language: string,
): string | null {
  const dose =
    record.doseId === null ? undefined : schedule?.doses.find((d) => d.doseId === record.doseId);
  return (dose ? doseLabelOf(dose, language) : record.doseLabel) || null;
}

/** Where a record says the vaccine was given: "Public (SUS)" or "Private clinic". */
export function networkText(t: TFunction, record: Pick<Vaccination, 'network'>): string {
  return t(
    record.network === 'private'
      ? 'vaccines.sheet.networks.private'
      : 'vaccines.sheet.networks.public',
  );
}

/** A dose in words: "Pentavalent · 1st dose". */
export function doseTitle(
  schedule: VaccineSchedule,
  dose: ScheduledDose,
  language: string,
): string {
  return `${vaccineName(schedule, dose.vaccineKey, language)} · ${doseLabelOf(dose, language)}`;
}
