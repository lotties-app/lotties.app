import { t } from '../i18n/i18n';
import type { ProductForm } from '../sync/contract';
import type { IconName } from '../ui/icons';

/*
 * Dose units counted in items or applications (sprays, inhaler puffs, suppositories, applications
 * of an ointment or cream), recognised in the free-text dose unit. Mirrors the API's
 * `Lotties.Domain.Medications.DoseUnits`: a dose in a counted unit is never per kg, sprays and
 * puffs are whole numbers and suppositories are multiples of 0.5 (half suppositories). Other units
 * ("drops", "gotas", "ml", "mg", anything the doctor wrote) stay free text.
 */

export type CountedUnit = 'spray' | 'puff' | 'suppository' | 'application';

const ALIASES: ReadonlyMap<string, CountedUnit> = new Map<string, CountedUnit>([
  ['spray', 'spray'],
  ['sprays', 'spray'],
  ['jato', 'spray'],
  ['jatos', 'spray'],
  ['borrifada', 'spray'],
  ['borrifadas', 'spray'],
  ['puff', 'puff'],
  ['puffs', 'puff'],
  ['inalação', 'puff'],
  ['inalações', 'puff'],
  ['inalacao', 'puff'],
  ['inalacoes', 'puff'],
  ['suppository', 'suppository'],
  ['suppositories', 'suppository'],
  ['supositório', 'suppository'],
  ['supositórios', 'suppository'],
  ['supositorio', 'suppository'],
  ['supositorios', 'suppository'],
  ['application', 'application'],
  ['applications', 'application'],
  ['aplicação', 'application'],
  ['aplicações', 'application'],
  ['aplicacao', 'application'],
  ['aplicacoes', 'application'],
]);

/** The counted unit `unit` names (any case, English or Portuguese), or `null`. */
export function countedUnitOf(unit: string): CountedUnit | null {
  return ALIASES.get(unit.trim().toLowerCase()) ?? null;
}

/**
 * The step a dose in `unit` must be a multiple of: 1 for sprays and puffs, 0.5 for suppositories
 * (half suppositories), `null` for applications (any amount).
 */
export function amountStepOf(unit: CountedUnit): number | null {
  if (unit === 'spray' || unit === 'puff') return 1;
  return unit === 'suppository' ? 0.5 : null;
}

/** Whether `amount` is a multiple of the unit's step (always for applications). */
export function fitsAmountStep(amount: number, unit: CountedUnit): boolean {
  const step = amountStepOf(unit);
  if (step === null) return true;
  const steps = amount / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

const FORM_UNITS: Partial<Record<ProductForm, CountedUnit>> = {
  spray: 'spray',
  inhaler: 'puff',
  suppository: 'suppository',
  ointment: 'application',
};

/** The counted unit a product form is dosed in (a spray in sprays...), `null` for measured forms. */
export function countedUnitForForm(form: ProductForm | null | undefined): CountedUnit | null {
  return form && Object.hasOwn(FORM_UNITS, form) ? (FORM_UNITS[form] ?? null) : null;
}

const UNIT_LABEL_KEYS = {
  spray: 'ui.units.sprays',
  puff: 'ui.units.puffs',
  suppository: 'ui.units.suppositories',
  application: 'ui.units.applications',
} as const satisfies Record<CountedUnit, string>;

/** The unit alone, in the app language ("sprays" / "jatos"). */
export function countedUnitLabel(unit: CountedUnit): string {
  return t(UNIT_LABEL_KEYS[unit]);
}

/** "1 spray", "2 sprays" ("2 jatos"): the amount with its counted unit, pluralised. */
export function countedAmountText(amount: number, unit: CountedUnit): string {
  return t(`medications.countedDose.${unit}`, { count: amount });
}

/** The icon of each product form in the form picker and product line. */
export const FORM_ICONS: Readonly<Record<ProductForm, IconName>> = {
  drops: 'droplet',
  syrup: 'medicine-syrup',
  tablet: 'pill',
  powder: 'flask',
  spray: 'spray',
  ointment: 'bandage',
  suppository: 'capsule',
  inhaler: 'lungs',
  other: 'medical-cross',
};

/** Every product form, in the order the picker offers them. */
export const PRODUCT_FORMS: readonly ProductForm[] = [
  'drops',
  'syrup',
  'tablet',
  'powder',
  'spray',
  'ointment',
  'suppository',
  'inhaler',
  'other',
];
